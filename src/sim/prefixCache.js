import { ceilDiv, defineSim } from './createSim'

/**
 * Prefix caching.
 *
 * Blocks are identified by a *chained* hash: each complete block's hash folds in
 * the previous block's hash plus its own token ids. That chaining is what makes
 * a hit meaningful — matching block 3 only counts if blocks 0..2 matched too,
 * which is exactly the semantics of a shared *prefix*.
 *
 * The lifecycle modelled here follows the real one:
 *   hash_request_tokens -> find_longest_cache_hit -> allocate_slots
 *   -> cache_blocks -> forward pass populates KV -> free() returns blocks
 *      to free_block_queue *with their hashes intact*, so a later request can
 *      reclaim them.
 */

const BLOCK = 16

/** A tiny stable string hash, standing in for vLLM's builtin-hash / SHA-256. */
function h(str) {
  let x = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    x = (x ^ str.charCodeAt(i)) >>> 0
    x = Math.imul(x, 16777619) >>> 0
  }
  return x.toString(16).slice(0, 6)
}

/**
 * hash_request_tokens: split into BLOCK-sized chunks and chain-hash each
 * *complete* one. An incomplete trailing chunk gets no hash — it cannot be
 * cached, because more tokens are still going to land in it.
 */
export function hashRequestTokens(tokenIds) {
  const out = []
  let prev = 'root'
  const complete = Math.floor(tokenIds.length / BLOCK)
  for (let i = 0; i < complete; i++) {
    const toks = tokenIds.slice(i * BLOCK, (i + 1) * BLOCK)
    prev = h(`${prev}|${toks.join(',')}`)
    out.push({ hash: prev, tokens: toks, index: i })
  }
  const rem = tokenIds.length % BLOCK
  if (rem > 0) {
    out.push({
      hash: null, // incomplete: not cacheable
      tokens: tokenIds.slice(complete * BLOCK),
      index: complete,
      partial: true,
    })
  }
  return out
}

/** find_longest_cache_hit: walk the chain, stop at the first miss. */
export function findLongestCacheHit(blockHashes, cache) {
  let n = 0
  for (const bh of blockHashes) {
    if (!bh.hash || !(bh.hash in cache)) break
    n++
  }
  return n
}

/** Token ids for request i: a shared prefix, then a distinct suffix. */
function tokensFor(p, i) {
  const prefix = Array.from({ length: p.prefixTokens }, (_, t) => 1000 + t)
  const suffix = Array.from({ length: p.suffixTokens }, (_, t) => 5000 + i * 100 + t)
  return [...prefix, ...suffix]
}

const PHASES = [
  'arrive',
  'hash',
  'lookup',
  'allocate',
  'forward',
  'complete',
]

const PHASE_TEXT = {
  arrive: 'A new request arrives. Its prompt is the shared prefix plus its own distinct suffix.',
  hash: 'hash_request_tokens splits the prompt into 16-token blocks and chain-hashes each complete one. The trailing partial block gets no hash — it is not cacheable.',
  lookup:
    'find_longest_cache_hit walks the hash chain against cached_block_hash_to_block, stopping at the first miss.',
  allocate:
    'allocate_slots takes blocks for whatever was NOT hit. Hit blocks are reclaimed instead: pulled back out of free_block_queue with their KV still valid, and their refcount incremented.',
  forward:
    'The forward pass computes KV only for the newly allocated blocks. coordinator.cache_blocks registers their hashes in cached_block_hash_to_block so the next request can find them.',
  complete:
    'The request finishes. free() returns its blocks to free_block_queue — but they keep their hash and their entry in the cache map, so they remain reclaimable until physically reused.',
}

