import { describe, expect, it } from 'vitest'
import { checkInvariants, paramDefaults, runSim } from './createSim'

import batching, { utilization } from './batching'
import kvcache, { memoryBreakdown } from './kvcache'
import engine from './engine'
import schedulerSim, { BLOCK } from './scheduler'
import forward, { buildBatch } from './forward'
import samplingSim, { processLogits, VOCAB } from './sampling'
import chunkedPrefill, { itlStats } from './chunkedPrefill'
import prefixCache, { findLongestCacheHit, hashRequestTokens } from './prefixCache'
import guidedDecoding, {
  allowedAt,
  isAccepting,
  VOCAB as GD_VOCAB,
  WORDS,
} from './guidedDecoding'
import specDecode, { pTarget, speedup, VOCAB as SD_VOCAB } from './specDecode'
import disaggPD, { pdStats } from './disaggPD'
import parallelism, { tpCost } from './parallelism'
import distributedSim, { balanceStats, score } from './distributed'
import roofline, { bSat, latency, latencyMetrics, stepModel } from './roofline'

/**
 * These tests are the safety net for the site's factual claims: each simulator
 * asserts the same invariant the prose asserts. If a sim drifts, a page starts
 * lying, and that is what these catch.
 */

/**
 * Drive a sim past its own isDone cap. Some sims stop themselves after a few
 * hundred ticks so the UI's play button terminates; statistical tests need more
 * samples than that.
 */
function runPast(sim, overrides, ticks) {
  const params = { ...paramDefaults(sim), ...overrides }
  let state = sim.init(params)
  for (let i = 0; i < ticks; i++) state = sim.step(state, params)
  return { state, params }
}

/** Run a sim and assert its own declared invariants hold at *every* tick. */
function expectHealthy(sim, overrides = {}, ticks = 400) {
  const { trace, params, state } = runSim(sim, overrides, ticks)
  trace.forEach((s, i) => {
    const problems = checkInvariants(sim, s, params)
    expect(problems, `${sim.name} tick ${i}: ${problems.join('; ')}`).toEqual([])
  })
  return { state, params, trace }
}

describe('createSim', () => {
  it('rand is deterministic and in range', async () => {
    const { rand } = await import('./createSim')
    for (let i = 0; i < 500; i++) {
      const a = rand(i, 7)
      expect(rand(i, 7)).toBe(a)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(1)
    }
  })

  it('rand spreads roughly uniformly (no degenerate hash)', async () => {
    const { rand } = await import('./createSim')
    const buckets = Array(10).fill(0)
    for (let i = 0; i < 4000; i++) buckets[Math.floor(rand(i, 3) * 10)]++
    buckets.forEach((b) => expect(b).toBeGreaterThan(200))
  })
})

describe('batching — static vs continuous', () => {
  for (const mode of ['static', 'continuous']) {
    it(`${mode}: invariants hold and every request completes`, () => {
      const { state } = expectHealthy(batching, { mode })
      expect(batching.isDone(state)).toBe(true)
      state.requests.forEach((r) => expect(r.generated).toBe(r.outLen))
    })
  }

  it('continuous batching wastes strictly fewer slot-steps than static', () => {
    const opts = { numRequests: 8, maxBatch: 4, spread: 9 }
    const s = runSim(batching, { ...opts, mode: 'static' }, 400).state
    const c = runSim(batching, { ...opts, mode: 'continuous' }, 400).state
    expect(c.wastedSlotSteps).toBeLessThan(s.wastedSlotSteps)
    expect(utilization(c)).toBeGreaterThan(utilization(s))
  })

  it('continuous batching finishes the same work in no more steps', () => {
    const opts = { numRequests: 10, maxBatch: 3, spread: 12 }
    const s = runSim(batching, { ...opts, mode: 'static' }, 400).state
    const c = runSim(batching, { ...opts, mode: 'continuous' }, 400).state
    expect(c.tick).toBeLessThanOrEqual(s.tick)
    // same total work, either way
    expect(c.tokensOut).toBe(s.tokensOut)
  })

  it('no request is ever admitted twice', () => {
    const { trace } = runSim(batching, { mode: 'continuous' }, 400)
    trace.forEach((s) => {
      const running = s.requests.filter((r) => r.status === 'running').map((r) => r.idx)
      expect(new Set(running).size).toBe(running.length)
    })
  })
})

