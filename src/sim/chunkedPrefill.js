import { defineSim, randInt } from './createSim'

/**
 * Chunked prefill.
 *
 * The cost being modelled is *step duration*: a forward pass over 2048 prefill
 * tokens takes far longer than one over 8 decode tokens. Since every request in
 * a step waits for that step to finish, one enormous prefill inflates the
 * inter-token latency of everybody decoding alongside it.
 *
 * Chunking slices the prefill so no single step is ever huge.
 */

const SEED = 3407

// A crude but honest step-cost model: fixed launch overhead plus per-token work.
const STEP_OVERHEAD_MS = 6
const MS_PER_TOKEN = 0.09

export function stepDuration(tokens) {
  return STEP_OVERHEAD_MS + tokens * MS_PER_TOKEN
}

export default defineSim({
  name: 'chunkedPrefill',
  params: {
    chunking: {
      label: 'Chunked prefill',
      options: [
        { value: 'off', label: 'off' },
        { value: 'on', label: 'on' },
      ],
      default: 'off',
    },
    longPromptLen: { label: 'Long prompt', min: 256, max: 2048, step: 128, default: 1024 },
    threshold: {
      label: 'long_prefill_token_threshold',
      options: [64, 128, 256, 512],
      default: 128,
    },
    tokenBudget: { label: 'Token budget / step', min: 256, max: 2048, step: 256, default: 2048 },
    numDecoders: { label: 'Requests already decoding', min: 1, max: 6, default: 4 },
  },

  init(p) {
    return {
      tick: 0,
      prefillDone: 0,
      prefillTTFT: null,
      decoders: Array.from({ length: p.numDecoders }, (_, i) => ({
        id: `D${i}`,
        outLen: 8 + randInt(0, 6, SEED, i, 2),
        generated: 0,
        itls: [],
      })),
      steps: [], // { prefillTokens, decodeTokens, ms }
      elapsedMs: 0,
      note: 'nothing has run yet',
    }
  },

  step(s, p) {
    const decoders = s.decoders.map((d) => ({ ...d, itls: [...d.itls] }))
    let budget = p.tokenBudget
    let note = ''

    // ---- decodes first ---------------------------------------------------
    let decodeTokens = 0
    const decodedNow = []
    for (const d of decoders) {
      if (d.generated >= d.outLen) continue
      if (budget < 1) break
      budget -= 1
      decodeTokens += 1
      decodedNow.push(d)
    }

    // ---- then whatever prefill fits --------------------------------------
    const remainingPrompt = p.longPromptLen - s.prefillDone
    let prefillTokens = 0
    if (remainingPrompt > 0) {
      const cap =
        p.chunking === 'on' ? Math.min(p.threshold, remainingPrompt) : remainingPrompt
      if (cap <= budget) {
        prefillTokens = cap
        budget -= cap
      } else {
        note = `the remaining ${remainingPrompt}-token prefill doesn't fit in the ${p.tokenBudget}-token budget — without chunking it is stuck`
      }
    }

    const tokens = decodeTokens + prefillTokens
    const ms = tokens > 0 ? stepDuration(tokens) : 0
    const elapsedMs = s.elapsedMs + ms

    // Everyone who decoded in this step waited the whole step for their token.
    decodedNow.forEach((d) => {
      d.generated += 1
      d.itls.push(ms)
    })

    const prefillDone = s.prefillDone + prefillTokens
    let prefillTTFT = s.prefillTTFT
    if (prefillTTFT === null && prefillDone >= p.longPromptLen && prefillTokens > 0) {
      prefillTTFT = elapsedMs
    }

    if (!note) {
      if (prefillTokens > 0 && p.chunking === 'on') {
        note = `chunk of ${prefillTokens} prefill tokens (${prefillDone}/${p.longPromptLen} done) alongside ${decodeTokens} decode(s) — step took ${ms.toFixed(1)} ms`
      } else if (prefillTokens > 0) {
        note = `the entire ${prefillTokens}-token prefill ran in one step alongside ${decodeTokens} decode(s) — step took ${ms.toFixed(1)} ms`
      } else {
        note = `${decodeTokens} decode(s) only — step took ${ms.toFixed(1)} ms`
      }
    }

    return {
      tick: s.tick + 1,
      prefillDone,
      prefillTTFT,
      decoders,
      steps: [...s.steps, { prefillTokens, decodeTokens, ms }],
      elapsedMs,
      note,
    }
  },

  isDone(s, p) {
    const prefillFinished = s.prefillDone >= p.longPromptLen
    const decodesFinished = s.decoders.every((d) => d.generated >= d.outLen)
    if (prefillFinished && decodesFinished) return true
    // Stuck only if the *next chunk we would attempt* cannot fit the budget.
    // With chunking on, that means the threshold itself is too big — chunking
    // rescues the case where the whole prompt was the problem.
    const remaining = p.longPromptLen - s.prefillDone
    const nextChunk = p.chunking === 'on' ? Math.min(p.threshold, remaining) : remaining
    return !prefillFinished && decodesFinished && nextChunk > p.tokenBudget
  },

  invariants: [
    (s, p) =>
      s.steps.every((x) => x.prefillTokens + x.decodeTokens <= p.tokenBudget) ||
      'a step exceeded the token budget',
    (s, p) =>
      p.chunking !== 'on' ||
      s.steps.every((x) => x.prefillTokens <= p.threshold) ||
      'a chunk exceeded long_prefill_token_threshold',
    (s, p) => s.prefillDone <= p.longPromptLen || 'prefilled more tokens than the prompt has',
    (s) => s.decoders.every((d) => d.generated <= d.outLen) || 'a decoder over-generated',
  ],
})

/** Latency statistics for the requests that were decoding alongside the prefill. */
export function itlStats(s) {
  const all = s.decoders.flatMap((d) => d.itls)
  if (!all.length) return { max: 0, mean: 0, p50: 0, count: 0, spike: 0 }
  const sorted = [...all].sort((a, b) => a - b)
  const mean = all.reduce((a, b) => a + b, 0) / all.length
  const p50 = sorted[Math.floor(sorted.length / 2)]
  return {
    max: sorted[sorted.length - 1],
    mean,
    p50,
    count: all.length,
    // how much worse the worst token was than the typical one
    spike: p50 > 0 ? sorted[sorted.length - 1] / p50 : 0,
  }
}
