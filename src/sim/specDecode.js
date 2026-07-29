import { defineSim, rand } from './createSim'

/**
 * Speculative decoding, with the real rejection-sampling rule.
 *
 * The accept/reject test is the whole point, so it is implemented exactly:
 *
 *   accept t  if  p_target(t) >= p_draft(t)
 *             else with probability p_target(t) / p_draft(t)
 *   on rejection, resample from normalize(max(0, p_target - p_draft))
 *
 * That combination is what makes the output distribution *identical* to
 * sampling from the target model alone — which `sims.test.js` checks
 * empirically rather than taking on faith.
 */

const SEED = 1337

export const VOCAB = ['the', 'a', 'and', 'of', 'to', 'in', 'is', 'that']

const TARGET_LOGITS = [3.1, 2.4, 1.9, 1.5, 1.2, 0.8, 0.5, 0.1]
// A different shape entirely — this is what "the draft model is not the target
// model" means in practice.
const DRAFT_LOGITS = [1.4, 2.9, 1.1, 2.2, 0.6, 1.7, 0.9, 0.4]

function softmax(xs) {
  const m = Math.max(...xs)
  const e = xs.map((x) => Math.exp(x - m))
  const t = e.reduce((a, b) => a + b, 0)
  return e.map((x) => x / t)
}

export const pTarget = softmax(TARGET_LOGITS)

/**
 * The draft's distribution, interpolated toward the target by `agreement`.
 * agreement=1 means a perfect draft (everything is accepted); 0 means a draft
 * with genuinely different opinions.
 */
export function pDraft(agreement) {
  const d = softmax(DRAFT_LOGITS)
  const mixed = d.map((x, i) => agreement * pTarget[i] + (1 - agreement) * x)
  const t = mixed.reduce((a, b) => a + b, 0)
  return mixed.map((x) => x / t)
}

function sampleFrom(probs, u) {
  let acc = 0
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i]
    if (u <= acc) return i
  }
  return probs.length - 1
}

/**
 * One speculation round. Pure: given a round index it always produces the same
 * result, so step-back and the tests both work.
 */
export function speculate(round, p) {
  const q = pDraft(p.agreement)
  const drafted = []
  const verdicts = []

  // ---- draft: k tokens from the small model ------------------------------
  for (let j = 0; j < p.k; j++) {
    drafted.push(sampleFrom(q, rand(SEED, round, j, 1)))
  }

  // ---- verify + accept/reject, left to right -----------------------------
  let rejectedAt = -1
  let resampled = null
  for (let j = 0; j < p.k; j++) {
    const t = drafted[j]
    const ratio = q[t] > 0 ? pTarget[t] / q[t] : 1
    const u = rand(SEED, round, j, 2)
    const accepted = ratio >= 1 || u < ratio
    verdicts.push({ token: t, ratio, accepted, pT: pTarget[t], pD: q[t] })
    if (!accepted) {
      rejectedAt = j
      // resample from the rebalanced residual distribution
      const residual = pTarget.map((pt, i) => Math.max(0, pt - q[i]))
      const total = residual.reduce((a, b) => a + b, 0)
      const norm = total > 0 ? residual.map((x) => x / total) : pTarget
      resampled = sampleFrom(norm, rand(SEED, round, j, 3))
      break
    }
  }

  const acceptedCount = rejectedAt === -1 ? p.k : rejectedAt

  // If every draft token survived, the target's own (k+1)th distribution is
  // already computed — so we get one extra token for free.
  const bonus = rejectedAt === -1 ? sampleFrom(pTarget, rand(SEED, round, 99, 4)) : null

  const emitted = [
    ...drafted.slice(0, acceptedCount),
    ...(resampled !== null ? [resampled] : []),
    ...(bonus !== null ? [bonus] : []),
  ]

  return { drafted, verdicts, acceptedCount, rejectedAt, resampled, bonus, emitted }
}

