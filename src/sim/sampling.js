import { defineSim, rand } from './createSim'

/**
 * What the sampling knobs actually do to a distribution.
 *
 * Each tick draws one token from the *processed* distribution and adds it to a
 * histogram, so you can watch the empirical draws converge on whatever shape
 * temperature / top-k / top-p left behind. Greedy is the degenerate case.
 */

const SEED = 5150

// A plausible next-token distribution for the prompt "The capital of France is".
export const VOCAB = [
  { tok: 'Paris', logit: 8.4 },
  { tok: 'the', logit: 5.9 },
  { tok: 'a', logit: 5.1 },
  { tok: 'located', logit: 4.6 },
  { tok: 'in', logit: 4.2 },
  { tok: 'not', logit: 3.3 },
  { tok: 'called', logit: 3.0 },
  { tok: 'Lyon', logit: 2.4 },
  { tok: 'home', logit: 2.1 },
  { tok: 'one', logit: 1.5 },
  { tok: 'Berlin', logit: 0.9 },
  { tok: 'banana', logit: -1.8 },
]

function softmax(logits, temperature) {
  const t = Math.max(temperature, 1e-3)
  const scaled = logits.map((l) => l / t)
  const max = Math.max(...scaled)
  const exps = scaled.map((l) => Math.exp(l - max))
  const total = exps.reduce((a, b) => a + b, 0)
  return exps.map((e) => e / total)
}

/**
 * Apply the sampling config, in the order vLLM does: temperature, then top-k,
 * then top-p, then renormalize. Returns per-token probability plus whether it
 * survived the filters.
 */
export function processLogits(p) {
  const logits = VOCAB.map((v) => v.logit)

  if (p.mode === 'greedy') {
    const best = logits.indexOf(Math.max(...logits))
    return VOCAB.map((v, i) => ({
      ...v,
      prob: i === best ? 1 : 0,
      kept: i === best,
      reason: i === best ? null : 'greedy takes the argmax only',
    }))
  }

  const probs = softmax(logits, p.temperature)
  const order = probs.map((pr, i) => ({ i, pr })).sort((a, b) => b.pr - a.pr)

  const kept = new Array(VOCAB.length).fill(true)
  const reason = new Array(VOCAB.length).fill(null)

  // top-k: keep only the k highest-probability tokens
  if (p.topK > 0 && p.topK < VOCAB.length) {
    order.slice(p.topK).forEach(({ i }) => {
      kept[i] = false
      reason[i] = `outside top-k (${p.topK})`
    })
  }

  // top-p (nucleus): smallest prefix of the sorted survivors whose mass >= p
  if (p.topP < 1) {
    let cum = 0
    let hitNucleus = false
    for (const { i, pr } of order) {
      if (!kept[i]) continue
      if (hitNucleus) {
        kept[i] = false
        reason[i] = `outside top-p (${p.topP.toFixed(2)})`
        continue
      }
      cum += pr
      if (cum >= p.topP) hitNucleus = true // this one is the last kept
    }
  }

  const keptMass = probs.reduce((a, pr, i) => a + (kept[i] ? pr : 0), 0)
  return VOCAB.map((v, i) => ({
    ...v,
    prob: kept[i] ? probs[i] / (keptMass || 1) : 0,
    rawProb: probs[i],
    kept: kept[i],
    reason: reason[i],
  }))
}

function draw(processed, u) {
  let acc = 0
  for (let i = 0; i < processed.length; i++) {
    acc += processed[i].prob
    if (u <= acc) return i
  }
  return processed.findLastIndex((x) => x.kept)
}

export default defineSim({
  name: 'sampling',
  params: {
    mode: {
      label: 'Mode',
      options: [
        { value: 'random', label: 'sampled' },
        { value: 'greedy', label: 'greedy' },
      ],
      default: 'random',
    },
    temperature: { label: 'temperature', min: 0.1, max: 2, step: 0.1, default: 0.8 },
    topP: { label: 'top_p', min: 0.05, max: 1, step: 0.05, default: 0.95 },
    topK: { label: 'top_k (0 = off)', min: 0, max: 12, default: 0 },
  },

  init() {
    return { tick: 0, counts: new Array(VOCAB.length).fill(0), last: null }
  },

  step(s, p) {
    const processed = processLogits(p)
    const i = draw(processed, rand(SEED, s.tick))
    const counts = [...s.counts]
    counts[i] += 1
    return { tick: s.tick + 1, counts, last: i }
  },

  isDone(s) {
    return s.tick >= 400
  },

  invariants: [
    (s) => s.counts.every((c) => c >= 0) || 'negative count',
    (s) => s.counts.reduce((a, b) => a + b, 0) === s.tick || 'one draw per tick',
  ],
})