export default defineSim({
  name: 'prefixCache',
  params: {
    enabled: {
      label: 'Prefix caching',
      options: [
        { value: 'on', label: 'on' },
        { value: 'off', label: 'off' },
      ],
      default: 'on',
    },
    prefixTokens: { label: 'Shared prefix', min: 16, max: 160, step: 16, default: 64 },
    suffixTokens: { label: 'Distinct suffix', min: 4, max: 40, step: 4, default: 12 },
    numRequests: { label: 'Requests', min: 2, max: 4, default: 3 },
  },

  init(p) {
    return {
      tick: 0,
      ri: 0, // which request we're on
      phase: 'arrive',
      cache: {}, // cached_block_hash_to_block: hash -> physical block id
      blocks: {}, // physical block id -> { hash, refs, live }
      nextBlockId: 0,
      requests: Array.from({ length: p.numRequests }, (_, i) => ({
        id: `R${i}`,
        idx: i,
        blockHashes: [],
        hits: 0,
        allocated: [],
        reclaimed: [],
        computedTokens: 0,
        savedTokens: 0,
        status: 'pending',
      })),
      totalComputed: 0,
      totalSaved: 0,
      note: 'nothing has been hashed yet',
    }
  },

  step(s, p) {
    const requests = s.requests.map((r) => ({
      ...r,
      blockHashes: [...r.blockHashes],
      allocated: [...r.allocated],
      reclaimed: [...r.reclaimed],
    }))
    const cache = { ...s.cache }
    const blocks = Object.fromEntries(
      Object.entries(s.blocks).map(([k, v]) => [k, { ...v }]),
    )
    let nextBlockId = s.nextBlockId
    let { ri, phase } = s
    let totalComputed = s.totalComputed
    let totalSaved = s.totalSaved
    let note = ''

    const r = requests[ri]
    const tokens = tokensFor(p, ri)

    switch (phase) {
      case 'arrive': {
        r.status = 'active'
        note = `${r.id}: prompt is ${p.prefixTokens} shared + ${p.suffixTokens} distinct = ${tokens.length} tokens`
        phase = 'hash'
        break
      }

      case 'hash': {
        r.blockHashes = hashRequestTokens(tokens)
        const complete = r.blockHashes.filter((b) => !b.partial).length
        note = `${r.id}: ${complete} complete block hash(es)${
          r.blockHashes.some((b) => b.partial) ? ' + 1 partial (uncacheable)' : ''
        }, stored in req_to_block_hashes`
        phase = 'lookup'
        break
      }

      case 'lookup': {
        r.hits = p.enabled === 'on' ? findLongestCacheHit(r.blockHashes, cache) : 0
        note =
          r.hits > 0
            ? `${r.id}: find_longest_cache_hit matched ${r.hits} block(s) — ${r.hits * BLOCK} tokens will not be recomputed`
            : p.enabled === 'on'
              ? `${r.id}: no hits — nothing in cached_block_hash_to_block matches yet`
              : `${r.id}: prefix caching disabled, get_computed_blocks returns 0`
        phase = 'allocate'
        break
      }

      case 'allocate': {
        r.blockHashes.forEach((bh, i) => {
          if (i < r.hits) {
            // reclaim: the block is already in the cache map, take it back out
            // of free_block_queue and bump its refcount
            const id = cache[bh.hash]
            blocks[id].refs += 1
            blocks[id].live = true
            r.reclaimed.push(id)
          } else {
            const id = nextBlockId++
            blocks[id] = { hash: null, refs: 1, live: true }
            r.allocated.push(id)
          }
        })
        note = `${r.id}: reclaimed [${r.reclaimed.join(', ') || '—'}], newly allocated [${r.allocated.join(', ') || '—'}]`
        phase = 'forward'
        break
      }

      case 'forward': {
        // only the non-hit tokens are actually computed
        const computed = tokens.length - r.hits * BLOCK
        r.computedTokens = computed
        r.savedTokens = r.hits * BLOCK
        totalComputed += computed
        totalSaved += r.savedTokens

        // cache_blocks: register the hashes of the complete blocks we just filled
        r.blockHashes.forEach((bh, i) => {
          if (i < r.hits || bh.partial || !bh.hash) return
          const id = r.allocated[i - r.hits]
          if (id === undefined) return
          blocks[id].hash = bh.hash
          cache[bh.hash] = id
        })
        note = `${r.id}: forward pass computed ${computed} token(s)${
          r.savedTokens ? `, skipped ${r.savedTokens} via cache` : ''
        }; new complete blocks registered in cached_block_hash_to_block`
        phase = 'complete'
        break
      }

      case 'complete': {
        r.status = 'done'
        // free(): refcounts drop; blocks return to free_block_queue but keep
        // their hash, so they stay reclaimable
        ;[...r.allocated, ...r.reclaimed].forEach((id) => {
          blocks[id].refs = Math.max(0, blocks[id].refs - 1)
          if (blocks[id].refs === 0) blocks[id].live = false
        })
        note = `${r.id}: finished — blocks returned to free_block_queue with hashes intact (refcount 0 ≠ invalid)`
        ri = ri + 1
        phase = 'arrive'
        break
      }
    }

    return {
      tick: s.tick + 1,
      ri: Math.min(ri, p.numRequests - 1),
      phase: ri >= p.numRequests ? 'finished' : phase,
      cache,
      blocks,
      nextBlockId,
      requests,
      totalComputed,
      totalSaved,
      note,
    }
  },

  isDone(s, p) {
    return s.requests.every((r) => r.status === 'done')
  },

  invariants: [
    (s) =>
      Object.values(s.blocks).every((b) => b.refs >= 0) || 'a block refcount went negative',
    (s) =>
      Object.entries(s.cache).every(([hash, id]) => s.blocks[id]?.hash === hash) ||
      'cached_block_hash_to_block disagrees with the block it points at',
    (s) => {
      // A physical block is only ever registered under one hash.
      const ids = Object.values(s.cache)
      return new Set(ids).size === ids.length || 'two hashes map to the same physical block'
    },
    (s) =>
      s.requests.every((r) => r.computedTokens >= 0) || 'negative computed-token count',
    (s, p) =>
      s.requests.every(
        (r) => r.status !== 'done' || r.computedTokens + r.savedTokens === p.prefixTokens + p.suffixTokens,
      ) || 'computed + saved must equal the prompt length',
  ],
})

export { BLOCK, PHASES, PHASE_TEXT }
