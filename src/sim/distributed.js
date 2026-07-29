import { defineSim, randGap, randInt } from './createSim'

/**
 * The frontend's load balancer, across DP replicas.
 *
 * vLLM's actual rule, from get_core_engine_for_request:
 *
 *     score = len(waiting) * 4 + len(running)     -> pick the minimum
 *
 * The 4× weight on the waiting queue is the interesting part: a queued request
 * has not started, so it represents strictly more unserved latency than one
 * already streaming. Round-robin is included for contrast — it's the obvious
 * thing to do, and it degrades badly under uneven request costs.
 */

const SEED = 5309
const ENGINES = 4

export function score(e) {
  return e.waiting.length * 4 + e.running.length
}

export default defineSim({
  name: 'distributed',
  params: {
    policy: {
      label: 'Routing',
      options: [
        { value: 'score', label: 'vLLM score' },
        { value: 'roundrobin', label: 'round-robin' },
        { value: 'random', label: 'random' },
      ],
      default: 'score',
    },
    arrivalRate: { label: 'Arrivals per step', min: 1, max: 5, default: 2 },
    skew: { label: 'Request-cost skew', min: 0, max: 10, default: 6 },
    capacity: { label: 'Concurrent per engine', min: 1, max: 6, default: 3 },
  },

  init(p) {
    return {
      tick: 0,
      nextId: 0,
      rr: 0,
      engines: Array.from({ length: ENGINES }, (_, i) => ({
        id: `E${i}`,
        idx: i,
        node: i < 2 ? 0 : 1, // 2 replicas per node, per --data-parallel-size-local
        waiting: [],
        running: [],
        completed: 0,
        wave: 0,
        idleSteps: 0,
      })),
      requests: {},
      routed: [],
      lastPick: null,
      lastScores: [],
      imbalanceHistory: [],
      note: 'all four replicas idle, wave counter at 0',
    }
  },

  step(s, p) {
    const engines = s.engines.map((e) => ({
      ...e,
      waiting: [...e.waiting],
      running: [...e.running],
    }))
    const requests = { ...s.requests }
    let nextId = s.nextId
    let rr = s.rr
    let lastPick = null
    const notes = []

    // ---- 1. engines make progress ----------------------------------------
    engines.forEach((e) => {
      // finish work
      e.running = e.running.filter((id) => {
        requests[id] = { ...requests[id], left: requests[id].left - 1 }
        if (requests[id].left <= 0) {
          e.completed += 1
          requests[id].status = 'done'
          return false
        }
        return true
      })
      // admit from its own waiting queue up to capacity
      while (e.running.length < p.capacity && e.waiting.length > 0) {
        const id = e.waiting.shift()
        requests[id] = { ...requests[id], status: 'running' }
        e.running.push(id)
      }
      if (e.running.length === 0 && e.waiting.length === 0) e.idleSteps += 1
    })

    // ---- 2. new arrivals get routed --------------------------------------
    const arrivals = randInt(0, p.arrivalRate, SEED, s.tick, 7)
    const scores = engines.map(score)
    for (let a = 0; a < arrivals; a++) {
      const id = `q${nextId++}`
      // cost skew: most requests are short, some are very long
      const long = randGap(3, SEED, nextId, 2) > 3
      const cost = long ? 4 + randInt(0, p.skew, SEED, nextId, 3) : 2 + randInt(0, 2, SEED, nextId, 4)
      requests[id] = { id, cost, left: cost, status: 'waiting', long }

      // Scores as they stood when the decision was made — recording them after
      // the push would include the request being routed.
      const atDecision = engines.map((e) => score(e))
      let pick
      if (p.policy === 'roundrobin') {
        pick = rr % engines.length
        rr += 1
      } else if (p.policy === 'random') {
        pick = randInt(0, engines.length - 1, SEED, nextId, 8)
      } else {
        // minimum score; ties go to the lowest index, as a stable choice
        pick = atDecision.indexOf(Math.min(...atDecision))
      }
      engines[pick].waiting.push(id)
      lastPick = { id, engine: engines[pick].id, cost, scores: atDecision }
    }
    if (arrivals > 0 && lastPick) {
      notes.push(
        p.policy === 'score'
          ? `routed ${arrivals} arrival(s); scores were [${scores.join(', ')}] so the frontend picked the minimum`
          : `routed ${arrivals} arrival(s) by ${p.policy}, ignoring load`,
      )
    }

    // ---- 3. DP wave bookkeeping -----------------------------------------
    const anyWork = engines.some((e) => e.running.length + e.waiting.length > 0)
    engines.forEach((e) => {
      if (anyWork) e.wave = s.engines[e.idx].wave + (e.running.length === 0 ? 0 : 0)
    })
    const wave = anyWork ? Math.max(...s.engines.map((e) => e.wave), 0) : 0

    // ---- 4. imbalance metric --------------------------------------------
    const loads = engines.map((e) => e.running.length + e.waiting.length)
    const imbalance = Math.max(...loads) - Math.min(...loads)

    // engines with no work still take a dummy step to hit collective sync points
    const dummySteppers = engines.filter((e) => e.running.length === 0 && anyWork).length
    if (dummySteppers > 0 && anyWork) {
      notes.push(
        `${dummySteppers} replica(s) have no work but still run a dummy step to participate in the DP synchronization points`,
      )
    }

    return {
      tick: s.tick + 1,
      nextId,
      rr,
      engines: engines.map((e) => ({ ...e, wave })),
      requests,
      routed: lastPick ? [...s.routed.slice(-30), lastPick] : s.routed,
      lastPick,
      lastScores: scores,
      imbalanceHistory: [...s.imbalanceHistory, imbalance],
      note: notes[0] ?? (anyWork ? 'engines busy' : 'all replicas quiesced — wave counter idle'),
    }
  },

  isDone(s) {
    return s.tick >= 60
  },

  invariants: [
    (s, p) =>
      s.engines.every((e) => e.running.length <= p.capacity) ||
      'an engine exceeded its concurrency limit',
    (s) => {
      // every request is in exactly one place
      const placed = s.engines.flatMap((e) => [...e.waiting, ...e.running])
      return new Set(placed).size === placed.length || 'a request is queued on two engines'
    },
    (s) =>
      Object.values(s.requests).every((r) => r.left >= 0) || 'negative remaining work',
    (s) =>
      s.engines.every((e) => e.waiting.every((id) => s.requests[id].status === 'waiting')) ||
      'a running request is sitting in a waiting queue',
  ],
})

/** How evenly the policy spread the load. */
export function balanceStats(s) {
  const h = s.imbalanceHistory
  if (!h.length) return { mean: 0, max: 0, completed: 0, spread: 0 }
  const completed = s.engines.reduce((a, e) => a + e.completed, 0)
  const perEngine = s.engines.map((e) => e.completed)
  return {
    mean: h.reduce((a, b) => a + b, 0) / h.length,
    max: Math.max(...h),
    completed,
    spread: Math.max(...perEngine) - Math.min(...perEngine),
  }
}

export { ENGINES }
