/**
 * Single source of truth for the site's structure.
 * Drives the router, the sidebar, prev/next navigation, and the roadmap map page.
 * Stage components are lazy-imported in router.jsx keyed off `slug`.
 */

export const chapters = [
  {
    id: 'ch1',
    title: 'Why serving is hard',
    blurb:
      'The two workloads an engine must juggle, and the anatomy of the machine that juggles them.',
  },
  {
    id: 'ch2',
    title: 'Memory',
    blurb: 'Paged attention: the idea that made high-throughput serving possible.',
  },
  {
    id: 'ch3',
    title: 'The loop',
    blurb: 'What actually happens on every single engine step.',
  },
  {
    id: 'ch4',
    title: 'Optimizations',
    blurb: 'Five features layered on top of the core loop, each buying a different thing.',
  },
  {
    id: 'ch5',
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
    slug: 'prefill-vs-decode',
    title: 'Prefill vs decode',
    hook: 'Two workloads with opposite performance profiles, sharing one GPU.',
    concepts: ['prefill', 'decode', 'compute-bound', 'memory-bandwidth-bound', 'continuous batching'],
    sims: ['Static vs continuous batching'],
  },
  {
    n: 2,
    chapter: 'ch1',
    slug: 'engine-anatomy',
    title: 'Engine anatomy',
    hook: 'The parts of an LLM engine, and the path one request takes through all of them.',
    concepts: ['LLMEngine', 'Processor', 'EngineCore', 'Scheduler', 'KVCacheManager', 'step()'],
    sims: ['Request flowing through the engine'],
  },
  {
    n: 3,
    chapter: 'ch2',
    slug: 'paged-attention',
    title: 'KV cache & paged attention',
    hook: 'Why the KV cache is paged like virtual memory, and what that buys you.',
    concepts: ['KV cache', 'block_size', 'free_block_queue', 'block table', 'fragmentation'],
    sims: ['Block allocator', 'Paged vs contiguous'],
  },
  {
    n: 4,
    chapter: 'ch3',
    slug: 'scheduler',
    title: 'The scheduler',
    hook: 'Decode-first, a token budget, and what happens when blocks run out.',
    concepts: ['waiting/running queues', 'FCFS vs priority', 'token budget', 'allocate_slots', 'preemption'],
    sims: ['Scheduler queues, tick by tick'],
  },
  {
    n: 5,
    chapter: 'ch3',
    slug: 'forward-pass',
    title: 'The forward pass',
    hook: 'How mixed prefill and decode requests become one flat tensor.',
    concepts: ['flattened batch', 'positions', 'slot_mapping', 'logits gather', 'CUDA graphs', 'sampling'],
    sims: ['Batch flattening & slot_mapping', 'Sampling explorer'],
  },
  {
    n: 6,
    chapter: 'ch4',
    slug: 'chunked-prefill',
    title: 'Chunked prefill',
    hook: 'Stop one 4k-token prompt from freezing everybody else.',
    concepts: ['long_prefill_token_threshold', 'head-of-line blocking', 'ITL spike'],
    sims: ['Chunking on/off'],
  },
  {
    n: 7,
    chapter: 'ch4',
    slug: 'prefix-caching',
    title: 'Prefix caching',
    hook: 'Never compute the same system prompt twice.',
    concepts: ['hash_request_tokens', 'cached_block_hash_to_block', 'find_longest_cache_hit', 'refcount'],
    sims: ['Two requests sharing a prefix'],
  },
  {
    n: 8,
    chapter: 'ch4',
    slug: 'guided-decoding',
    title: 'Guided decoding',
    hook: 'Make invalid output literally impossible by editing the logits.',
    concepts: ['FSM', 'grammar', '_grammar_bitmask', 'mask to −∞', 'xgrammar'],
    sims: ['FSM + bitmask stepper'],
  },
  {
    n: 9,
    chapter: 'ch4',
    slug: 'speculative-decoding',
    title: 'Speculative decoding',
    hook: 'Guess k tokens cheaply, then let the big model audit the guesses.',
    concepts: ['draft model', 'rejection sampling', 'acceptance rate', 'n-gram', 'EAGLE', 'Medusa'],
    sims: ['Draft / verify / reject', 'Speedup calculator'],
  },
  {
    n: 10,
    chapter: 'ch4',
    slug: 'disaggregated-pd',
    title: 'Disaggregated P/D',
    hook: 'Put prefill and decode on different machines entirely.',
    concepts: ['connector', 'get_num_new_matched_tokens', 'build_connector_meta', 'start_load_kv'],
    sims: ['KV handoff between instances'],
  },
  {
    n: 11,
    chapter: 'ch5',
    slug: 'multiproc-executor',
    title: 'TP, PP & MultiProcExecutor',
    hook: 'The model no longer fits on one GPU. Now what?',
    concepts: ['tensor parallelism', 'pipeline parallelism', 'rpc_broadcast_mq', 'driver worker', 'all-reduce'],
    sims: ['TP=8 forward pass'],
  },
  {
    n: 12,
    chapter: 'ch5',
    slug: 'distributed-serving',
    title: 'Distributed serving',
    hook: 'Four engines, two nodes, one URL — and a load balancer deciding who gets what.',
    concepts: ['AsyncLLM', 'DPEngineCoreProc', 'DPCoordinator', 'load-balance score', 'DP waves'],
    sims: ['Load balancer router'],
  },
  {
    n: 13,
    chapter: 'ch6',
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

/** Attribution — this site is a companion to Aleksa Gordić's post, not a replacement. */
export const source = {
  title: 'Inside vLLM: Anatomy of a High-Throughput LLM Inference System',
  author: 'Aleksa Gordić',
  url: 'https://www.aleksagordic.com/blog/vllm',
  date: 'August 29, 2025',
  commit: '42172ad',
}
