import { defineSim, randInt } from './createSim'
import { stepDuration } from './chunkedPrefill'

/**
 * Disaggregated prefill/decode.
 *
 * Colocated, prefill and decode share one engine, so a burst of long prompts
 * inflates the steps that other users' decodes are riding in — the same
 * mechanism as stage 06, but now caused by *other requests* rather than one
 * long one, and so not fixable by chunking alone.
 *
 * Disaggregated, prefill instances and decode instances are separate. Decode
 * steps stay small and uniform, at the price of shipping each request's KV
 * cache across the wire before it can start.
 */

const SEED = 8642

function makeRequests(p) {
  return Array.from({ length: p.numRequests }, (_, i) => ({
    id: `R${i}`,
    idx: i,
    promptLen: p.promptLen + randInt(-96, 96, SEED, i, 3),
    outLen: 6 + randInt(0, 6, SEED, i, 4),
    arrival: Math.floor(i / 2), // they come in pairs, i.e. bursty
    status: 'unborn', // unborn | queued | prefilling | transferring | decoding | done
    generated: 0,
    itls: [],
    ttft: null,
    transferLeft: 0,
  }))
}

/** KV bytes scale with prompt length; transfer time is modelled per token. */
function transferTicks(promptLen, p) {
  return Math.max(1, Math.ceil((promptLen / 512) * p.transferCost))
}

export default defineSim({
  name: 'disaggPD',
  params: {
    mode: {
      label: 'Deployment',
      options: [
        { value: 'colocated', label: 'colocated' },
        { value: 'disagg', label: 'disaggregated' },
      ],
      default: 'colocated',
    },
    numRequests: { label: 'Requests', min: 3, max: 8, default: 6 },
    promptLen: { label: 'Typical prompt', min: 256, max: 1536, step: 128, default: 768 },
    transferCost: { label: 'KV transfer (ticks / 512 tok)', min: 1, max: 6, default: 2 },
  },

  init(p) {
    return {
      tick: 0,
      requests: makeRequests(p),
      store: [], // the external KV service: request ids whose KV is parked there
      elapsedMs: 0,
      steps: [], // { where: 'P'|'D'|'both', prefillTokens, decodeTokens, ms }
      connectorPhase: null,
      note: 'nothing has arrived yet',
    }
  },

  step(s, p) {
    const requests = s.requests.map((r) => ({ ...r, itls: [...r.itls] }))
    let store = [...s.store]
    let note = ''
    let connectorPhase = null

    // arrivals
    requests.forEach((r) => {
      if (r.status === 'unborn' && r.arrival <= s.tick) r.status = 'queued'
    })

    let prefillTokens = 0
    let decodeTokens = 0
    const decodedNow = []

    if (p.mode === 'colocated') {
      // One engine. Decodes first, then one prefill — all inside the same step,
      // so the prefill's cost lands on everyone's ITL.
      requests.forEach((r) => {
        if (r.status === 'decoding' && r.generated < r.outLen) {
          decodeTokens += 1
          decodedNow.push(r)
        }
      })
      const next = requests.find((r) => r.status === 'queued')
      if (next) {
        prefillTokens = next.promptLen
        next.status = 'decoding' // KV is already local; decode starts immediately
        next.generated = 1
        note = `one engine: ${next.id}'s ${next.promptLen}-token prefill runs in the same step as ${decodeTokens} decode(s)`
      }

      const tokens = prefillTokens + decodeTokens
      const ms = tokens ? stepDuration(tokens) : 0
      decodedNow.forEach((r) => {
        r.generated += 1
        r.itls.push(ms)
      })
      if (next) next.ttft = s.elapsedMs + ms

      return {
        tick: s.tick + 1,
        requests,
        store,
        elapsedMs: s.elapsedMs + ms,
        steps: [...s.steps, { where: 'both', prefillTokens, decodeTokens, ms }],
        connectorPhase: null,
        note: note || `${decodeTokens} decode(s) only — ${ms.toFixed(1)} ms`,
      }
    }

    // ---- disaggregated ----------------------------------------------------
    // The prefill instance and the decode instance step independently; wall
    // clock advances by the slower of the two, since they run in parallel.

    // prefill instance: take one queued request
    const next = requests.find((r) => r.status === 'queued')
    if (next) {
      prefillTokens = next.promptLen
      next.status = 'transferring'
      next.transferLeft = transferTicks(next.promptLen, p)
      store.push(next.id)
      connectorPhase = 'save'
      note = `prefill instance ran ${next.id} (${next.promptLen} tok); wait_for_save blocks until its KV is uploaded`
    }

    // in-flight transfers
    requests.forEach((r) => {
      if (r.status !== 'transferring') return
      r.transferLeft -= 1
      if (r.transferLeft <= 0) {
        r.status = 'decoding'
        r.generated = 1
        store = store.filter((x) => x !== r.id)
        connectorPhase = 'load'
        if (!note)
          note = `decode instance: get_num_new_matched_tokens hit for ${r.id}, start_load_kv injected its KV into paged memory`
      }
    })

    // decode instance: every decoding request gets one token
    requests.forEach((r) => {
      if (r.status === 'decoding' && r.generated < r.outLen) {
        decodeTokens += 1
        decodedNow.push(r)
      }
    })

    const prefillMs = prefillTokens ? stepDuration(prefillTokens) : 0
    const decodeMs = decodeTokens ? stepDuration(decodeTokens) : 0
    const ms = Math.max(prefillMs, decodeMs) // they run on different GPUs

    // Decoders only wait for the decode instance's own (small) step.
    decodedNow.forEach((r) => {
      r.generated += 1
      r.itls.push(decodeMs)
    })
    if (next) next.ttft = s.elapsedMs + prefillMs

    return {
      tick: s.tick + 1,
      requests,
      store,
      elapsedMs: s.elapsedMs + ms,
      steps: [
        ...s.steps,
        { where: 'split', prefillTokens, decodeTokens, ms, prefillMs, decodeMs },
      ],
      connectorPhase,
      note: note || `decode instance: ${decodeTokens} token(s) in ${decodeMs.toFixed(1)} ms`,
    }
  },

  isDone(s) {
    return s.requests.every((r) => r.status === 'done' || r.generated >= r.outLen)
  },

  invariants: [
    (s) => s.requests.every((r) => r.generated <= r.outLen) || 'over-generated',
    (s) => s.requests.every((r) => r.transferLeft >= 0) || 'negative transfer time',
    (s, p) =>
      p.mode !== 'disagg' ||
      s.requests.every((r) => r.status !== 'decoding' || r.transferLeft <= 0) ||
      'a request began decoding before its KV finished transferring',
    (s) =>
      s.store.every((id) => {
        const r = s.requests.find((x) => x.id === id)
        return r && r.status === 'transferring'
      }) || 'the KV store holds an entry for a request that is not transferring',
  ],
})