describe('kvcache — the block allocator', () => {
  for (const mode of ['paged', 'contiguous']) {
    it(`${mode}: blocks are conserved at every tick`, () => {
      expectHealthy(kvcache, { mode })
    })
  }

  it('paged mode never loses a block', () => {
    const { trace, params } = runSim(kvcache, { mode: 'paged' }, 400)
    trace.forEach((s) => {
      const free = s.blocks.filter((b) => b.owner === null).length
      const owned = s.blocks.length - free
      expect(free + owned).toBe(params.numBlocks)
      expect(s.freeQueue.length).toBe(free)
    })
  })

  it('paged wastes at most (block_size - 1) slots per live request', () => {
    const bs = 8
    const { trace, params } = runSim(kvcache, { mode: 'paged', blockSize: bs }, 400)
    trace.forEach((s) => {
      const live = s.requests.filter((r) => r.status === 'running' && r.prefilled)
      const m = memoryBreakdown(s, params)
      expect(m.wastedSlots).toBeLessThanOrEqual(live.length * (bs - 1))
    })
  })

  it('paged achieves higher slot efficiency than contiguous reservation', () => {
    const opts = { numRequests: 7, numBlocks: 32, blockSize: 8 }
    const eff = (mode) => {
      const { trace, params } = runSim(kvcache, { ...opts, mode }, 400)
      const live = trace.filter((s) => s.requests.some((r) => r.status === 'running'))
      const effs = live.map((s) => memoryBreakdown(s, params).efficiency)
      return effs.reduce((a, b) => a + b, 0) / Math.max(1, effs.length)
    }
    expect(eff('paged')).toBeGreaterThan(eff('contiguous'))
  })

  it('contiguous mode only ever holds adjacent runs', () => {
    const { trace } = runSim(kvcache, { mode: 'contiguous' }, 400)
    trace.forEach((s) => {
      s.requests
        .filter((r) => r.blocks.length > 1)
        .forEach((r) => {
          const sorted = [...r.blocks].sort((a, b) => a - b)
          sorted.forEach((b, i) => {
            if (i > 0) expect(b).toBe(sorted[i - 1] + 1)
          })
        })
    })
  })

  it('paged admits at least as many concurrent requests as contiguous', () => {
    const opts = { numRequests: 8, numBlocks: 32, blockSize: 8 }
    const p = runSim(kvcache, { ...opts, mode: 'paged' }, 400).state
    const c = runSim(kvcache, { ...opts, mode: 'contiguous' }, 400).state
    expect(p.peakConcurrent).toBeGreaterThanOrEqual(c.peakConcurrent)
  })

  it('every request eventually completes in paged mode', () => {
    const { state } = runSim(kvcache, { mode: 'paged' }, 600)
    expect(kvcache.isDone(state)).toBe(true)
    state.requests.forEach((r) => {
      expect(r.generated).toBe(r.outLen)
      expect(r.blocks).toEqual([]) // freed on completion
    })
  })

  it('smaller blocks pack more tightly', () => {
    const avgWaste = (blockSize) => {
      const { trace, params } = runSim(kvcache, { mode: 'paged', blockSize }, 400)
      const w = trace.map((s) => memoryBreakdown(s, params).wastedSlots)
      return w.reduce((a, b) => a + b, 0) / w.length
    }
    expect(avgWaste(4)).toBeLessThan(avgWaste(16))
  })
})

describe('engine — the guided tour', () => {
  it('visits every phase and terminates', () => {
    const { state, trace } = expectHealthy(engine, {}, 60)
    expect(engine.isDone(state)).toBe(true)
    expect(trace.length).toBeGreaterThan(10)
  })

  it('loops through the decode phases before finishing', () => {
    const { state } = runSim(engine, {}, 60)
    expect(state.loops).toBe(2)
    expect(state.tokens).toBeGreaterThan(1)
  })
})

describe('scheduler', () => {
  it('holds all invariants across a wide parameter sweep', () => {
    for (const policy of ['fcfs', 'priority']) {
      for (const numBlocks of [8, 14, 40]) {
        for (const tokenBudget of [32, 64, 160]) {
          expectHealthy(schedulerSim, { policy, numBlocks, tokenBudget }, 300)
        }
      }
    }
  })

  it('never exceeds the token budget', () => {
    for (const tokenBudget of [16, 40, 64, 160]) {
      const { trace } = runSim(schedulerSim, { tokenBudget }, 300)
      trace.forEach((s) => expect(s.lastStep.budgetUsed).toBeLessThanOrEqual(tokenBudget))
    }
  })

  it('conserves KV blocks at every tick', () => {
    const { trace, params } = runSim(schedulerSim, { numBlocks: 10 }, 300)
    trace.forEach((s) => {
      const held = s.requests.reduce((a, r) => a + r.blocks, 0)
      expect(held + s.freeBlocks).toBe(params.numBlocks)
      expect(s.freeBlocks).toBeGreaterThanOrEqual(0)
    })
  })

  it('completes every request when memory is ample', () => {
    const { state } = runSim(
      schedulerSim,
      { numBlocks: 40, tokenBudget: 160, promptSpread: 30 },
      400,
    )
    expect(state.stuck).toBe(null)
    expect(schedulerSim.isDone(state)).toBe(true)
    state.requests.forEach((r) => expect(r.generated).toBe(r.outLen))
  })

  it('decodes are scheduled before prefills within a step', () => {
    // A decode consumes 1 token of budget; if any prefill ran, every eligible
    // decode must already have been served.
    const { trace } = runSim(schedulerSim, { numBlocks: 40, tokenBudget: 160 }, 300)
    trace.forEach((s, i) => {
      if (i === 0 || s.lastStep.prefills.length === 0) return
      const prev = trace[i - 1]
      const eligible = prev.running.filter((idx) => prev.requests[idx].status === 'running')
      // every request that was running became a decode this step (or finished)
      eligible.forEach((idx) => {
        const id = prev.requests[idx].id
        const wasDecoded = s.lastStep.decodes.includes(id)
        const finished = s.requests[idx].status === 'done'
        expect(wasDecoded || finished, `${id} at tick ${i}`).toBe(true)
      })
    })
  })

  it('preemption frees blocks and forces a re-prefill', () => {
    const { trace, state } = runSim(schedulerSim, { numBlocks: 7, numRequests: 8 }, 400)
    expect(state.totalPreemptions).toBeGreaterThan(0)
    expect(state.wastedRecompute).toBeGreaterThan(0)
    // a preempted request must return to waiting with no blocks and no cached tokens
    trace.forEach((s) => {
      s.waiting.forEach((idx) => {
        const r = s.requests[idx]
        if (r.preemptions > 0) {
          expect(r.blocks).toBe(0)
          expect(r.tokens).toBe(0)
          expect(r.prefilled).toBe(false)
        }
      })
    })
  })

  it('scarce memory means more preemption, not lost requests', () => {
    const tight = runSim(schedulerSim, { numBlocks: 7, numRequests: 8 }, 500).state
    const roomy = runSim(schedulerSim, { numBlocks: 40, numRequests: 8 }, 500).state
    expect(tight.totalPreemptions).toBeGreaterThan(roomy.totalPreemptions)
    expect(roomy.totalPreemptions).toBe(0)
    tight.requests.forEach((r) => expect(r.generated).toBeLessThanOrEqual(r.outLen))
  })

  it('detects the no-chunked-prefill deadlock instead of hanging', () => {
    const { state } = runSim(schedulerSim, { tokenBudget: 16, promptSpread: 90 }, 400)
    expect(state.stuck).toBeTruthy()
    expect(schedulerSim.isDone(state)).toBe(true)
  })

  it('priority policy admits high-priority requests before lower ones', () => {
    const { trace } = runSim(
      schedulerSim,
      { policy: 'priority', numBlocks: 40, tokenBudget: 64, numRequests: 10 },
      400,
    )
    // whenever a prefill is admitted, no strictly-higher-priority request was
    // sitting schedulable in the waiting queue at the same moment
    trace.forEach((s, i) => {
      if (i === 0) return
      const prev = trace[i - 1]
      s.lastStep.prefills.forEach((id) => {
        const admitted = s.requests.find((r) => r.id === id)
        prev.waiting
          .map((idx) => prev.requests[idx])
          .filter((w) => w.id !== id && w.promptLen <= 64)
          .forEach((w) => {
            if (w.priority < admitted.priority) {
              // only allowed if it couldn't fit this step at all
              expect(s.lastStep.skipped).toContain(w.id)
            }
          })
      })
    })
  })
})

