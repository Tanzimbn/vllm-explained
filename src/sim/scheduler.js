import { ceilDiv, defineSim, randGap, randInt } from './createSim'

/**
 * The V1 scheduler.
 *
 * Faithful to the shape of the real thing:
 *   - decodes from the `running` queue are considered FIRST, then prefills from
 *     `waiting`, all against one shared per-step token budget;
 *   - both kinds can land in the SAME step (V0 could only do one or the other);
 *   - allocate_slots is the choke point, and when the block pool is dry a
 *     lower-priority request gets preempted by *recomputation* — it loses its
 *     KV blocks and will have to prefill again from scratch.
 *
 * Chunked prefill is deliberately absent here; it's stage 06. That means a
 * prompt longer than the whole token budget can never be scheduled, which the
 * sim reports rather than hiding — it's the exact hole chunking fills.
 */

const SEED = 7331
const BLOCK = 16

function makeRequests(p) {
  return Array.from({ length: p.numRequests }, (_, i) => {
    const arrival = i === 0 ? 0 : randGap(1.6, SEED, i, 5)
    return {
      id: `R${i}`,
      idx: i,
      promptLen: 12 + randInt(0, p.promptSpread, SEED, i, 1),
      outLen: 3 + randInt(0, 7, SEED, i, 2),
      priority: randInt(0, 2, SEED, i, 9), // 0 = most important
      arrival,
      tokens: 0, // tokens with KV currently cached
      generated: 0,
      prefilled: false,
      blocks: 0,
      status: 'unborn', // unborn | waiting | running | done
      preemptions: 0,
      recomputed: 0,
      firstTokenAt: null,
      arrivedAt: null,
    }
  })
}

/** Order the waiting queue the way the configured policy would. */
function waitingOrder(requests, waiting, policy) {
  const xs = [...waiting]
  if (policy === 'priority') {
    xs.sort((a, b) => {
      const ra = requests[a]
      const rb = requests[b]
      return ra.priority - rb.priority || ra.arrivedAt - rb.arrivedAt || a - b
    })
  }
  return xs
}

