import { defineSim, ceilDiv, randInt } from './createSim'

/**
 * The KV-cache block allocator, in two flavours.
 *
 *  paged      — blocks are handed out one at a time, on demand, from a FIFO
 *               free_block_queue. A request's blocks need not be adjacent.
 *  contiguous — the pre-paged-attention approach: reserve one adjacent run big
 *               enough for the worst case (prompt + max_tokens) up front.
 *
 * The contrast is the whole argument for paged attention, and it shows up in
 * three numbers: reservation waste, internal fragmentation, and external
 * fragmentation (free blocks that exist but are unusable because they're split).
 */

const SEED = 4177

function makeRequests(p) {
  return Array.from({ length: p.numRequests }, (_, i) => {
    const promptLen = 10 + randInt(0, 34, SEED, i, 1)
    const maxTokens = 24 + randInt(0, 40, SEED, i, 2)
    // What it *actually* generates is usually far short of what it reserved for.
    const outLen = 3 + randInt(0, Math.floor(maxTokens * 0.45), SEED, i, 3)
    return {
      id: `R${i}`,
      idx: i,
      promptLen,
      maxTokens,
      outLen,
      tokens: 0,
      generated: 0,
      prefilled: false,
      blocks: [],
      status: 'waiting', // waiting | running | done | rejected
      stalled: false,
    }
  })
}

/** Longest run of consecutive free blocks — the number a contiguous allocator cares about. */
function longestFreeRun(blocks) {
  let best = 0
  let cur = 0
  for (const b of blocks) {
    if (b.owner === null) {
      cur++
      if (cur > best) best = cur
    } else cur = 0
  }
  return best
}

function findRun(blocks, n) {
  let start = -1
  let cur = 0
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].owner === null) {
      if (cur === 0) start = i
      cur++
      if (cur === n) return start
    } else cur = 0
  }
  return -1
}

