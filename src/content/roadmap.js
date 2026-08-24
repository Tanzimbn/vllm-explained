/**
 * Single source of truth for the site's structure.
 * Drives the router, the sidebar, prev/next navigation, and the roadmap map page.
 * Stage components are lazy-imported in router.jsx keyed off `slug`.
 */

export const chapters = [
  {
    id: 'ch1',
    handoff: {
      have: 'You know the two workloads, and you can name every part a request passes through.',
      next: 'All of that leaned on a KV cache that simply seemed to exist. Act 02 opens it up — it is the resource that decides how many requests you can hold at once.',
    },
    title: 'Why serving is hard',
    blurb:
      'The two workloads an engine must juggle, and the anatomy of the machine that juggles them.',
  },
  {
    id: 'ch2',
    handoff: {
      have: 'The KV cache is a pool of fixed-size blocks, handed out on demand and handed back when a request ends.',
      next: 'Somebody has to decide who gets blocks, in what order, and what to do when the pool runs dry. That is the scheduler, and Act 03 follows one engine step all the way through it.',
    },
    title: 'Memory',
    blurb: 'Paged attention: the idea that made high-throughput serving possible.',
  },
  {
    id: 'ch3',
    handoff: {
      have: 'You can follow a single engine step end to end: pick who runs, flatten them into one tensor, run the model, sample one token each.',
      next: 'That loop works, but it leaves something on the table in five separate places. Act 04 is five features, each hooking into a step you have already watched.',
    },
    title: 'The loop',
    blurb: 'What actually happens on every single engine step.',
  },
  {
    id: 'ch4',
    handoff: {
      have: 'Five optimizations, each buying a different thing: latency, repeated work, output shape, throughput, and machines that specialise.',
      next: 'Every one of them still assumed the model fits on one GPU. Act 05 is what happens when it does not.',
    },
    title: 'Optimizations',
    blurb: 'Five features layered on top of the core loop, each buying a different thing.',
  },
  {
    id: 'ch5',
    handoff: {
      have: 'The engine now spans GPUs and nodes, and the code above the executor never noticed.',
      next: 'Which leaves the question all of it was for. Act 06 is the numbers that say whether any of this actually worked.',
    },
    title: 'Scale',
    blurb: 'One GPU to many GPUs to many nodes, without the engine noticing.',
  },
  {
    id: 'ch6',
    title: 'Measure',
    blurb: 'The metrics that decide whether any of it worked.',
  },
]

