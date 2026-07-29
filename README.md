# Inside vLLM — Interactive

An interactive companion to Aleksa Gordić's post
[*Inside vLLM: Anatomy of a High-Throughput LLM Inference System*](https://www.aleksagordic.com/blog/vllm)
(29 Aug 2025, analysing vLLM V1 at commit `42172ad`).

The post is excellent but static, and most of what it explains is *dynamic*: a block allocator
filling and draining, a scheduler preempting under memory pressure, a draft model being audited by
a bigger one. This site turns each of those into a **steppable simulator** — play/pause/step/step-back
plus knobs — so you drive the clock instead of reading about it.

Audience: you know transformers and attention; you're new to inference serving.

```bash
npm install
npm run dev      # http://localhost:5180
npm run test     # 158 tests
npm run build && npm run preview
```

## Roadmap

13 stages in dependency order, grouped into six chapters.

| # | Stage | Simulators |
|---|---|---|
| 1 | Prefill vs decode | static vs continuous batching |
| 2 | Engine anatomy | a request through every component |
| 3 | KV cache & paged attention | block allocator; paged vs contiguous |
| 4 | The scheduler | queues, token budget, preemption |
| 5 | The forward pass | batch flattening & `slot_mapping`; sampling explorer |
| 6 | Chunked prefill | chunking on/off, ITL spike |
| 7 | Prefix caching | two requests sharing a prefix |
| 8 | Guided decoding | FSM + bitmask stepper |
| 9 | Speculative decoding | draft/verify/reject; speedup calculator |
| 10 | Disaggregated P/D | KV handoff between instances |
| 11 | TP, PP & MultiProcExecutor | TP=8 forward pass |
| 12 | Distributed serving | load-balancer router |
| 13 | Benchmarking | latency anatomy; roofline sweep |

## How it's built

```
src/
├── content/roadmap.js     single source of truth — drives router, sidebar, prev/next, map page
├── sim/                   pure JS reducers. No React, no DOM, no Date.now, no Math.random.
├── hooks/
│   ├── simHistory.js      pure history arithmetic (advance / advanceToEnd)
│   └── useSimulation.js   the clock: play/pause/step/back/reset/speed
├── components/
│   ├── ui/                SimFrame, StepControls, Knob, Callout, CodeBlock, BlogFigure…
│   └── viz/               BlockGrid, QueueLane, TokenStrip, Timeline, DistChart, LineChart, NodeGraph
└── stages/                one page per stage: prose + <SimFrame> widgets
```

Every simulator implements one contract:

```js
export default defineSim({
  name, params,           // params declare their own UI (slider or segmented control)
  init(p), step(state, p), isDone(state, p),
  invariants: [ (s, p) => true | 'what went wrong' ],
})
```

`useSimulation(simModule)` wraps any such module and returns everything `<SimFrame>` needs.
Adding a simulator is **one pure file plus one render function** — no per-widget clock or state
plumbing. Because sims are pure and use a stateless hash-based PRNG (never `Math.random()`),
step-backwards is free and replays are exact.

## Tests

The sims carry the site's factual claims, so they're tested rather than trusted. `npm run test`
asserts each sim's declared invariants at *every tick across a parameter sweep*, plus the specific
claims the prose makes — for example:

- KV blocks are conserved; no block is ever owned by two requests; paged wastes at most
  `block_size − 1` slots per live request.
- The scheduler never exceeds its token budget; decodes are always scheduled before prefills;
  preempted requests lose their KV and are re-prefilled.
- `slot_mapping` is injective, and matches
  `block_table[pos // block_size] * block_size + pos % block_size` exactly.
- Chained prefix hashes diverge from the first differing block onward;
  `find_longest_cache_hit` stops at the first miss.
- Guided decoding never emits a token the FSM disallows.
- **Speculative decoding's emitted tokens follow `p_target` at every `k` and every draft-agreement
  level** — the correctness guarantee that makes the technique safe, checked empirically.
- Below `B_sat` step latency is flat and throughput scales linearly; above it, throughput saturates
  while latency climbs.

Render smoke tests mount all 14 pages, and a build check confirms every Tailwind class used actually
resolves.

## Caveats

The simulators are deliberately small, honest models of each mechanism — not measurements. Absolute
milliseconds and token counts are illustrative; the *relationships* are what's being taught. Real
engines have far more moving parts.

Diagrams in `public/img/` are from the original post and belong to its author.