/** ITL and TTFT statistics across all requests. */
export function pdStats(s) {
  const itls = s.requests.flatMap((r) => r.itls)
  const ttfts = s.requests.map((r) => r.ttft).filter((x) => x !== null)
  const q = (xs, f) => {
    if (!xs.length) return 0
    const sorted = [...xs].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))]
  }
  return {
    maxItl: itls.length ? Math.max(...itls) : 0,
    p50Itl: q(itls, 0.5),
    p95Itl: q(itls, 0.95),
    meanTtft: ttfts.length ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : 0,
    count: itls.length,
  }
}

export const CONNECTOR_STEPS = [
  {
    key: 'instantiate',
    title: 'Instantiation',
    detail:
      'During engine construction, connectors are created twice: inside the worker\'s init-device procedure with role "worker", and inside the scheduler constructor with role "scheduler".',
  },
  {
    key: 'lookup',
    title: 'Cache lookup',
    detail:
      'When the scheduler pulls a prefill from the waiting queue — after the local prefix-cache check — it calls get_num_new_matched_tokens to ask the KV service what it already has. A prefill instance always sees 0; a decode instance may see a full hit. The result is added to the local count before allocate_slots.',
  },
  {
    key: 'update',
    title: 'State update',
    detail:
      'The scheduler calls connector.update_state_after_alloc, recording which requests had an external hit. A no-op on prefill.',
  },
  {
    key: 'meta',
    title: 'Meta build',
    detail:
      'At the end of scheduling, build_connector_meta prepares the instructions: prefill adds its requests with is_store=True (upload the KV), decode adds its with is_store=False (fetch it).',
  },
  {
    key: 'ctx',
    title: 'Context manager',
    detail:
      'Around the forward pass. On enter, start_load_kv — for decode this pulls KV from the external service and injects it into paged memory; no-op for prefill. On exit, wait_for_save — for prefill this blocks until the KV is uploaded; no-op for decode.',
  },
]
