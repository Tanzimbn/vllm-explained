import { defineSim } from './createSim'

/**
 * The roofline model for a decode step, and the latency/throughput tradeoff it
 * produces.
 *
 * Assumption (the blog's): weight I/O dominates, not KV-cache I/O — i.e. short
 * sequences. Then for a batch of B:
 *
 *   t_mem     = bytes_of_weights / HBM_bandwidth        (independent of B)
 *   t_compute = 2 * params * B / peak_FLOPS             (linear in B)
 *   t_step    = max(t_mem, t_compute)
 *
 * Below B_sat the step is bandwidth-bound and its duration barely moves —
 * computing 1 token or 10 costs about the same. Above it the step is
 * compute-bound and every extra token adds latency.
 */

const BYTES_PER_PARAM = 2 // bf16

export function stepModel(B, p) {
  const params = p.modelParams * 1e9
  const weightBytes = params * BYTES_PER_PARAM
  const tMem = weightBytes / (p.bandwidth * 1e12) // seconds
  const tCompute = (2 * params * B) / (p.peakFlops * 1e12)
  const tStep = Math.max(tMem, tCompute)
  return {
    tMemMs: tMem * 1000,
    tComputeMs: tCompute * 1000,
    stepMs: tStep * 1000,
    itlMs: tStep * 1000,
    throughput: B / tStep, // tokens/sec
    bound: tCompute > tMem ? 'compute' : 'bandwidth',
  }
}

/** B_sat: the batch size where compute time overtakes weight-streaming time. */
export function bSat(p) {
  const params = p.modelParams * 1e9
  const weightBytes = params * BYTES_PER_PARAM
  const tMem = weightBytes / (p.bandwidth * 1e12)
  // solve 2*params*B / peak = tMem
  return Math.max(1, (tMem * p.peakFlops * 1e12) / (2 * params))
}

export default defineSim({
  name: 'roofline',
  params: {
    modelParams: { label: 'Model size (B params)', min: 1, max: 70, default: 8 },
    bandwidth: { label: 'HBM bandwidth (TB/s)', min: 1, max: 8, step: 0.5, default: 3.35 },
    peakFlops: { label: 'Peak compute (TFLOP/s)', min: 100, max: 2000, step: 100, default: 990 },
    slaItlMs: { label: 'ITL SLO (ms)', min: 5, max: 120, step: 5, default: 30 },
  },

  init() {
    return { tick: 0, B: 1, trace: [] }
  },

  step(s, p) {
    // sweep batch size along a roughly geometric ladder
    const next = s.B < 4 ? s.B + 1 : Math.min(1024, Math.ceil(s.B * 1.35))
    const m = stepModel(next, p)
    return {
      tick: s.tick + 1,
      B: next,
      trace: [...s.trace, { B: next, ...m }],
    }
  },

  isDone(s) {
    return s.B >= 1024
  },

  invariants: [
    (s, p) =>
      s.trace.every((x) => x.stepMs >= x.tMemMs - 1e-9) ||
      'step latency dropped below the weight-streaming floor',
    (s) =>
      s.trace.every((x, i) => i === 0 || x.throughput >= s.trace[i - 1].throughput - 1e-6) ||
      'throughput decreased as batch size grew',
    (s) =>
      s.trace.every((x, i) => i === 0 || x.stepMs >= s.trace[i - 1].stepMs - 1e-9) ||
      'step latency decreased as batch size grew',
  ],
})

/* ------------------------------------------------------------------ latency */

/**
 * A single request's timeline, so TTFT / ITL / TPOT / E2E can be read off it
 * rather than defined abstractly.
 */
export const latency = defineSim({
  name: 'latency',
  params: {
    queueMs: { label: 'Queueing delay (ms)', min: 0, max: 200, step: 10, default: 40 },
    prefillMs: { label: 'Prefill time (ms)', min: 10, max: 400, step: 10, default: 120 },
    itlMs: { label: 'Per-token time (ms)', min: 5, max: 80, step: 5, default: 25 },
    outputTokens: { label: 'Output tokens', min: 2, max: 24, default: 10 },
  },

  init(p) {
    return { tick: 0, tokens: [], nowMs: 0, ttft: null }
  },

  step(s, p) {
    if (s.tokens.length === 0) {
      // first token: queueing + prefill
      const at = p.queueMs + p.prefillMs
      return {
        tick: s.tick + 1,
        tokens: [{ i: 0, atMs: at, gapMs: at }],
        nowMs: at,
        ttft: at,
      }
    }
    const at = s.nowMs + p.itlMs
    return {
      tick: s.tick + 1,
      tokens: [...s.tokens, { i: s.tokens.length, atMs: at, gapMs: p.itlMs }],
      nowMs: at,
      ttft: s.ttft,
    }
  },

  isDone(s, p) {
    return s.tokens.length >= p.outputTokens
  },

  invariants: [
    (s) =>
      s.tokens.every((t, i) => i === 0 || t.atMs > s.tokens[i - 1].atMs) ||
      'tokens must arrive in increasing time order',
    (s, p) => s.tokens.length <= p.outputTokens || 'emitted more tokens than requested',
  ],
})

/** The metric definitions, computed rather than asserted. */
export function latencyMetrics(s) {
  const n = s.tokens.length
  if (n === 0) return { ttft: 0, itls: [], tpot: 0, e2e: 0 }
  const ttft = s.tokens[0].atMs
  const itls = s.tokens.slice(1).map((t) => t.gapMs)
  const tpot = itls.length ? itls.reduce((a, b) => a + b, 0) / itls.length : 0
  return {
    ttft,
    itls,
    tpot,
    // E2E = TTFT + sum of all ITLs
    e2e: ttft + itls.reduce((a, b) => a + b, 0),
    lastAt: s.tokens[n - 1].atMs,
  }
}
