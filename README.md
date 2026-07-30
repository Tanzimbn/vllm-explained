# Inside vLLM — Interactive

An interactive companion to Aleksa Gordić's post
[*Inside vLLM: Anatomy of a High-Throughput LLM Inference System*](https://www.aleksagordic.com/blog/vllm)
(29 Aug 2025, analysing vLLM V1 at commit `42172ad`).

The post is excellent but static, and most of what it explains is *dynamic*: a block allocator
filling and draining, a scheduler preempting under memory pressure, a draft model being audited by
a bigger one. This site turns each of those into a **steppable simulator** — play/pause/step/step-back
plus knobs — so you drive the clock instead of reading about it.

Audience: you know transformers and attention; you're new to inference serving.

**Live:** https://tanzimbn.github.io/vllm-explained/

```bash
npm install
npm run dev      # http://localhost:5180/vllm-explained/
npm run test     # 194 tests
npm run build && npm run preview
```

The dev URL carries the `/vllm-explained/` prefix because that's the path GitHub
Pages serves from, and local and production should not differ. Visiting `/` redirects there.
To serve from a domain root instead, build with `BASE_PATH=/ npm run build`.

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
├── content/roadmap.js     single source of truth — drives router, stage strip, prev/next, map page
├── sim/                   pure JS reducers. No React, no DOM, no Date.now, no Math.random.
├── hooks/
│   ├── simHistory.js      pure history arithmetic (advance / advanceToEnd)
│   └── useSimulation.js   the clock: play/pause/step/back/reset/speed
├── components/
│   ├── layout/            Shell (header + stage strip), StageLayout (the two-pane grid)
│   ├── ui/                SimPanel, SimFrame, StepControls, Knob, Callout, CodeBlock, BlogFigure…
│   └── viz/               BlockGrid, QueueLane, TokenStrip, Timeline, DistChart, LineChart, NodeGraph
└── stages/                one page per stage: prose + the sim it pins to the pane
```

Each stage is **prose on the left, its simulator pinned in a sticky pane on the right** — so the
instrument stays in view for the whole read, and "Focus simulator" collapses the prose when you would
rather just drive. A stage with a second simulator keeps that one inline in the prose.

The look is the **Modernist** design system, imported from a claude.ai/design project: a light ground,
ink, one red accent with 100–900 ramps, Archivo, zero corner radius, and structure carried by 2px
rules rather than by cards. Two rules bend for this site's content — the request-identity palette
keeps muted hues, because some sims need five separable fills at once and ink plus one red cannot do
it; and the blog diagrams are not printed greyscale, because their colour carries meaning.

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

Render smoke tests mount all 14 pages and assert each one is laid out as prose plus a pinned
simulator pane. `src/theme.test.js` pins the design-system contract: the ground/ink/accent trio, both
100–900 ramps, a radius scale that is zero everywhere, and the fill/ink pairing helpers.

## Deployment

`.github/workflows/deploy.yml` runs on every push to `main`: install → test → build → publish
`dist/` via `actions/deploy-pages`. A red test suite blocks the deploy, because the simulators are
what the pages assert.

**One manual step:** in the repo's *Settings → Pages*, set **Source** to **GitHub Actions**. Without
it the workflow builds and then fails at the deploy step.

Three things the sub-path deployment needs, all pinned by tests in `src/deploy.test.jsx`:

| Concern | Handled by |
|---|---|
| Asset URLs | `base: '/vllm-explained/'` in `vite.config.js` — both slashes matter |
| Router matching | `basename={import.meta.env.BASE_URL}` on `BrowserRouter` |
| Blog figures | `${import.meta.env.BASE_URL}img/…` rather than an absolute `/img/…` |

Deep links get one extra wrinkle. GitHub Pages has no history-API fallback, so
`/vllm-explained/stage/scheduler` matches no file. Pages serves `404.html` for unmatched paths, so
the build emits a copy of `index.html` under that name (`githubPagesFallback` in `vite.config.js`) —
the SPA boots, the router reads the real URL, and the correct stage renders with the address bar
intact. Copying at build time keeps the hashed asset filenames in sync.

The one visible consequence: a deep link returns HTTP **404** even though it renders correctly. That
is invisible to users but means crawlers won't index individual stages. If that ever matters, swap
the fallback for the [`spa-github-pages`](https://github.com/rafgraph/spa-github-pages) redirect
trick, which trades a redirect flash for a 200.

## Caveats

The simulators are deliberately small, honest models of each mechanism — not measurements. Absolute
milliseconds and token counts are illustrative; the *relationships* are what's being taught. Real
engines have far more moving parts.

Diagrams in `public/img/` are from the original post and belong to its author.