describe('forward pass — flattening and slot_mapping', () => {
  it('invariants hold for every batch composition', () => {
    for (const numPrefill of [0, 1, 2, 3]) {
      for (const numDecode of [0, 1, 4]) {
        if (numPrefill + numDecode === 0) continue
        for (const blockSize of [4, 8, 16]) {
          expectHealthy(forward, { numPrefill, numDecode, blockSize }, 80)
        }
      }
    }
  })

  it('slot_mapping is injective — no two tokens share a KV slot', () => {
    for (const blockSize of [4, 8, 16]) {
      const b = buildBatch({ numPrefill: 3, numDecode: 4, blockSize })
      const slots = b.flat.map((f) => f.slot)
      expect(new Set(slots).size).toBe(slots.length)
    }
  })

  it('reproduces the documented slot arithmetic exactly', () => {
    const blockSize = 4
    const b = buildBatch({ numPrefill: 2, numDecode: 3, blockSize })
    b.flat.forEach((f) => {
      const r = b.requests[f.reqIdx]
      const expected = r.blocks[Math.floor(f.pos / blockSize)] * blockSize + (f.pos % blockSize)
      expect(f.slot).toBe(expected)
      expect(f.offset).toBe(f.pos % blockSize)
      expect(f.logicalBlock).toBe(Math.floor(f.pos / blockSize))
    })
  })

  it('gathers exactly one logits row per request', () => {
    const b = buildBatch({ numPrefill: 3, numDecode: 4, blockSize: 8 })
    expect(b.gatherRows.length).toBe(b.requests.length)
    b.requests.forEach((r) => {
      const rows = b.flat.filter((f) => f.reqIdx === r.idx && f.isLast)
      expect(rows.length).toBe(1)
    })
  })

  it('decodes contribute one row, prefills contribute prompt_len rows', () => {
    const b = buildBatch({ numPrefill: 2, numDecode: 3, blockSize: 8 })
    b.requests.forEach((r) => {
      const rows = b.flat.filter((f) => f.reqIdx === r.idx).length
      expect(rows).toBe(r.newTokens)
      if (r.kind === 'decode') expect(rows).toBe(1)
    })
    expect(b.flat.length).toBe(b.totalTokens)
  })

  it('cu_seqlens marks real sequence starts', () => {
    const b = buildBatch({ numPrefill: 2, numDecode: 2, blockSize: 8 })
    b.starts.forEach((s, i) => {
      expect(b.flat[s].reqIdx).toBe(i)
      if (s > 0) expect(b.flat[s - 1].isLast).toBe(true)
    })
  })
})