export const stages = [
  {
    n: 1,
    chapter: 'ch1',
    prereq: [],
    slug: 'prefill-vs-decode',
    title: 'Prefill vs decode',
    hook: 'Two workloads with opposite performance profiles, sharing one GPU.',
    concepts: ['prefill', 'decode', 'compute-bound', 'memory-bandwidth-bound', 'continuous batching'],
    sims: ['Static vs continuous batching'],
  },
  {
    n: 2,
    chapter: 'ch1',
    prereq: [1],
    slug: 'engine-anatomy',
    title: 'Engine anatomy',
    hook: 'The parts of an LLM engine, and the path one request takes through all of them.',
    concepts: ['LLMEngine', 'Processor', 'EngineCore', 'Scheduler', 'KVCacheManager', 'step()'],
    sims: ['Request flowing through the engine'],
  },
  {
    n: 3,
    chapter: 'ch2',
    prereq: [2],
    slug: 'paged-attention',
    title: 'KV cache & paged attention',
    hook: 'Why the KV cache is paged like virtual memory, and what that buys you.',
    concepts: ['KV cache', 'block_size', 'free_block_queue', 'block table', 'fragmentation'],
    sims: ['Block allocator', 'Paged vs contiguous'],
  },
  {
    n: 4,
    chapter: 'ch3',
    prereq: [2, 3],
    slug: 'scheduler',
    title: 'The scheduler',
    hook: 'Decode-first, a token budget, and what happens when blocks run out.',
    concepts: ['waiting/running queues', 'FCFS vs priority', 'token budget', 'allocate_slots', 'preemption'],
    sims: ['Scheduler queues, tick by tick'],
  },
  {
    n: 5,
    chapter: 'ch3',
    prereq: [3, 4],
    slug: 'forward-pass',
    title: 'The forward pass',
    hook: 'How mixed prefill and decode requests become one flat tensor.',
    concepts: ['flattened batch', 'positions', 'slot_mapping', 'logits gather', 'CUDA graphs', 'sampling'],
    sims: ['Batch flattening & slot_mapping', 'Sampling explorer'],
  },
  {
    n: 6,
    chapter: 'ch4',
    prereq: [4, 5],
    slug: 'chunked-prefill',
    title: 'Chunked prefill',
    hook: 'Stop one 4k-token prompt from freezing everybody else.',
    concepts: ['long_prefill_token_threshold', 'head-of-line blocking', 'ITL spike'],
    sims: ['Chunking on/off'],
  },
  {
    n: 7,
    chapter: 'ch4',
    prereq: [3, 4],
    slug: 'prefix-caching',
    title: 'Prefix caching',
    hook: 'Never compute the same system prompt twice.',
    concepts: ['hash_request_tokens', 'cached_block_hash_to_block', 'find_longest_cache_hit', 'refcount'],
    sims: ['Two requests sharing a prefix'],
  },
  {
    n: 8,
    chapter: 'ch4',
    prereq: [5],
    slug: 'guided-decoding',
    title: 'Guided decoding',
    hook: 'Make invalid output literally impossible by editing the logits.',
    concepts: ['FSM', 'grammar', '_grammar_bitmask', 'mask to −∞', 'xgrammar'],
    sims: ['FSM + bitmask stepper'],
  },
  {
    n: 9,
    chapter: 'ch4',
    prereq: [1, 5],
    slug: 'speculative-decoding',
    title: 'Speculative decoding',
    hook: 'Guess k tokens cheaply, then let the big model audit the guesses.',
    concepts: ['draft model', 'rejection sampling', 'acceptance rate', 'n-gram', 'EAGLE', 'Medusa'],
    sims: ['Draft / verify / reject', 'Speedup calculator'],
  },
  {
    n: 10,
    chapter: 'ch4',
    prereq: [1, 7],
    slug: 'disaggregated-pd',
    title: 'Disaggregated P/D',
    hook: 'Put prefill and decode on different machines entirely.',
    concepts: ['connector', 'get_num_new_matched_tokens', 'build_connector_meta', 'start_load_kv'],
    sims: ['KV handoff between instances'],
  },
  {
    n: 11,
    chapter: 'ch5',
    prereq: [2, 5],
    slug: 'multiproc-executor',
    title: 'TP, PP & MultiProcExecutor',
    hook: 'The model no longer fits on one GPU. Now what?',
    concepts: ['tensor parallelism', 'pipeline parallelism', 'rpc_broadcast_mq', 'driver worker', 'all-reduce'],
    sims: ['TP=8 forward pass'],
  },
  {
    n: 12,
    chapter: 'ch5',
    prereq: [2, 11],
    slug: 'distributed-serving',
    title: 'Distributed serving',
    hook: 'Four engines, two nodes, one URL — and a load balancer deciding who gets what.',
    concepts: ['AsyncLLM', 'DPEngineCoreProc', 'DPCoordinator', 'load-balance score', 'DP waves'],
    sims: ['Load balancer router'],
  },
  {
    n: 13,
    chapter: 'ch6',
    prereq: [1, 6],
    slug: 'benchmarking',
    title: 'Benchmarking',
    hook: 'TTFT, ITL, throughput, goodput — and why you cannot maximize all of them.',
    concepts: ['TTFT', 'ITL', 'TPOT', 'E2E', 'throughput', 'goodput', 'roofline', 'B_sat'],
    sims: ['Latency anatomy', 'Roofline sweep'],
  },
]

export const stageBySlug = Object.fromEntries(stages.map((s) => [s.slug, s]))

export function neighbours(slug) {
  const i = stages.findIndex((s) => s.slug === slug)
  return {
    prev: i > 0 ? stages[i - 1] : null,
    next: i >= 0 && i < stages.length - 1 ? stages[i + 1] : null,
  }
}

export function stagesOf(chapterId) {
  return stages.filter((s) => s.chapter === chapterId)
}

export const stageByNumber = Object.fromEntries(stages.map((s) => [s.n, s]))

/**
 * The act bridge, shown at the foot of an act's *last* stage: what that act
 * leaves you holding, and what the next one needs it for. Null everywhere else,
 * and null for the final act, which has nothing to hand off to.
 *
 * Lives here rather than in the stage files so the six bridges read as one
 * sequence, and so StageLayout can render them without any page opting in.
 */
export function bridgeFor(slug) {
  const stage = stageBySlug[slug]
  if (!stage) return null
  const ci = chapters.findIndex((c) => c.id === stage.chapter)
  const act = chapters[ci]
  const nextAct = chapters[ci + 1]
  if (!act?.handoff || !nextAct) return null

  const siblings = stagesOf(act.id)
  if (siblings[siblings.length - 1].slug !== slug) return null

  return {
    have: act.handoff.have,
    next: act.handoff.next,
    nextAct,
    nextActNumber: ci + 2,
    firstStage: stagesOf(nextAct.id)[0],
  }
}

/** Attribution — this site is a companion to Aleksa Gordić's post, not a replacement. */
export const source = {
  title: 'Inside vLLM: Anatomy of a High-Throughput LLM Inference System',
  author: 'Aleksa Gordić',
  url: 'https://www.aleksagordic.com/blog/vllm',
  date: 'August 29, 2025',
  commit: '42172ad',
}
