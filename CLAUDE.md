# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A React + Vite site of 13 teaching stages that accompany Aleksa Gordić's post *Inside vLLM: Anatomy
of a High-Throughput LLM Inference System* (vLLM V1 at commit `42172ad`). Each stage is prose plus
one or more **steppable simulators** (play/pause/step/step-back/knobs) of a serving mechanism: block
allocator, scheduler, chunked prefill, prefix caching, speculative decoding, TP/PP, roofline.

## Commands

```bash
npm install
npm run dev              # http://localhost:5180/vllm-explained/  — visiting / redirects there
npm run test             # vitest run — 194 tests
npm run test:watch
npm run build            # BASE_PATH=/ npm run build  to serve from a domain root
npm run preview
```

Single test / single file:

```bash
npx vitest run src/sim/sims.test.js
npx vitest run -t 'prefix caching'          # matches describe/it names
npx vitest run src/sim/sims.test.js -t 'slot_mapping'
```

No linter or formatter is configured; match the surrounding style.

## Architecture

### One source of truth for structure

`src/content/glossary.js` defines every term the site uses — all 67 concept chips plus the jargon
the prose leans on — keyed by the exact chip string, with the stage that introduces it. The chips in
`StageHeader` link to `/glossary#<slug>`, and `stages.test.jsx` fails if a stage names a concept the
glossary does not define. Definitions are the one-line reminder; the stage owns the explanation.

`src/content/roadmap.js` declares chapters and stages (slug, number, title, hook, concepts, sims,
`prereq`). It drives the router, prev/next, and the roadmap map page. Two fields serve the reader's
path through the site rather than the routing: a stage's `prereq` lists the earlier stages it builds
on, which `StageHeader` renders as links, and a chapter's `handoff` is the act bridge —
`bridgeFor(slug)` returns it only on that act's last stage, and `StageLayout` renders it there with
no page opting in. Adding or renaming a stage means editing
**three** places, and `src/stages/stages.test.jsx` fails if they disagree:

1. the `stages` array in `content/roadmap.js` (numbers must be contiguous from 1)
2. the lazy `PAGES` map in `src/App.jsx`
3. the eager `PAGES` map in `src/stages/stages.test.jsx`

The roadmap also drives the header's stage tick strip and the map page's act rows. There is no
sidebar: `Shell.jsx` is a 60px sticky header over a 38px strip of 13 numbered stage cells (99px
total, which is the offset the sticky simulator pane sticks to).

### The simulator contract

Every sim in `src/sim/` is a **pure** module built with `defineSim` (`src/sim/createSim.js`):

```js
export default defineSim({
  name, params,                 // params declare their own UI: {min,max,step,default} or {options}
  init(p), step(state, p), isDone(state, p),
  invariants: [ (s, p) => true | 'what went wrong' ],
})
```

Purity is load-bearing, not stylistic — it is what makes step-backwards free and replays exact:

- **No `Math.random()`.** Use the stateless hash PRNG `rand/randInt/randGap(...salt)` from
  `createSim.js`, salted with `(SEED, tick, index, …)` so the same tick always yields the same value.
- **No `Date.now()`, no React, no DOM.** `step` must not mutate `state` — return a new object.
- Sims also export pure derived-stat helpers (`memoryBreakdown`, `itlStats`, `buildBatch`,
  `findLongestCacheHit`, `latencyMetrics`, …). Both the stage component and the tests consume these,
  so a displayed number and an asserted number are the same code path.

`invariants` are checked twice: `useSimulation` `console.warn`s violations in dev, and
`sims.test.js` asserts them at *every tick across a parameter sweep*.

### The clock

`useSimulation(simModule)` (`src/hooks/useSimulation.js`) returns everything `<SimPanel>`/`<SimFrame>`
need, so a
new simulator is *one pure sim file + one render function* with zero clock plumbing. History is just
an array of snapshots — that is how `back()` works for free. Changing any param **restarts** the sim
(params are structural; a mid-run change would produce an incoherent trace).

All history arithmetic lives in `src/hooks/simHistory.js` as pure functions and must be computed
*before* `setState`, never inside an updater — StrictMode double-invokes updaters and a nested
`setState` there doubles every tick. `MAX_HISTORY` (600) trims from the front.

### Stage pages — the two-pane layout