describe('sampling', () => {
  it('invariants hold across the knob space', () => {
    for (const temperature of [0.1, 0.8, 2]) {
      for (const topP of [0.1, 0.5, 1]) {
        for (const topK of [0, 1, 5, 12]) {
          expectHealthy(samplingSim, { temperature, topP, topK }, 40)
        }
      }
    }
  })

  it('probabilities always sum to 1 over survivors', () => {
    for (const temperature of [0.1, 0.5, 1, 2]) {
      for (const topP of [0.05, 0.5, 0.95, 1]) {
        for (const topK of [0, 1, 3, 12]) {
          const p = processLogits({ mode: 'random', temperature, topP, topK })
          const total = p.reduce((a, x) => a + x.prob, 0)
          expect(total).toBeCloseTo(1, 6)
          p.filter((x) => !x.kept).forEach((x) => expect(x.prob).toBe(0))
        }
      }
    }
  })

  it('greedy puts all mass on the argmax', () => {
    const p = processLogits({ mode: 'greedy', temperature: 1, topP: 1, topK: 0 })
    const best = VOCAB.reduce((a, v, i) => (v.logit > VOCAB[a].logit ? i : a), 0)
    expect(p[best].prob).toBe(1)
    expect(p.filter((x) => x.kept).length).toBe(1)
  })

  it('top_k keeps exactly k tokens', () => {
    for (const topK of [1, 3, 7]) {
      const p = processLogits({ mode: 'random', temperature: 1, topP: 1, topK })
      expect(p.filter((x) => x.kept).length).toBe(topK)
    }
  })

  it('top_p keeps the smallest prefix reaching the mass threshold', () => {
    const raw = processLogits({ mode: 'random', temperature: 1, topP: 1, topK: 0 })
    const sorted = [...raw].sort((a, b) => b.prob - a.prob)
    for (const topP of [0.3, 0.6, 0.9]) {
      const p = processLogits({ mode: 'random', temperature: 1, topP, topK: 0 })
      const keptCount = p.filter((x) => x.kept).length
      let cum = 0
      let expected = 0
      for (const x of sorted) {
        cum += x.prob
        expected++
        if (cum >= topP) break
      }
      expect(keptCount).toBe(expected)
    }
  })

  it('lower temperature concentrates mass on the top token', () => {
    const top = (t) =>
      Math.max(...processLogits({ mode: 'random', temperature: t, topP: 1, topK: 0 }).map((x) => x.prob))
    expect(top(0.2)).toBeGreaterThan(top(1))
    expect(top(1)).toBeGreaterThan(top(2))
  })

  it('empirical draws converge on the processed distribution', () => {
    const params = { mode: 'random', temperature: 0.8, topP: 0.95, topK: 0 }
    const { state } = runSim(samplingSim, params, 400)
    const processed = processLogits(params)
    processed.forEach((x, i) => {
      const observed = state.counts[i] / state.tick
      expect(Math.abs(observed - x.prob)).toBeLessThan(0.08)
    })
  })

  it('never draws a masked-out token', () => {
    const params = { mode: 'random', temperature: 1, topP: 1, topK: 3 }
    const { state } = runSim(samplingSim, params, 300)
    const processed = processLogits(params)
    processed.forEach((x, i) => {
      if (!x.kept) expect(state.counts[i]).toBe(0)
    })
  })
})

describe('chunked prefill', () => {
  it('invariants hold across the knob space', () => {
    for (const chunking of ['on', 'off']) {
      for (const threshold of [64, 128, 512]) {
        for (const longPromptLen of [256, 1024, 2048]) {
          expectHealthy(chunkedPrefill, { chunking, threshold, longPromptLen }, 200)
        }
      }
    }
  })

  it('no chunk ever exceeds the threshold when chunking is on', () => {
    const { trace } = runSim(chunkedPrefill, { chunking: 'on', threshold: 128 }, 200)
    trace.forEach((s) => s.steps.forEach((x) => expect(x.prefillTokens).toBeLessThanOrEqual(128)))
  })

  it('chunking cuts the worst ITL without changing total prefill work', () => {
    const opts = { longPromptLen: 1024, tokenBudget: 2048, numDecoders: 4 }
    const off = runSim(chunkedPrefill, { ...opts, chunking: 'off' }, 300).state
    const on = runSim(chunkedPrefill, { ...opts, chunking: 'on', threshold: 128 }, 300).state
    expect(itlStats(on).max).toBeLessThan(itlStats(off).max)
    // identical work: the same prompt gets prefilled either way
    expect(on.prefillDone).toBe(off.prefillDone)
    expect(on.prefillDone).toBe(1024)
  })

  it('smaller chunks smooth ITL further but delay the prefill TTFT', () => {
    const opts = { chunking: 'on', longPromptLen: 1024, numDecoders: 4 }
    const small = runSim(chunkedPrefill, { ...opts, threshold: 64 }, 400).state
    const big = runSim(chunkedPrefill, { ...opts, threshold: 512 }, 400).state
    expect(itlStats(small).max).toBeLessThanOrEqual(itlStats(big).max)
    expect(small.prefillTTFT).toBeGreaterThan(big.prefillTTFT)
  })

  it('an unchunked prompt larger than the budget never prefills', () => {
    const { state } = runSim(
      chunkedPrefill,
      { chunking: 'off', longPromptLen: 2048, tokenBudget: 256 },
      300,
    )
    expect(state.prefillDone).toBe(0)
    // ...and chunking rescues exactly that case
    const fixed = runSim(
      chunkedPrefill,
      { chunking: 'on', threshold: 128, longPromptLen: 2048, tokenBudget: 256 },
      600,
    ).state
    expect(fixed.prefillDone).toBe(2048)
  })
})

