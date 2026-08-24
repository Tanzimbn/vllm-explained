/**
 * Every term the site puts on a stage's concept chips, plus the jargon the prose
 * has to lean on (HBM, SLO, refcount, and friends).
 *
 * The chips in `StageHeader` link into the glossary page, so a reader who
 * arrives at stage 09 without having read 01 has somewhere to go. `stage` is the
 * stage that introduces the term and owns the full explanation; the definition
 * here is the one-breath version, not a replacement for the page.
 *
 * `stages.test.jsx` asserts that every chip in roadmap.js has an entry, so
 * adding a concept to a stage without defining it fails the build.
 */

/** URL-safe anchor for a term. Also the id used on the glossary page. */
export function slugify(term) {
  return term
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const ENTRIES = [
  // ---------------------------------------------------------------- stage 01
  ['prefill', 1, 'The first pass over a prompt. The model reads every prompt token at once and works out one thing: the first token of the reply.'],
  ['decode', 1, 'Every pass after the prefill. Each one reads the single token just produced and predicts the next, so a 500-token answer means 499 decodes.'],
  ['compute-bound', 1, 'Limited by how fast the chip can do arithmetic. Prefill is compute-bound: there is plenty of independent maths to keep the units busy.'],
  ['memory-bandwidth-bound', 1, 'Limited by how fast weights can be pulled out of memory rather than by arithmetic. Decode is bandwidth-bound, which is why batching helps it so much.'],
  ['continuous batching', 1, 'Admitting and retiring requests every step instead of every batch. A finished sequence frees its slot immediately rather than waiting for the rest of its batch.'],
  ['HBM', 1, 'High-bandwidth memory: the stack of memory chips sitting beside the GPU die, where the weights and the KV cache live. Also called VRAM.'],
  ['static batching', 1, 'The naive alternative to continuous batching: collect B requests, run them until all are finished, then collect the next B. Wastes a slot for as long as its batch’s slowest member runs.'],

  // ---------------------------------------------------------------- stage 02
  ['LLMEngine', 2, 'The whole engine: a Processor at the front, an EngineCore doing the work, and an OutputProcessor at the back.'],
  ['Processor', 2, 'The front door. Validates the input, turns text into token ids, and packs the result into an EngineCoreRequest.'],
  ['EngineCore', 2, 'The part that actually runs the model. Holds the scheduler, the KV-cache manager, the model executor and the structured-output manager.'],
  ['Scheduler', 2, 'Decides who runs on each step. Holds the waiting and running queues, the policy, and the KV-cache manager.'],
  ['KVCacheManager', 2, 'Owns the pool of KV blocks. Hands them out through allocate_slots and takes them back when a request ends.'],
  ['step()', 2, 'One turn of the engine loop, always the same three phases: schedule, forward pass, postprocess. Every feature on this site hooks into one of them.'],
  ['engine core client', 2, 'The seam between the caller and the EngineCore. In one process it is an InprocClient and the call is an ordinary function call; online it becomes a socket to another process.'],
  ['gpu_memory_utilization', 2, 'The fraction of VRAM vLLM may claim. It decides how much is left for the KV cache after the weights load, and therefore how many requests fit at once.'],

  // ---------------------------------------------------------------- stage 03
  ['KV cache', 3, 'The keys and values already computed for a sequence, kept so they never have to be computed twice. It grows with every token, which makes it the resource that limits concurrency.'],
  ['block_size', 3, 'How many tokens’ worth of KV live in one block. 16 by default: bigger blocks mean less bookkeeping, smaller ones pack more tightly.'],
  ['free_block_queue', 3, 'The pool of blocks nobody is using. Blocks come off the front and freed ones go on the back, which is what lets a freed block keep its data long enough to be reclaimed.'],
  ['block table', 3, 'A sequence’s list of which physical block holds which slice of its tokens. Its blocks need not be next to each other, so #3 → #17 → #4 is perfectly ordinary.'],
  ['fragmentation', 3, 'Memory that exists but cannot be used. External fragmentation is free space split into gaps too small to fit anybody; internal fragmentation is the unused tail of a partly-filled block.'],
  ['paged attention', 3, 'Storing the KV cache in fixed-size blocks that need not be adjacent, the way an operating system pages RAM. Removes external fragmentation and the need to reserve for the worst case.'],
  ['VRAM', 3, 'The GPU’s own memory. Holds the model weights and the KV cache; the same physical memory as HBM.'],

  // ---------------------------------------------------------------- stage 04
  ['waiting/running queues', 4, 'The two lists the scheduler works from. Running requests are considered first, then whatever budget is left goes on admitting requests from waiting.'],
  ['FCFS vs priority', 4, 'How the waiting queue is ordered. FCFS is first come, first served; priority keeps it sorted by importance, so a late request can jump ahead.'],
  ['token budget', 4, 'max_num_batched_tokens: the most tokens the engine will put through one forward pass. Decodes spend from it first, prefills get the remainder.'],
  ['allocate_slots', 4, 'The choke point for memory pressure. Works out how many blocks a request needs, checks the pool, and either takes them or triggers preemption.'],
  ['preemption', 4, 'Taking KV blocks away from a running request so another can continue. The victim loses its cache entirely and must prefill again from scratch, so this destroys work rather than deferring it.'],
  ['max_num_seqs', 4, 'How many requests may run at once. Together with gpu_memory_utilization it decides whether the engine preempts under load.'],

  // ---------------------------------------------------------------- stage 05
  ['flattened batch', 5, 'The batch as one long unpadded sequence rather than a rectangle. Two prefills of 7 tokens and three decodes make a tensor 17 rows tall with no padding at all.'],
  ['positions', 5, 'Each token’s index within its own sequence, carried alongside the flattened batch so a token can only attend inside its own span.'],
  ['slot_mapping', 5, 'One physical KV slot number per row of the batch, computed as block_table[pos // block_size] * block_size + pos % block_size. This single line is the whole of paging at the kernel boundary.'],
  ['logits gather', 5, 'Picking out the one row per request that can predict its next token — its last position. A 2000-token prefill and a 1-token decode both yield exactly one.'],
  ['CUDA graphs', 5, 'A recording of a whole sequence of GPU operations, replayable with one instruction. Saves the CPU cost of launching work, which matters most for decode steps where each operation is tiny.'],
  ['sampling', 5, 'Turning logits into a token. Temperature reshapes the distribution, then top_k and top_p delete part of it, then what survives is renormalised and drawn from.'],
  ['logits', 5, 'The model’s raw score for every token in the vocabulary, before any filtering or normalising.'],
  ['cu_seqlens', 5, 'The array of start offsets that tells the attention kernel where each sequence begins inside the flattened batch.'],

  // ---------------------------------------------------------------- stage 06
  ['long_prefill_token_threshold', 6, 'The cap on how many prefill tokens one request may contribute per step. Setting it enables chunked prefill; it controls the chunk size, not whether chunking can happen.'],
  ['head-of-line blocking', 6, 'One long request delaying everyone behind it. Here it works through step duration rather than queue order, because every request in a step waits for the whole step.'],
  ['ITL spike', 6, 'A single token arriving far later than the rest, usually because a long prefill landed in that step. The number a streaming reader actually notices.'],
  ['chunked prefill', 6, 'Feeding a long prompt in fixed-size pieces across several steps. Only the last chunk samples a token; the rest just fill in KV.'],

  // ---------------------------------------------------------------- stage 07
  ['hash_request_tokens', 7, 'Turns a prompt into one hash per complete block. Each hash folds in the previous block’s hash, which is what makes the cache a prefix cache.'],
  ['cached_block_hash_to_block', 7, 'The map from a block hash to the physical block holding that content. A lookup here is a cache hit.'],
  ['find_longest_cache_hit', 7, 'Walks a request’s block hashes against the cache map and stops at the first miss. Everything before that point is already computed.'],
  ['refcount', 7, 'How many live requests are using a block. Zero means reclaimable, not invalid: the block keeps its hash and its contents until it is actually handed to somebody else.'],
  ['prefix caching', 7, 'Reusing the KV of leading tokens that have been seen before, so a shared system prompt is computed once rather than once per request.'],
  ['LRU', 7, 'Least recently used: when something must be evicted, the oldest goes first. Here it is free, falling out of the free queue taking from the front and returning to the back.'],
  ['cache salt', 7, 'A value mixed into the first block’s hash so only requests carrying the same salt can match those blocks. How one shared cache keeps tenants apart.'],

  // ---------------------------------------------------------------- stage 08
  ['FSM', 8, 'Finite state machine: a small set of states, each knowing which tokens may come next. A grammar compiles into one.'],
  ['grammar', 8, 'The description of what output is acceptable — a list of choices, a regular expression, or a JSON schema. Compiled into an FSM before decoding starts.'],
  ['_grammar_bitmask', 8, 'One bit per token saying whether it is currently legal, packed 32 to an int32. Rebuilt every step for every guided request, which is why the packing matters.'],
  ['mask to −∞', 8, 'Setting a disallowed token’s logit to negative infinity, which makes its probability exactly zero after softmax. Not unlikely — impossible.'],
  ['xgrammar', 8, 'The third-party library that turns the current FSM state into the bit patterns the mask needs.'],
  ['guided decoding', 8, 'Constraining output to a grammar by editing the logits before sampling. A validator applied afterwards cannot do the same job, because by then the token is already out.'],
  ['SLO', 8, 'Service level objective: a promise about a number, such as "95% of requests see a first token within 300ms". The line you have decided not to cross.'],

  // ---------------------------------------------------------------- stage 09
  ['draft model', 9, 'The cheap model that guesses the next k tokens. It affects speed only — never the output distribution, because the verification step corrects for it.'],
  ['rejection sampling', 9, 'The accept-or-reject rule that keeps speculation exact. Accept if the target’s probability is at least the draft’s, otherwise accept with probability p_target / p_draft, and stop at the first rejection.'],
  ['acceptance rate', 9, 'The share of drafted tokens that survive verification. It sets the speedup, and it falls as k grows because acceptance compounds.'],
  ['n-gram', 9, 'A drafter with no weights at all: it looks for a recent repeat of the current text and proposes what followed last time. Free, and very good on repetitive input.'],
  ['EAGLE', 9, 'A small trained network that drafts from the target model’s own hidden states. Higher acceptance than n-gram, at the cost of weights to train and load.'],
  ['Medusa', 9, 'Extra prediction heads bolted onto the target model, proposing several future tokens in parallel.'],
  ['residual distribution', 9, 'What a rejected guess is replaced from: normalize(max(0, p_target − p_draft)). Sampling only from where the target wanted more than the draft offered is what keeps the result exact.'],

  // ---------------------------------------------------------------- stage 10
  ['connector', 10, 'The abstraction that moves KV between engine instances. Its speed lands directly on TTFT, which is why the choice of connector matters so much.'],
  ['get_num_new_matched_tokens', 10, 'Asks the connector how many of this request’s tokens are already cached elsewhere. Called right after the local prefix-cache check, and added to the same count.'],
  ['build_connector_meta', 10, 'Assembles what the workers need in order to move the right KV during the coming step.'],
  ['start_load_kv', 10, 'Begins pulling a request’s KV from the store into this instance’s paged memory, before its first decode step.'],
  ['disaggregated P/D', 10, 'Running prefill and decode on separate machines, with a KV service between them. Buys a much tighter ITL and pays for it in TTFT.'],

  // ---------------------------------------------------------------- stage 11
  ['tensor parallelism', 11, 'Cutting each weight matrix across GPUs, so every GPU holds a slice of every layer. Needs an all-reduce per block, so it normally stays inside one machine.'],
  ['pipeline parallelism', 11, 'Cutting by layer, so each GPU owns a run of consecutive layers. Communicates far less than tensor parallelism, at the cost of idle bubbles.'],
  ['rpc_broadcast_mq', 11, 'The shared-memory queue the executor uses to hand work to every worker rank at once, without blocking.'],
  ['driver worker', 11, 'Rank 0 of a tensor-parallel group, which coordinates and returns the result the parent is waiting on.'],
  ['all-reduce', 11, 'Every GPU shares its partial result with every other and they combine into one answer. Needed after each sharded block, which is what makes tensor parallelism talk so much.'],
  ['bubble', 11, 'Idle GPU time in a pipeline, while the GPUs holding later layers wait for earlier ones to produce something.'],

  // ---------------------------------------------------------------- stage 12
  ['AsyncLLM', 12, 'A wrapper that lets the engine be driven from asynchronous code, so an API server can hold many requests in flight.'],
  ['DPEngineCoreProc', 12, 'One data-parallel engine replica as its own process, running three threads: input, main, and output.'],
  ['DPCoordinator', 12, 'Sits between frontend and engines, forwarding load information so the router can pick a replica, and relaying wave events.'],
  ['load-balance score', 12, 'len(waiting) * 4 + len(running), minimised over replicas. Queued work counts more heavily because it has not started producing anything yet.'],
  ['DP waves', 12, 'A counter tracking when all replicas go idle and new work arrives again. Used for coordination and metrics.'],
  ['data parallelism', 12, 'Running several complete copies of the engine. Unlike tensor parallelism it is not about fitting the model — the model already fits, and you want more of it.'],
  ['headless', 12, 'A node running engines only, with no API server. Its replicas are fed over the network by the node that does host the frontend.'],

  // ---------------------------------------------------------------- stage 13
  ['TTFT', 13, 'Time to first token, measured from submission and including any queueing delay. What a person notices before an answer starts.'],
  ['ITL', 13, 'Inter-token latency: the gap between one token of an answer and the next. What a person notices while it streams.'],
  ['TPOT', 13, 'Time per output token: the mean ITL across a request.'],
  ['E2E', 13, 'End-to-end latency for a whole request. TTFT plus the sum of the ITLs — note that 10 tokens means 9 gaps.'],
  ['throughput', 13, 'Tokens or requests per second across everybody. Easy to inflate by raising the batch size until nobody’s ITL is acceptable.'],
  ['goodput', 13, 'Throughput counting only requests that met their SLOs. The one headline number that raising the batch size cannot fake.'],
  ['roofline', 13, 'The shape of step time against batch size: a flat ceiling set by memory bandwidth, then a slope set by compute. You are always under one or the other.'],
  ['B_sat', 13, 'The batch size where compute overtakes weight streaming. It is peak compute divided by memory bandwidth, so it belongs to the GPU — the model size cancels out.'],
]

export const glossary = ENTRIES.map(([term, stage, def]) => ({
  term,
  stage,
  def,
  slug: slugify(term),
}))

export const glossaryByTerm = Object.fromEntries(glossary.map((g) => [g.term, g]))

/** Every term introduced by a given stage, in the order it is listed above. */
export function termsOf(stageNumber) {
  return glossary.filter((g) => g.stage === stageNumber)
}