`src/stages/<Name>.jsx` = a local `…Viz({ sim })` render function, plus a `<StageLayout>` that takes
the sim in its `panel` prop and the prose as children:

```jsx
const sim = useSimulation(kvcache)
return (
  <StageLayout slug="paged-attention" sim={sim} simTitle="…" panel={<KvViz sim={sim} />}
               legend={[…]} simFooter={<>…</>}>
    …prose, figures, callouts, <Takeaways> …
  </StageLayout>
)
```

`StageLayout` (`components/layout/StageLayout.jsx`) owns the grid: prose left, the primary simulator
**pinned sticky** right under the 99px of chrome, plus the focus toggle and prev/next. Below `lg` it
stacks and CSS `order` puts the pane above the body prose. Several pages say "the panel on the
right" in their copy, and `stages.test.jsx` asserts the structure — so a stage's primary sim belongs
in `panel`, never inline.

Pass `slug` explicitly; `StageLayout` must not read `useParams()`, because `stages.test.jsx` mounts
each page bare with no matching route. `StageHeader` is rendered *eagerly* by `App.jsx` (outside
`Suspense`) so the title paints before the lazy chunk lands and a statically-rendered deep link
still identifies its stage.

`<SimFrame>` remains for a **secondary** simulator inline in the prose — only `ForwardPass.jsx` and
`Benchmarking.jsx` have one, and a test pins that list.

Shared chrome is in `src/components/ui/index.jsx` (SimPanel, SimFrame, StepControls, Knob, Callout,
CodeBlock, BlogFigure, StatRow + StatTile, Badge, Legend, Takeaways, StageRef, ActBridge); shared visualizations in
`src/components/viz/index.jsx` (BlockGrid, QueueLane, TokenStrip, Timeline, DistChart, LineChart,
NodeGraph, MeterBar, StackedBar).

### The Modernist design system