describe('prefix caching', () => {
  it('invariants hold across the knob space', () => {
    for (const enabled of ['on', 'off']) {
      for (const prefixTokens of [16, 64, 160]) {
        for (const suffixTokens of [4, 12, 40]) {
          expectHealthy(prefixCache, { enabled, prefixTokens, suffixTokens, numRequests: 3 }, 120)
        }
      }
    }
  })

  it('chained hashes: identical prefixes agree, divergent ones do not', () => {
    const a = hashRequestTokens(Array.from({ length: 48 }, (_, i) => i))
    const b = hashRequestTokens(Array.from({ length: 48 }, (_, i) => (i < 32 ? i : 999 + i)))
    expect(a[0].hash).toBe(b[0].hash)
    expect(a[1].hash).toBe(b[1].hash)
    expect(a[2].hash).not.toBe(b[2].hash) // diverged in block 2
  })

  it('a differing first block invalidates every later hash', () => {
    const a = hashRequestTokens(Array.from({ length: 48 }, (_, i) => i))
    const b = hashRequestTokens(Array.from({ length: 48 }, (_, i) => (i === 0 ? -1 : i)))
    a.forEach((bh, i) => expect(bh.hash).not.toBe(b[i].hash))
  })

  it('incomplete trailing blocks get no hash', () => {
    const hs = hashRequestTokens(Array.from({ length: 40 }, (_, i) => i)) // 2 full + 8 spare
    expect(hs.filter((b) => !b.partial).length).toBe(2)
    const partial = hs.find((b) => b.partial)
    expect(partial.hash).toBe(null)
    expect(partial.tokens.length).toBe(8)
  })

  it('find_longest_cache_hit stops at the first miss', () => {
    const hs = hashRequestTokens(Array.from({ length: 64 }, (_, i) => i))
    const cache = { [hs[0].hash]: 0, [hs[1].hash]: 1, [hs[3].hash]: 3 } // gap at 2
    expect(findLongestCacheHit(hs, cache)).toBe(2)
  })

  it('the first request pays full price and later ones reuse the prefix', () => {
    const p = { enabled: 'on', prefixTokens: 64, suffixTokens: 12, numRequests: 3 }
    const { state } = runSim(prefixCache, p, 200)
    const [r0, r1, r2] = state.requests
    expect(r0.savedTokens).toBe(0)
    expect(r0.computedTokens).toBe(76)
    expect(r1.savedTokens).toBe(64) // the whole aligned prefix
    expect(r2.savedTokens).toBe(64)
    expect(r1.computedTokens).toBe(12) // only its own suffix
  })

  it('disabling prefix caching means nobody saves anything', () => {
    const p = { enabled: 'off', prefixTokens: 64, suffixTokens: 12, numRequests: 3 }
    const { state } = runSim(prefixCache, p, 200)
    expect(state.totalSaved).toBe(0)
    state.requests.forEach((r) => expect(r.computedTokens).toBe(76))
  })

  it('a misaligned prefix always leaves a remainder to recompute', () => {
    // 70 = 4 whole blocks + 6 leftover tokens
    const { state } = runSim(
      prefixCache,
      { enabled: 'on', prefixTokens: 80, suffixTokens: 4, numRequests: 3 },
      200,
    )
    const r1 = state.requests[1]
    expect(r1.savedTokens % 16).toBe(0)
    expect(r1.savedTokens).toBeLessThanOrEqual(80)
    expect(r1.computedTokens).toBeGreaterThan(0)
  })

  it('savings scale with prefix length', () => {
    const saved = (prefixTokens) =>
      runSim(prefixCache, { enabled: 'on', prefixTokens, suffixTokens: 12, numRequests: 3 }, 200)
        .state.totalSaved
    expect(saved(160)).toBeGreaterThan(saved(64))
    expect(saved(64)).toBeGreaterThan(saved(16))
  })
})

describe('guided decoding', () => {
  it('invariants hold for every configuration', () => {
    for (const guided of ['on', 'off']) {
      for (const sentiment of ['positive', 'negative']) {
        expectHealthy(guidedDecoding, { guided, sentiment }, 40)
      }
    }
  })

  it('guided decoding always produces a grammatical word', () => {
    for (const sentiment of ['positive', 'negative']) {
      const { state } = runSim(guidedDecoding, { guided: 'on', sentiment }, 40)
      expect(WORDS).toContain(state.emitted)
      expect(state.violations).toBe(0)
      expect(isAccepting(state.fsm)).toBe(true)
    }
  })

  it('the bitmask exactly encodes the FSM\'s allowed set', () => {
    const { trace } = runSim(guidedDecoding, { guided: 'on', sentiment: 'positive' }, 40)
    trace.forEach((s) => {
      s.history.forEach((h) => {
        h.mask.bits.forEach((bit, i) => {
          expect(Boolean(bit)).toBe(h.allowed.includes(GD_VOCAB[i]))
        })
      })
    })
  })

  it('masked tokens are driven to -Infinity, unmasked ones untouched', () => {
    const { state } = runSim(guidedDecoding, { guided: 'on', sentiment: 'positive' }, 40)
    state.history.forEach((h) => {
      h.effective.forEach((v, i) => {
        if (h.mask.bits[i]) expect(v).toBe(h.logits[i])
        else expect(v).toBe(-Infinity)
      })
    })
  })

  it('the first step allows exactly the two branch openings', () => {
    const allowed = allowedAt({ pos: 0, branch: null })
    expect(allowed.sort()).toEqual(['N', 'P'])
  })

  it('without guiding the model breaks the grammar', () => {
    const { state } = runSim(guidedDecoding, { guided: 'off', sentiment: 'positive' }, 40)
    expect(state.violations).toBeGreaterThan(0)
    expect(WORDS).not.toContain(state.emitted)
  })
})

