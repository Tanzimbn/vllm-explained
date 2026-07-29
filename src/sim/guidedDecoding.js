import { defineSim, rand } from './createSim'

/**
 * Guided decoding via a grammar-derived FSM.
 *
 * Character-level, following the blog's toy example: choice=["Positive",
 * "Negative"]. At each step the FSM's current state defines the set of legal
 * next tokens; everything else is masked to -inf before sampling, so an illegal
 * token is not unlikely — it is impossible.
 *
 * The 16-token vocab keeps the bitmask small enough to read as binary, which is
 * the point: _grammar_bitmask really is just packed bits, 32 tokens per int32.
 */

const SEED = 61

export const VOCAB = [
  'P', 'o', 's', 'i', 't', 'v', 'e', 'N',
  'g', 'a', 'x', 'z', '7', '!', 'q', '#',
]

const WORDS = ['Positive', 'Negative']

/**
 * FSM state = how many characters we've committed, plus which branch (or null
 * while both are still possible). Returns the set of legal next characters.
 */
export function allowedAt(state) {
  const { pos, branch } = state
  const live = branch === null ? WORDS : [WORDS[branch]]
  const chars = new Set()
  for (const w of live) {
    if (pos < w.length) chars.add(w[pos])
  }
  return [...chars]
}

export function isAccepting(state) {
  return state.branch !== null && state.pos === WORDS[state.branch].length
}

/** Pack the allowed set into bits, low bit = token 0 — as xgrammar would. */
export function buildBitmask(allowed) {
  const bits = VOCAB.map((t) => (allowed.includes(t) ? 1 : 0))
  const value = bits.reduce((acc, b, i) => acc + (b ? 2 ** i : 0), 0)
  // shown most-significant-bit first, the way you'd print an integer
  const binary = [...bits].reverse().join('')
  return { bits, value, binary }
}

/**
 * The model's own preferences, before any masking. Deliberately includes junk
 * tokens with high scores so masking visibly does work.
 */
export function baseLogits(state, p) {
  return VOCAB.map((tok, i) => {
    let l = 1.6 * rand(SEED, state.pos, i, 5) * 4 - 1
    // nudge the intended branch so the walk goes somewhere sensible
    const target = WORDS[p.sentiment === 'positive' ? 0 : 1]
    if (state.pos < target.length && tok === target[state.pos]) l += 3.2
    if (tok === 'x' || tok === '#' || tok === '7') l += 2.4 // tempting garbage
    return l
  })
}

export default defineSim({
  name: 'guidedDecoding',
  params: {
    guided: {
      label: 'Guided decoding',
      options: [
        { value: 'on', label: 'on' },
        { value: 'off', label: 'off' },
      ],
      default: 'on',
    },
    sentiment: {
      label: 'What the model leans toward',
      options: [
        { value: 'positive', label: 'Positive' },
        { value: 'negative', label: 'Negative' },
      ],
      default: 'positive',
    },
  },

  init() {
    return {
      tick: 0,
      fsm: { pos: 0, branch: null },
      emitted: '',
      history: [],
      violations: 0, // illegal characters emitted with guiding off
      last: null,
    }
  },

  step(s, p) {
    const allowed = allowedAt(s.fsm)
    const mask = buildBitmask(allowed)
    const logits = baseLogits(s.fsm, p)

    // With guiding on, disallowed positions go to -inf. Then take the argmax.
    const effective = logits.map((l, i) =>
      p.guided === 'on' && !mask.bits[i] ? -Infinity : l,
    )
    const pick = effective.indexOf(Math.max(...effective))
    const char = VOCAB[pick]
    const legal = allowed.includes(char)

    // advance the FSM (accept_tokens)
    let fsm = s.fsm
    if (legal) {
      let branch = s.fsm.branch
      if (branch === null) {
        branch = WORDS.findIndex((w) => w[s.fsm.pos] === char)
        if (branch < 0) branch = null
      }
      fsm = { pos: s.fsm.pos + 1, branch }
    }

    return {
      tick: s.tick + 1,
      fsm,
      emitted: s.emitted + char,
      history: [
        ...s.history,
        { allowed, mask, logits, effective, pick, char, legal, state: s.fsm },
      ],
      violations: s.violations + (legal ? 0 : 1),
      last: { allowed, mask, logits, effective, pick, char, legal },
    }
  },

  isDone(s, p) {
    if (isAccepting(s.fsm)) return true
    // ungrammatical output can't be advanced any further
    return p.guided === 'off' && s.violations > 0
  },

  invariants: [
    (s, p) =>
      p.guided !== 'on' ||
      s.history.every((h) => h.allowed.includes(h.char)) ||
      'guided decoding emitted a token the FSM disallowed',
    (s, p) => p.guided !== 'on' || s.violations === 0 || 'violation recorded while guided',
    (s) =>
      s.history.every((h) => h.mask.bits.length === VOCAB.length) ||
      'bitmask width does not match the vocab',
    (s) =>
      s.history.every(
        (h) => h.mask.bits.filter(Boolean).length === h.allowed.length,
      ) || 'bitmask set bits disagree with the allowed set',
  ],
})

export { WORDS }