The site implements **Modernist** (imported from the claude.ai/design project "Website redesign
proposal"): light ground `#f3f2f2`, ink `#201e1d`, **one** red accent `#ec3013` with 100–900 OKLCH
ramps, Archivo at 800/900 for display, **zero corner radius**, 2px rules between major blocks and
1px between cells, everything flush left. Nothing floats — no shadows, no blur, no tinted glass.
`src/theme.test.js` pins the contract.

Rules worth knowing before editing:

- **Never hardcode a hex.** Take colour from the `@theme` tokens in `src/index.css` or the `C` map /
  `reqColor()` in `viz/index.jsx`.
- **Radius is zeroed at the scale**, including bare `--radius`, so existing `rounded-*` utilities
  resolve to square. An arbitrary value like `rounded-[3px]` bypasses that — don't add one.
- **The accent is not body text.** `--color-accent` against the ground is ~3:1: fine for fills,
  chrome and display sizes, not for small type. Use `accent-700` (`--color-accent-dim`) there.
- **Colour that encodes data is split in two.** Severity is strictly mono — good = ink, warn =
  `accent-700`, bad = `accent`, so "the number went red" means "this is the number going wrong".
  Identity keeps hues, because a block grid with five owners needs distinctions ink and one red
  can't carry; that lives in `reqColor()`, muted to sit on the light ground.
- **Every role fill has an `-ink` companion** (`--color-prefill-ink`, …) because some fills are dark
  and some light. Use `inkOn(fill)` / `reqInk(i, {light})` from `viz/index.jsx` rather than guessing.
- State is never encoded by hue alone — always also a label, glyph, or pattern.
- `BlogFigure` deliberately skips the system's `.grayscale` rule: these are Aleksa Gordić's diagrams
  and their colour carries meaning.

`<BlogFigure src="kv_cache_blocks.png">` takes a bare filename (resolved against `BASE_URL`). A test
greps stage files for `src="…png"` literals and asserts the file exists in `public/img/`, so keep the
prop a literal string rather than a variable.

## How the prose is written

The reader is assumed to know transformers and attention and **nothing** about inference serving.
That is the whole audience: someone competent who has never run a server. Stage 02
(`EngineAnatomy.jsx`) is the reference voice — match it.

- **One idea per sentence.** If a sentence has two clauses doing different jobs, it is two
  sentences. `stages.test.jsx` measures the *rendered* article and holds every stage to a
  `READABILITY_BUDGET` — an average and a longest-sentence ceiling. It is a ratchet: rewriting a
  stage lowers its two numbers, and nothing may raise them. The bar to aim for is the one
  `engine-anatomy` already meets — average under 18 words, no sentence over 35.
- **Gloss every identifier in English at first use on the page.** `<Code>free_block_queue</Code>` is
  not self-explanatory — say what it holds. Same for every acronym: HBM, DAG, FSM, EOS, VRAM, TP/PP.
  A term is "introduced" by the lowest-numbered stage that names it.
- **Why before what.** Open a section with the problem the part solves, then the mechanism. "The
  scheduler has picked who runs; those requests now have to become one tensor" beats "the model
  executor's `execute_model` delegates to the `Worker`".
- **Never forward-reference a mechanism you have not earned.** Name the consequence in the earlier
  stage and let the later stage own the mechanism; link with `<StageRef>` so the reader can jump.
- **Cross-stage references are links, never prose.** Write `<StageRef n={7} />`, not "stage 07" —
  the text comes from `roadmap.js`, and a test fails on any bare `stage NN` left in a stage file.
- **Never open a sentence with something lowercase.** Not a bare `<Code>slot_mapping</Code>`, not a
  short-form `<StageRef>` (which renders "stage 06"). Rephrase, or use `<StageRef n={6} title />`,
  which renders "Chunked prefill (stage 06)". It reads better, and the readability check treats a
  lowercase start as a continuation of the previous sentence.
- **An analogy goes before the mechanism, and only where one is needed.** `<Callout kind="intuition">`
  is for a way in — a bandwidth-bound step, paging, an unpadded batch, a chained hash,
  draft-and-verify, TP against PP. Six stages have one and a test pins that list; a mandatory
  analogy on a stage that explains itself is padding. It is the one callout kind distinguished by a
  fill rather than a shape, so its label always names itself.
- **Bind paragraphs to the simulator with specific actions.** "Set `block_size` to 4 and step six
  times; watch row 3 jump" beats "watch the panel on the right".
- **Derive a number in the prose before it appears in a `<Takeaways>`.** Takeaways recap; they do
  not introduce.

## Tests carry the site's factual claims

The sims *are* the argument the prose makes, so they are tested rather than trusted. `sims.test.js`
asserts declared invariants over parameter sweeps plus the specific claims the pages make (block
conservation, token budget never exceeded, decode-before-prefill, `slot_mapping` injectivity,
guided decoding never emitting a disallowed token, spec-decode's emitted tokens following
`p_target`, throughput saturating above `B_sat`). When changing a sim, expect to update the
corresponding assertion — and if a page's prose no longer matches, the sim or the prose is wrong.

Test environment is `node`; page tests use `renderToStaticMarkup` (no jsdom, no effects, and
`React.lazy` never resolves — so anything a deep-link test must see has to render outside `Suspense`,
which is why `App.jsx` renders `StageHeader` eagerly. An effect-driven `<Navigate>` redirect cannot
be asserted either, only that no stage content leaked).

## Deployment / base path

`.github/workflows/deploy.yml` on push to `main`: install → **test** → build → `actions/deploy-pages`.
A red suite blocks the deploy by design. Repo Settings → Pages → Source must be **GitHub Actions**.

The site is served from the sub-path `/vllm-explained/`, which breaks silently (blank page, no build
error) if any of these drift. All four are pinned by `src/deploy.test.jsx`:

| Concern | Handled by |
|---|---|
| Asset URLs | `base: '/vllm-explained/'` in `vite.config.js` — **both** slashes matter |
| Router matching | `basename={import.meta.env.BASE_URL}` in `src/main.jsx` |
| Figures | `${import.meta.env.BASE_URL}img/…`, never an absolute `/img/…` |
| Deep links | `githubPagesFallback` plugin copies `index.html` → `404.html` at build time |

Consequence of the 404 fallback: a deep link renders correctly but returns HTTP 404, so crawlers
won't index individual stages.

## Content caveat

The simulators are deliberately small, honest models — not measurements. Absolute milliseconds and
token counts are illustrative; the *relationships* are what's being taught. Diagrams in `public/img/`
are from the original post and belong to its author, and the site is a companion to it, not a
replacement (attribution lives in `source` in `content/roadmap.js`).