export default defineSim({
  name: 'specDecode',
  params: {
    k: { label: 'num_speculative_tokens (k)', min: 1, max: 7, default: 4 },
    agreement: { label: 'draft agreement', min: 0, max: 1, step: 0.05, default: 0.6 },
    draftCost: { label: 'draft cost (× target pass)', min: 0.02, max: 0.5, step: 0.02, default: 0.1 },
    method: {
      label: 'Draft method',
      options: [
        { value: 'ngram', label: 'n-gram' },
        { value: 'eagle', label: 'EAGLE' },
        { value: 'medusa', label: 'Medusa' },
      ],
      default: 'ngram',
    },
  },

  init() {
    return {
      tick: 0,
      rounds: [],
      tokensEmitted: 0,
      acceptedTotal: 0,
      draftedTotal: 0,
      bonusTotal: 0,
      histogram: new Array(VOCAB.length).fill(0),
      firstTokenHistogram: new Array(VOCAB.length).fill(0),
      last: null,
    }
  },

  step(s, p) {
    const r = speculate(s.tick, p)
    const histogram = [...s.histogram]
    r.emitted.forEach((t) => (histogram[t] += 1))
    // The first token each round is the one whose distribution we can check
    // against p_target — this is the correctness claim, made measurable.
    const firstTokenHistogram = [...s.firstTokenHistogram]
    if (r.emitted.length) firstTokenHistogram[r.emitted[0]] += 1

    return {
      tick: s.tick + 1,
      rounds: [...s.rounds.slice(-40), r],
      tokensEmitted: s.tokensEmitted + r.emitted.length,
      acceptedTotal: s.acceptedTotal + r.acceptedCount,
      draftedTotal: s.draftedTotal + p.k,
      bonusTotal: s.bonusTotal + (r.bonus !== null ? 1 : 0),
      histogram,
      firstTokenHistogram,
      last: r,
    }
  },

  isDone(s) {
    return s.tick >= 300
  },

  invariants: [
    (s, p) =>
      s.rounds.every((r) => r.acceptedCount <= p.k) || 'accepted more tokens than were drafted',
    (s, p) =>
      s.rounds.every((r) => r.emitted.length >= 1 && r.emitted.length <= p.k + 1) ||
      'a round emitted an impossible number of tokens',
    (s) =>
      s.rounds.every((r) => (r.bonus !== null) === (r.rejectedAt === -1)) ||
      'the bonus token must appear exactly when nothing was rejected',
    (s) =>
      s.rounds.every((r) => (r.resampled !== null) === (r.rejectedAt !== -1)) ||
      'a resample must happen exactly when something was rejected',
    (s) => s.histogram.reduce((a, b) => a + b, 0) === s.tokensEmitted || 'histogram desync',
  ],
})

/** Throughput accounting: how much faster is this than plain autoregression? */
export function speedup(s, p) {
  if (s.tick === 0) return { tokensPerRound: 0, costPerRound: 1, factor: 1, acceptRate: 0 }
  const tokensPerRound = s.tokensEmitted / s.tick
  // one target forward pass, plus k cheap draft passes
  const costPerRound = 1 + p.k * p.draftCost
  return {
    tokensPerRound,
    costPerRound,
    factor: tokensPerRound / costPerRound,
    acceptRate: s.draftedTotal ? s.acceptedTotal / s.draftedTotal : 0,
  }
}

export const METHOD_INFO = {
  ngram: {
    title: 'n-gram',
    detail:
      'No model at all. Take the last prompt_lookup_max tokens, search the sequence so far for an earlier occurrence, and propose whatever followed it. On no match, shrink the window and retry down to prompt_lookup_min.',
    good: 'Free to run, and shockingly effective on repetitive text: code, structured output, summarizing a document you already quoted.',
    bad: 'Useless on genuinely novel text — nothing to look up.',
  },
  eagle: {
    title: 'EAGLE',
    detail:
      'Model surgery on the target: keep its embeddings and LM head, replace the transformer stack with a lightweight MLP, and fine-tune that as the draft.',
    good: 'Much higher acceptance than n-gram because it actually learned the target\'s distribution.',
    bad: 'Needs training, and the draft weights cost VRAM you could have spent on KV cache.',
  },
  medusa: {
    title: 'Medusa',
    detail:
      'Train auxiliary linear heads on top of the target\'s final hidden states to predict the next k tokens in parallel — no separate model to run.',
    good: 'One forward pass proposes all k candidates.',
    bad: 'Heads predict independently, so their joint accuracy degrades quickly as k grows.',
  },
}