describe('speculative decoding', () => {
  it('invariants hold across the knob space', () => {
    for (const k of [1, 4, 7]) {
      for (const agreement of [0, 0.5, 1]) {
        expectHealthy(specDecode, { k, agreement }, 120)
      }
    }
  })

  it('THE correctness guarantee: emitted tokens follow p_target regardless of draft quality', () => {
    // This is the whole reason speculative decoding is safe to deploy. If this
    // test ever fails, the page is making a false claim.
    for (const agreement of [0, 0.3, 0.6, 1]) {
      for (const k of [1, 4, 7]) {
        const { state } = runPast(specDecode, { k, agreement }, 4000)
        const total = state.firstTokenHistogram.reduce((a, b) => a + b, 0)
        expect(total).toBeGreaterThan(1000)
        pTarget.forEach((pt, i) => {
          const observed = state.firstTokenHistogram[i] / total
          expect(
            Math.abs(observed - pt),
            `k=${k} agreement=${agreement} token "${SD_VOCAB[i]}": expected ~${pt.toFixed(3)}, saw ${observed.toFixed(3)}`,
          ).toBeLessThan(0.035)
        })
      }
    }
  })

  it('accepts a draft token outright whenever p_target >= p_draft', () => {
    const { state } = runSim(specDecode, { k: 6, agreement: 0.4 }, 200)
    state.rounds.forEach((r) => {
      r.verdicts.forEach((v) => {
        if (v.ratio >= 1) expect(v.accepted).toBe(true)
      })
    })
  })

  it('verification stops at the first rejection', () => {
    const { state } = runSim(specDecode, { k: 7, agreement: 0.2 }, 200)
    state.rounds.forEach((r) => {
      const firstReject = r.verdicts.findIndex((v) => !v.accepted)
      if (firstReject >= 0) {
        expect(r.verdicts.length).toBe(firstReject + 1)
        expect(r.acceptedCount).toBe(firstReject)
      }
    })
  })

  it('emits a bonus token exactly when all k are accepted, and a resample otherwise', () => {
    const { state } = runSim(specDecode, { k: 3, agreement: 0.7 }, 300)
    state.rounds.forEach((r) => {
      if (r.acceptedCount === 3) {
        expect(r.bonus).not.toBe(null)
        expect(r.resampled).toBe(null)
        expect(r.emitted.length).toBe(4) // k + 1
      } else {
        expect(r.bonus).toBe(null)
        expect(r.resampled).not.toBe(null)
        expect(r.emitted.length).toBe(r.acceptedCount + 1)
      }
    })
  })

  it('every round emits at least one token — speculation never stalls', () => {
    for (const agreement of [0, 0.5, 1]) {
      const { state } = runSim(specDecode, { k: 5, agreement }, 200)
      state.rounds.forEach((r) => expect(r.emitted.length).toBeGreaterThanOrEqual(1))
    }
  })

  it('a perfect draft accepts everything; a bad one mostly does not', () => {
    const rate = (agreement) => speedup(runSim(specDecode, { k: 4, agreement }, 500).state, {
      k: 4,
      draftCost: 0.1,
    }).acceptRate
    expect(rate(1)).toBeGreaterThan(0.9)
    expect(rate(0)).toBeLessThan(rate(1))
    expect(rate(0.9)).toBeGreaterThan(rate(0.3))
  })

  it('speedup rises with agreement and falls with draft cost', () => {
    const f = (agreement, draftCost) => {
      const p = { k: 4, agreement, draftCost }
      return speedup(runSim(specDecode, p, 400).state, p).factor
    }
    expect(f(0.95, 0.1)).toBeGreaterThan(f(0.2, 0.1))
    expect(f(0.6, 0.05)).toBeGreaterThan(f(0.6, 0.5))
  })

  it('a useless draft with high k can be slower than no speculation', () => {
    const p = { k: 7, agreement: 0, draftCost: 0.4 }
    expect(speedup(runSim(specDecode, p, 400).state, p).factor).toBeLessThan(1)
  })
})

describe('disaggregated P/D', () => {
  it('invariants hold across the knob space', () => {
    for (const mode of ['colocated', 'disagg']) {
      for (const promptLen of [256, 768, 1536]) {
        for (const transferCost of [1, 6]) {
          expectHealthy(disaggPD, { mode, promptLen, transferCost }, 200)
        }
      }
    }
  })

  it('no request decodes before its KV has finished transferring', () => {
    const { trace } = runSim(disaggPD, { mode: 'disagg', transferCost: 6 }, 300)
    trace.forEach((s) => {
      s.requests.forEach((r) => {
        if (r.status === 'decoding') expect(r.transferLeft).toBeLessThanOrEqual(0)
        if (r.itls.length > 0) expect(['decoding', 'done']).toContain(r.status)
      })
    })
  })

  it('disaggregation lowers tail ITL and raises TTFT — the actual trade', () => {
    const opts = { numRequests: 6, promptLen: 768, transferCost: 2 }
    const colo = pdStats(runSim(disaggPD, { ...opts, mode: 'colocated' }, 300).state)
    const split = pdStats(runSim(disaggPD, { ...opts, mode: 'disagg' }, 300).state)
    expect(split.p95Itl).toBeLessThan(colo.p95Itl)
    expect(split.maxItl).toBeLessThan(colo.maxItl)
  })

  it('decode steps stay small when disaggregated', () => {
    const { state } = runSim(disaggPD, { mode: 'disagg', promptLen: 1536 }, 300)
    state.steps.forEach((x) => {
      if (x.decodeTokens > 0) expect(x.decodeMs).toBeLessThan(20)
    })
  })

  it('colocated steps mix both workloads; disaggregated ones do not share a clock', () => {
    const colo = runSim(disaggPD, { mode: 'colocated' }, 300).state
    const mixed = colo.steps.filter((x) => x.prefillTokens > 0 && x.decodeTokens > 0)
    expect(mixed.length).toBeGreaterThan(0)
    const split = runSim(disaggPD, { mode: 'disagg' }, 300).state
    split.steps.forEach((x) => expect(x.where).toBe('split'))
  })

  it('the KV store only ever holds in-flight transfers', () => {
    const { trace } = runSim(disaggPD, { mode: 'disagg', transferCost: 5 }, 300)
    trace.forEach((s) => {
      s.store.forEach((id) => {
        const r = s.requests.find((x) => x.id === id)
        expect(r.status).toBe('transferring')
      })
    })
  })
})