export default defineSim({
  name: 'scheduler',
  params: {
    policy: {
      label: 'Policy',
      options: [
        { value: 'fcfs', label: 'FCFS' },
        { value: 'priority', label: 'priority' },
      ],
      default: 'fcfs',
    },
    tokenBudget: { label: 'Token budget / step', min: 16, max: 160, step: 8, default: 64 },
    numBlocks: { label: 'KV blocks', min: 6, max: 40, default: 14 },
    numRequests: { label: 'Requests', min: 3, max: 10, default: 7 },
    promptSpread: { label: 'Prompt-length spread', min: 0, max: 90, step: 6, default: 42 },
  },

  init(p) {
    const requests = makeRequests(p)
    // arrival times are gaps; turn them into absolute ticks
    let t = 0
    requests.forEach((r) => {
      t += r.arrival
      r.arrival = t
    })
    return {
      tick: 0,
      requests,
      waiting: [],
      running: [],
      freeBlocks: p.numBlocks,
      rows: requests.map(() => []),
      lastStep: { decodes: [], prefills: [], budgetUsed: 0, preempted: [], skipped: [] },
      totalPreemptions: 0,
      wastedRecompute: 0,
      stuck: null,
      note: 'waiting for the first request to arrive',
    }
  },

  step(s, p) {
    const tick = s.tick
    const requests = s.requests.map((r) => ({ ...r }))
    let waiting = [...s.waiting]
    let running = [...s.running]
    let freeBlocks = s.freeBlocks
    const rows = s.rows.map((r) => [...r])
    let preemptions = s.totalPreemptions
    let wasted = s.wastedRecompute

    const decodes = []
    const prefills = []
    const preempted = []
    const skipped = []
    let budget = p.tokenBudget
    const notes = []

    // ---- arrivals ---------------------------------------------------------
    requests.forEach((r) => {
      if (r.status === 'unborn' && r.arrival <= tick) {
        r.status = 'waiting'
        r.arrivedAt = tick
        waiting.push(r.idx)
      }
    })

    /** allocate_slots: reserve blocks for `newTokens` more tokens of request r. */
    const allocateSlots = (r, newTokens) => {
      const need = ceilDiv(r.tokens + newTokens, BLOCK) - r.blocks
      if (need <= 0) return { ok: true, took: 0 }
      if (need <= freeBlocks) {
        freeBlocks -= need
        r.blocks += need
        return { ok: true, took: need }
      }
      return { ok: false, need }
    }

    /** Recompute preemption: evict from the tail of the running queue. */
    const tryPreempt = (protectIdx) => {
      for (let i = running.length - 1; i >= 0; i--) {
        const victimIdx = running[i]
        if (victimIdx === protectIdx) continue
        const v = requests[victimIdx]
        freeBlocks += v.blocks
        wasted += v.tokens // everything it had cached must be recomputed later
        v.blocks = 0
        v.tokens = 0
        v.prefilled = false // it will have to prefill again from scratch
        v.status = 'waiting'
        v.preemptions += 1
        v.recomputed += 1
        running.splice(i, 1)
        waiting.unshift(victimIdx) // goes back to the front, it was already admitted
        preemptions++
        preempted.push(v.id)
        rows[victimIdx][tick] = {
          kind: 'preempt',
          title: `${v.id} preempted — KV blocks freed, prefill must be recomputed`,
        }
        return v
      }
      return null
    }

    // ---- 1. decodes first (the running queue) -----------------------------
    for (const idx of [...running]) {
      const r = requests[idx]
      if (r.status !== 'running') continue
      const newTokens = 1 // >1 with speculative decoding or async scheduling
      if (budget < newTokens) {
        skipped.push(r.id)
        continue
      }
      let res = allocateSlots(r, newTokens)
      if (!res.ok) {
        const victim = tryPreempt(idx)
        if (victim) {
          notes.push(
            `block pool dry — preempted ${victim.id} so ${r.id} could keep decoding (its ${victim.recomputed > 1 ? 'again-' : ''}lost prefill will be recomputed)`,
          )
          res = allocateSlots(r, newTokens)
        }
        if (!res.ok) {
          skipped.push(r.id)
          continue
        }
      }
      budget -= newTokens
      decodes.push(r.id)
      r.tokens += newTokens
      r.generated += 1
      rows[idx][tick] = { kind: 'decode', title: `${r.id} decode → token ${r.generated}` }
    }

    // ---- 2. then prefills (the waiting queue) -----------------------------
    const order = waitingOrder(requests, waiting, p.policy)
    for (const idx of order) {
      const r = requests[idx]
      if (r.status !== 'waiting') continue
      // No chunking yet (stage 06): a prefill is all-or-nothing.
      if (r.promptLen > p.tokenBudget) {
        skipped.push(r.id)
        notes.push(
          `${r.id}'s prompt is ${r.promptLen} tokens but the whole budget is only ${p.tokenBudget} — with no chunked prefill it can never be scheduled`,
        )
        continue
      }
      if (r.promptLen > budget) {
        skipped.push(r.id)
        continue
      }
      const res = allocateSlots(r, r.promptLen)
      if (!res.ok) {
        skipped.push(r.id)
        continue
      }
      budget -= r.promptLen
      prefills.push(r.id)
      r.tokens = r.promptLen
      r.prefilled = true
      r.generated += 1
      if (r.firstTokenAt === null) r.firstTokenAt = tick
      r.status = 'running'
      waiting = waiting.filter((x) => x !== idx)
      running.push(idx)
      rows[idx][tick] = {
        kind: 'prefill',
        title: `${r.id} prefill — ${r.promptLen} tokens, ${res.took} block(s)`,
      }
    }

    // ---- 3. completion ----------------------------------------------------
    for (const idx of [...running]) {
      const r = requests[idx]
      if (r.generated >= r.outLen) {
        r.status = 'done'
        freeBlocks += r.blocks
        r.blocks = 0
        running = running.filter((x) => x !== idx)
        rows[idx][tick] = { kind: 'done', title: `${r.id} finished` }
      }
    }

    // pad the timeline
    requests.forEach((r, i) => {
      if (rows[i][tick]) return
      rows[i][tick] =
        r.status === 'waiting'
          ? { kind: 'wait', title: `${r.id} in the waiting queue` }
          : { kind: 'idle' }
    })

    // ---- deadlock detection ----------------------------------------------
    const progressed = decodes.length + prefills.length > 0
    const anyLeft = requests.some((r) => r.status !== 'done')
    const stuck =
      !progressed && anyLeft && running.length === 0 && requests.every((r) => r.status !== 'unborn')
        ? 'Nothing can be scheduled: every remaining prompt is longer than the token budget. This is precisely the gap chunked prefill (stage 06) closes.'
        : null

    return {
      tick: tick + 1,
      requests,
      waiting,
      running,
      freeBlocks,
      rows,
      lastStep: { decodes, prefills, budgetUsed: p.tokenBudget - budget, preempted, skipped },
      totalPreemptions: preemptions,
      wastedRecompute: wasted,
      stuck: stuck ?? s.stuck,
      note:
        notes[0] ??
        (progressed
          ? `${decodes.length} decode(s) + ${prefills.length} prefill(s) in one step`
          : 'nothing scheduled this step'),
    }
  },

  isDone(s) {
    return s.requests.every((r) => r.status === 'done') || s.stuck !== null
  },

  invariants: [
    (s, p) => {
      const held = s.requests.reduce((a, r) => a + r.blocks, 0)
      return (
        held + s.freeBlocks === p.numBlocks ||
        `blocks not conserved: ${held} held + ${s.freeBlocks} free != ${p.numBlocks}`
      )
    },
    (s, p) =>
      s.lastStep.budgetUsed <= p.tokenBudget ||
      `token budget exceeded: used ${s.lastStep.budgetUsed} of ${p.tokenBudget}`,
    (s) => s.freeBlocks >= 0 || 'free block count went negative',
    (s) =>
      s.requests.every((r) => r.blocks * BLOCK >= r.tokens || r.status === 'done') ||
      'a live request holds fewer blocks than its cached tokens need',
    (s) => {
      const both = s.waiting.filter((i) => s.running.includes(i))
      return both.length === 0 || 'a request is in the waiting and running queues at once'
    },
    (s) =>
      s.running.every((i) => s.requests[i].status === 'running') ||
      'the running queue contains a request that is not RUNNING',
    (s) => s.requests.every((r) => r.generated <= r.outLen) || 'over-generated',
  ],
})

export { BLOCK }
