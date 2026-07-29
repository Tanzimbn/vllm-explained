import { ceilDiv, defineSim, randInt } from './createSim'

/**
 * How a mixed batch of prefills and decodes becomes one flat tensor, and where
 * each new token's KV actually gets written.
 *
 * The key arithmetic — and it is genuinely this simple — is
 *
 *     slot = block_table[pos // block_size] * block_size + (pos % block_size)
 *
 * That one line is what lets a "batch" be a ragged pile of sequences whose KV
 * lives in scattered physical blocks, with no padding anywhere.
 */

const SEED = 20250829

/**
 * A deterministic shuffle of the physical block pool.
 * Blocks are handed out from this in order, so every request gets blocks that
 * are scattered but — critically — globally unique. Two requests sharing a
 * physical block would mean two tokens writing to one KV slot.
 */
function shuffledPool(poolSize) {
  const pool = Array.from({ length: poolSize }, (_, i) => i)
  for (let i = poolSize - 1; i > 0; i--) {
    const j = randInt(0, i, SEED, i, 17)
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool
}

/** Build the batch the scheduler handed us, plus every derived input array. */
export function buildBatch(p) {
  const bs = p.blockSize
  const requests = []

  for (let i = 0; i < p.numPrefill; i++) {
    const promptLen = 3 + randInt(0, 4, SEED, i, 71)
    requests.push({
      id: `P${i}`,
      kind: 'prefill',
      ctxLen: 0, // nothing cached yet
      newTokens: promptLen,
    })
  }
  for (let i = 0; i < p.numDecode; i++) {
    const ctxLen = 6 + randInt(0, 16, SEED, i, 91)
    requests.push({
      id: `D${i}`,
      kind: 'decode',
      ctxLen, // its whole history is already in the KV cache
      newTokens: 1,
    })
  }

  // block tables, sized for context + the new tokens, drawn from one global pool
  const pool = shuffledPool(64)
  let cursor = 0
  requests.forEach((r, i) => {
    r.idx = i
    const need = ceilDiv(r.ctxLen + r.newTokens, bs)
    r.blocks = pool.slice(cursor, cursor + need)
    cursor += need
  })

  // the flattened "super sequence"
  const flat = []
  requests.forEach((r) => {
    for (let t = 0; t < r.newTokens; t++) {
      const pos = r.ctxLen + t
      const logicalBlock = Math.floor(pos / bs)
      const offset = pos % bs
      const physical = r.blocks[logicalBlock]
      flat.push({
        reqIdx: r.idx,
        reqId: r.id,
        kind: r.kind,
        pos,
        logicalBlock,
        offset,
        physical,
        slot: physical * bs + offset,
        isLast: t === r.newTokens - 1,
      })
    }
  })

  // cu_seqlens / query start locations, and the rows logits are gathered from
  const starts = []
  let acc = 0
  requests.forEach((r) => {
    starts.push(acc)
    acc += r.newTokens
  })
  const gatherRows = flat.map((f, i) => (f.isLast ? i : -1)).filter((i) => i >= 0)

  return { requests, flat, starts, totalTokens: acc, gatherRows }
}

const PHASE_INFO = {
  scheduled: {
    label: 'scheduler output',
    detail:
      'The scheduler picked this mix: some prefills with many new tokens each, some decodes with exactly one. Nothing has been copied to the GPU yet.',
  },
  update: {
    label: 'update states',
    detail:
      'Prune finished requests from input_batch and refresh per-request metadata — crucially the block tables that will index into paged KV memory.',
  },
  build: {
    label: 'prepare inputs',
    detail:
      'Concatenate every scheduled request\'s new tokens into one flat sequence, compute each token\'s position, and build slot_mapping: the physical KV slot each new token\'s key/value will be written to.',
  },
  attend: {
    label: 'forward pass',
    detail:
      'Run the model with paged-attention kernels. All sequences share one flat tensor; position indices and the attention metadata ensure every sequence attends only to its own tokens — so no right-padding is needed, and the batch can be a different shape every single step.',
  },
  gather: {
    label: 'gather last-token states',
    detail:
      'Only the final position of each sequence can produce a next token. Those rows are gathered out of the flat hidden-state tensor and pushed through the LM head to get logits.',
  },
  sample: {
    label: 'sample',
    detail:
      'One token sampled per sequence according to its own sampling params. Every request in the batch gets exactly one new token, whether it contributed 1 row or 40.',
  },
}

export default defineSim({
  name: 'forward',
  params: {
    numPrefill: { label: 'Prefills in batch', min: 0, max: 3, default: 2 },
    numDecode: { label: 'Decodes in batch', min: 1, max: 4, default: 3 },
    blockSize: { label: 'block_size', options: [4, 8, 16], default: 4 },
  },

  init(p) {
    const batch = buildBatch(p)
    return { tick: 0, k: 0, batch }
  },

  step(s) {
    const n = s.batch.flat.length
    return { ...s, tick: s.tick + 1, k: Math.min(s.k + 1, n + 4) }
  },

  isDone(s) {
    return s.k >= s.batch.flat.length + 4
  },

  invariants: [
    (s, p) => {
      // slot_mapping must be injective: two tokens writing to one KV slot would corrupt the cache
      const slots = s.batch.flat.map((f) => f.slot)
      return new Set(slots).size === slots.length || 'two tokens map to the same KV slot'
    },
    (s, p) =>
      s.batch.flat.every((f) => f.offset < p.blockSize) || 'block offset exceeded block_size',
    (s) =>
      s.batch.gatherRows.length === s.batch.requests.length ||
      'exactly one logits row must be gathered per request',
    (s) =>
      s.batch.totalTokens === s.batch.flat.length || 'flattened length disagrees with cu_seqlens',
  ],
})

/** Which stage of the forward pass the given tick is in. */
export function phaseOf(s) {
  const n = s.batch.flat.length
  if (s.k === 0) return 'scheduled'
  if (s.k === 1) return 'update'
  if (s.k <= n + 1) return 'build'
  if (s.k === n + 2) return 'attend'
  if (s.k === n + 3) return 'gather'
  return 'sample'
}

/** How many flattened tokens have been revealed so far. */
export function revealed(s) {
  const n = s.batch.flat.length
  if (s.k <= 1) return 0
  return Math.min(n, s.k - 1)
}

export { PHASE_INFO }