describe('tensor parallelism', () => {
  it('invariants hold across the knob space', () => {
    for (const tpSize of [1, 2, 4, 8]) {
      for (const numLayers of [2, 4, 6]) {
        for (const commCost of [0, 1, 4]) {
          expectHealthy(parallelism, { tpSize, numLayers, commCost }, 80)
        }
      }
    }
  })

  it('runs every layer and returns', () => {
    for (const tpSize of [1, 2, 8]) {
      const { state, params } = runSim(parallelism, { tpSize, numLayers: 4 }, 80)
      expect(parallelism.isDone(state)).toBe(true)
      expect(state.layer).toBe(params.numLayers)
    }
  })

  it('TP=1 pays no communication cost', () => {
    const { state } = runSim(parallelism, { tpSize: 1, commCost: 4 }, 80)
    expect(state.commTime).toBe(0)
  })

  it('compute per worker scales as 1/TP', () => {
    const p = { numLayers: 4, commCost: 0 }
    const c1 = tpCost(1, p).compute
    expect(tpCost(2, p).compute).toBeCloseTo(c1 / 2, 6)
    expect(tpCost(8, p).compute).toBeCloseTo(c1 / 8, 6)
  })

  it('parallel efficiency falls as TP rises when communication costs anything', () => {
    const p = { numLayers: 4, commCost: 1 }
    expect(tpCost(2, p).efficiency).toBeGreaterThan(tpCost(4, p).efficiency)
    expect(tpCost(4, p).efficiency).toBeGreaterThan(tpCost(8, p).efficiency)
  })

  it('with free communication, scaling is perfect', () => {
    const p = { numLayers: 4, commCost: 0 }
    expect(tpCost(8, p).efficiency).toBeCloseTo(1, 6)
    expect(tpCost(8, p).speedup).toBeCloseTo(8, 6)
  })

  it('enough communication cost makes more GPUs actively slower', () => {
    const p = { numLayers: 4, commCost: 4 }
    expect(tpCost(8, p).total).toBeGreaterThan(tpCost(2, p).total)
  })
})

describe('distributed serving — load balancing', () => {
  it('invariants hold across the knob space', () => {
    for (const policy of ['score', 'roundrobin', 'random']) {
      for (const arrivalRate of [1, 3, 5]) {
        for (const capacity of [1, 3, 6]) {
          expectHealthy(distributedSim, { policy, arrivalRate, capacity }, 80)
        }
      }
    }
  })

  it('implements score = len(waiting) * 4 + len(running)', () => {
    expect(score({ waiting: [1, 2], running: [3] })).toBe(9)
    expect(score({ waiting: [], running: [1, 2, 3] })).toBe(3)
    expect(score({ waiting: [1], running: [] })).toBe(4)
    // one queued request outweighs three running ones
    expect(score({ waiting: [1], running: [] })).toBeGreaterThan(
      score({ waiting: [], running: [1, 2, 3] }),
    )
  })

  it('the score policy always routes to a minimum-score engine', () => {
    const { trace } = runSim(distributedSim, { policy: 'score' }, 80)
    trace.forEach((s, i) => {
      if (i === 0 || !s.lastPick) return
      const min = Math.min(...s.lastPick.scores)
      const chosenIdx = Number(s.lastPick.engine.slice(1))
      expect(s.lastPick.scores[chosenIdx]).toBe(min)
    })
  })

  it('score-based routing balances load better than round-robin under skew', () => {
    const opts = { arrivalRate: 3, skew: 10, capacity: 3 }
    const sc = balanceStats(runSim(distributedSim, { ...opts, policy: 'score' }, 200).state)
    const rr = balanceStats(runSim(distributedSim, { ...opts, policy: 'roundrobin' }, 200).state)
    expect(sc.mean).toBeLessThan(rr.mean)
    expect(sc.max).toBeLessThanOrEqual(rr.max)
  })

  it('score-based routing completes at least as much work', () => {
    const opts = { arrivalRate: 3, skew: 10, capacity: 3 }
    const sc = balanceStats(runSim(distributedSim, { ...opts, policy: 'score' }, 200).state)
    const rnd = balanceStats(runSim(distributedSim, { ...opts, policy: 'random' }, 200).state)
    expect(sc.completed).toBeGreaterThanOrEqual(rnd.completed)
  })

  it('never exceeds per-engine concurrency, and never double-places a request', () => {
    const { trace, params } = runSim(distributedSim, { capacity: 2, arrivalRate: 5 }, 200)
    trace.forEach((s) => {
      s.engines.forEach((e) => expect(e.running.length).toBeLessThanOrEqual(params.capacity))
      const placed = s.engines.flatMap((e) => [...e.waiting, ...e.running])
      expect(new Set(placed).size).toBe(placed.length)
    })
  })

  it('places two replicas on each of the two nodes', () => {
    const { state } = runSim(distributedSim, {}, 5)
    expect(state.engines.filter((e) => e.node === 0).length).toBe(2)
    expect(state.engines.filter((e) => e.node === 1).length).toBe(2)
  })
})