export default defineSim({
  name: 'kvcache',
  params: {
    mode: {
      label: 'Allocator',
      options: [
        { value: 'paged', label: 'paged' },
        { value: 'contiguous', label: 'contiguous' },
      ],
      default: 'paged',
    },
    blockSize: { label: 'block_size', options: [4, 8, 16], default: 8 },
    numBlocks: { label: 'Total KV blocks', min: 16, max: 64, default: 32 },
    numRequests: { label: 'Requests', min: 3, max: 10, default: 7 },
  },

  init(p) {
    return {
      tick: 0,
      requests: makeRequests(p),
      blocks: Array.from({ length: p.numBlocks }, () => ({ owner: null, filled: 0 })),
      freeQueue: Array.from({ length: p.numBlocks }, (_, i) => i),
      peakConcurrent: 0,
      admitted: 0,
      blockedByFragmentation: 0,
      note: 'pool is empty and every block is free',
    }
  },

  step(s, p) {
    const bs = p.blockSize
    const requests = s.requests.map((r) => ({ ...r, blocks: [...r.blocks], stalled: false }))
    const blocks = s.blocks.map((b) => ({ ...b }))
    let freeQueue = [...s.freeQueue]
    let note = ''
    let fragBlocked = s.blockedByFragmentation

    const takeFromQueue = (n, ownerId) => {
      if (freeQueue.length < n) return null
      const taken = freeQueue.slice(0, n)
      freeQueue = freeQueue.slice(n)
      taken.forEach((bi) => {
        blocks[bi].owner = ownerId
        blocks[bi].filled = 0
      })
      return taken
    }

    // ---- admission --------------------------------------------------------
    const waiting = requests.filter((r) => r.status === 'waiting')
    for (const r of waiting) {
      if (p.mode === 'paged') {
        const need = ceilDiv(r.promptLen, bs)
        const got = takeFromQueue(need, r.id)
        if (!got) {
          note = `${r.id} needs ${need} block(s) for its ${r.promptLen}-token prompt; only ${freeQueue.length} free — it waits`
          break
        }
        r.blocks = got
        r.status = 'running'
      } else {
        // Reserve for the worst case, in one adjacent run.
        const need = ceilDiv(r.promptLen + r.maxTokens, bs)
        const start = findRun(blocks, need)
        if (start < 0) {
          const totalFree = blocks.filter((b) => b.owner === null).length
          if (totalFree >= need) {
            fragBlocked++
            note = `${r.id} needs ${need} adjacent blocks. ${totalFree} are free but the largest run is only ${longestFreeRun(blocks)} — external fragmentation blocks it`
          } else {
            note = `${r.id} needs ${need} blocks reserved up front (prompt ${r.promptLen} + max_tokens ${r.maxTokens}); not enough capacity`
          }
          break
        }
        const taken = []
        for (let i = start; i < start + need; i++) {
          blocks[i].owner = r.id
          blocks[i].filled = 0
          taken.push(i)
        }
        freeQueue = freeQueue.filter((bi) => !taken.includes(bi))
        r.blocks = taken
        r.status = 'running'
      }
    }
    const newlyAdmitted = requests.filter((r) => r.status !== 'waiting').length

    // ---- one engine step: every running request grows -----------------------
    for (const r of requests) {
      if (r.status !== 'running') continue

      const nextTokens = r.prefilled ? r.tokens + 1 : r.promptLen + 1
      const needBlocks = ceilDiv(nextTokens, bs)

      if (needBlocks > r.blocks.length) {
        if (p.mode === 'paged') {
          const extra = takeFromQueue(needBlocks - r.blocks.length, r.id)
          if (!extra) {
            r.stalled = true
            note = `${r.id} wants another block to keep decoding, and the pool is empty — this is where preemption comes in (stage 04)`
            continue
          }
          r.blocks.push(...extra)
        } else {
          // Can't happen: the run was sized for the worst case up front.
          r.stalled = true
          continue
        }
      }

      r.tokens = nextTokens
      if (!r.prefilled) {
        r.prefilled = true
        r.generated = 1
      } else {
        r.generated += 1
      }

      // spread stored tokens across the request's blocks
      let remaining = r.tokens
      for (const bi of r.blocks) {
        blocks[bi].filled = Math.max(0, Math.min(bs, remaining))
        remaining -= bs
      }

      if (r.generated >= r.outLen) {
        r.status = 'done'
        // free() returns the blocks to the pool
        for (const bi of r.blocks) {
          blocks[bi].owner = null
          blocks[bi].filled = 0
          freeQueue.push(bi)
        }
        if (!note)
          note = `${r.id} hit its stop condition after ${r.generated} tokens — ${r.blocks.length} block(s) returned to free_block_queue`
        r.blocks = []
      }
    }

    const live = requests.filter((r) => r.status === 'running').length

    return {
      tick: s.tick + 1,
      requests,
      blocks,
      freeQueue,
      peakConcurrent: Math.max(s.peakConcurrent, live),
      admitted: Math.max(s.admitted, newlyAdmitted),
      blockedByFragmentation: fragBlocked,
      note: note || `${live} request(s) in flight, ${freeQueue.length} block(s) free`,
    }
  },

  isDone(s) {
    return s.requests.every((r) => r.status === 'done')
  },

  invariants: [
    (s, p) =>
      s.blocks.length === p.numBlocks || 'the physical block pool must never change size',
    (s) => {
      // Conservation: every block is either free or owned by exactly one request.
      const freeCount = s.blocks.filter((b) => b.owner === null).length
      const ownedCount = s.blocks.length - freeCount
      const claimed = s.requests.reduce((a, r) => a + r.blocks.length, 0)
      return ownedCount === claimed || `owned blocks (${ownedCount}) != claimed by requests (${claimed})`
    },
    (s) => {
      const owners = s.blocks.filter((b) => b.owner !== null).map((b) => b.owner)
      const claimed = s.requests.flatMap((r) => r.blocks)
      return (
        new Set(claimed).size === claimed.length ||
        'the same physical block is claimed by two requests'
      )
    },
    (s, p) =>
      s.blocks.every((b) => b.filled <= p.blockSize) ||
      'a block holds more tokens than block_size',
    // Scoped to live requests: a finished one has released its blocks but keeps
    // its final token count for the stats panel.
    (s, p) =>
      s.requests
        .filter((r) => r.status === 'running')
        .every((r) => r.blocks.length * p.blockSize >= r.tokens) ||
      'a live request stores more tokens than its blocks can hold',
  ],
})

/** Where the memory actually went. */
export function memoryBreakdown(s, p) {
  const bs = p.blockSize
  const live = s.requests.filter((r) => r.status === 'running')
  const heldBlocks = live.reduce((a, r) => a + r.blocks.length, 0)
  const heldSlots = heldBlocks * bs
  const usedSlots = live.reduce((a, r) => a + r.tokens, 0)
  const freeBlocks = s.blocks.filter((b) => b.owner === null).length
  return {
    heldBlocks,
    freeBlocks,
    usedSlots,
    // Reserved capacity that currently holds nothing.
    wastedSlots: heldSlots - usedSlots,
    efficiency: heldSlots === 0 ? 100 : (usedSlots / heldSlots) * 100,
    largestFreeRun: longestFreeRun(s.blocks),
  }
}