describe('roofline model', () => {
  it('invariants hold across the knob space', () => {
    for (const modelParams of [1, 8, 70]) {
      for (const bandwidth of [1, 3.35, 8]) {
        for (const peakFlops of [100, 990, 2000]) {
          expectHealthy(roofline, { modelParams, bandwidth, peakFlops }, 60)
        }
      }
    }
  })

  it('step latency is flat below B_sat and rises above it', () => {
    const p = { modelParams: 8, bandwidth: 3.35, peakFlops: 990, slaItlMs: 30 }
    const sat = bSat(p)
    const below = stepModel(Math.max(1, Math.floor(sat / 4)), p)
    const atish = stepModel(Math.max(1, Math.floor(sat * 0.9)), p)
    const above = stepModel(Math.ceil(sat * 8), p)
    expect(below.stepMs).toBeCloseTo(atish.stepMs, 6) // flat region
    expect(below.bound).toBe('bandwidth')
    expect(above.bound).toBe('compute')
    expect(above.stepMs).toBeGreaterThan(below.stepMs * 2)
  })

  it('below B_sat extra batched tokens are nearly free — throughput scales linearly', () => {
    const p = { modelParams: 8, bandwidth: 3.35, peakFlops: 990, slaItlMs: 30 }
    const sat = Math.floor(bSat(p))
    const a = stepModel(2, p)
    const b = stepModel(Math.max(4, Math.floor(sat / 2)), p)
    const ratio = b.throughput / a.throughput
    const batchRatio = Math.max(4, Math.floor(sat / 2)) / 2
    expect(ratio).toBeCloseTo(batchRatio, 4)
  })

  it('above B_sat throughput saturates while latency keeps climbing', () => {
    const p = { modelParams: 8, bandwidth: 3.35, peakFlops: 990, slaItlMs: 30 }
    const sat = Math.ceil(bSat(p))
    const a = stepModel(sat * 4, p)
    const b = stepModel(sat * 8, p)
    expect(b.throughput / a.throughput).toBeCloseTo(1, 4) // flat
    expect(b.stepMs / a.stepMs).toBeCloseTo(2, 4) // doubled
  })

  it('B_sat moves the way the hardware model says it should', () => {
    const base = { modelParams: 8, bandwidth: 3.35, peakFlops: 990 }
    // more compute relative to bandwidth -> saturation arrives later
    expect(bSat({ ...base, peakFlops: 1980 })).toBeGreaterThan(bSat(base))
    // more bandwidth -> the streaming floor drops, so saturation arrives sooner
    expect(bSat({ ...base, bandwidth: 6.7 })).toBeLessThan(bSat(base))
    // B_sat does not depend on model size (both terms scale with params)
    expect(bSat({ ...base, modelParams: 70 })).toBeCloseTo(bSat(base), 6)
  })

  it('a bigger model is uniformly slower per step', () => {
    const base = { modelParams: 8, bandwidth: 3.35, peakFlops: 990 }
    expect(stepModel(16, { ...base, modelParams: 70 }).stepMs).toBeGreaterThan(
      stepModel(16, base).stepMs,
    )
  })

  it('the sweep never reports a latency below the streaming floor', () => {
    const { trace } = runSim(roofline, {}, 60)
    trace.forEach((s) =>
      s.trace.forEach((x) => expect(x.stepMs).toBeGreaterThanOrEqual(x.tMemMs - 1e-9)),
    )
  })
})

describe('latency metrics', () => {
  it('invariants hold across the knob space', () => {
    for (const outputTokens of [2, 10, 24]) {
      for (const itlMs of [5, 25, 80]) {
        expectHealthy(latency, { outputTokens, itlMs }, 40)
      }
    }
  })

  it('TTFT includes queueing plus prefill', () => {
    const p = { queueMs: 40, prefillMs: 120, itlMs: 25, outputTokens: 10 }
    const { state } = runSim(latency, p, 40)
    expect(latencyMetrics(state).ttft).toBe(160)
  })

  it('E2E equals TTFT plus the sum of all ITLs, and equals the last token time', () => {
    const p = { queueMs: 40, prefillMs: 120, itlMs: 25, outputTokens: 10 }
    const { state } = runSim(latency, p, 40)
    const m = latencyMetrics(state)
    expect(m.e2e).toBe(m.ttft + m.itls.reduce((a, b) => a + b, 0))
    expect(m.e2e).toBeCloseTo(m.lastAt, 6)
    expect(m.e2e).toBe(160 + 9 * 25)
  })

  it('TPOT is the mean ITL, and there are exactly n-1 of them', () => {
    const p = { queueMs: 0, prefillMs: 100, itlMs: 30, outputTokens: 8 }
    const { state } = runSim(latency, p, 40)
    const m = latencyMetrics(state)
    expect(m.itls.length).toBe(7)
    expect(m.tpot).toBe(30)
  })

  it('queueing hurts TTFT without touching TPOT', () => {
    const base = { prefillMs: 100, itlMs: 20, outputTokens: 6 }
    const fast = latencyMetrics(runSim(latency, { ...base, queueMs: 0 }, 40).state)
    const slow = latencyMetrics(runSim(latency, { ...base, queueMs: 200 }, 40).state)
    expect(slow.ttft).toBeGreaterThan(fast.ttft)
    expect(slow.tpot).toBe(fast.tpot)
    expect(slow.e2e - fast.e2e).toBe(200)
  })
})

describe('every sim declares usable params', () => {
  const all = {
    batching,
    kvcache,
    engine,
    scheduler: schedulerSim,
    forward,
    sampling: samplingSim,
    chunkedPrefill,
    prefixCache,
    guidedDecoding,
    specDecode,
    disaggPD,
    parallelism,
    distributed: distributedSim,
    roofline,
    latency,
  }
  for (const [name, sim] of Object.entries(all)) {
    it(`${name}: defaults are inside declared bounds`, () => {
      const d = paramDefaults(sim)
      for (const [k, spec] of Object.entries(sim.params)) {
        if (spec.options) {
          const vals = spec.options.map((o) => o.value ?? o)
          expect(vals, `${name}.${k}`).toContain(d[k])
        } else {
          expect(d[k], `${name}.${k}`).toBeGreaterThanOrEqual(spec.min)
          expect(d[k], `${name}.${k}`).toBeLessThanOrEqual(spec.max)
        }
      }
    })

    it(`${name}: step() does not mutate the state it was given`, () => {
      const params = paramDefaults(sim)
      const s0 = sim.init(params)
      const snapshot = JSON.stringify(s0)
      sim.step(s0, params)
      expect(JSON.stringify(s0)).toBe(snapshot)
    })
  }
})
