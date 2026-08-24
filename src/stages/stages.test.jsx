import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createElement as h } from 'react'

import { bridgeFor, chapters, stages, stagesOf } from '../content/roadmap'
import RoadmapMap from './RoadmapMap'

import PrefillVsDecode from './PrefillVsDecode'
import EngineAnatomy from './EngineAnatomy'
import PagedAttention from './PagedAttention'
import Scheduler from './Scheduler'
import ForwardPass from './ForwardPass'
import ChunkedPrefill from './ChunkedPrefill'
import PrefixCaching from './PrefixCaching'
import GuidedDecoding from './GuidedDecoding'
import SpeculativeDecoding from './SpeculativeDecoding'
import DisaggregatedPD from './DisaggregatedPD'
import MultiProcExecutor from './MultiProcExecutor'
import DistributedServing from './DistributedServing'
import Benchmarking from './Benchmarking'

/**
 * Render smoke tests. A module can transform and bundle perfectly and still
 * throw the moment React calls it (undefined variable, bad prop shape, NaN in
 * an SVG path). These mount every page at its initial state and assert it
 * produces real markup.
 */

const PAGES = {
  'prefill-vs-decode': PrefillVsDecode,
  'engine-anatomy': EngineAnatomy,
  'paged-attention': PagedAttention,
  scheduler: Scheduler,
  'forward-pass': ForwardPass,
  'chunked-prefill': ChunkedPrefill,
  'prefix-caching': PrefixCaching,
  'guided-decoding': GuidedDecoding,
  'speculative-decoding': SpeculativeDecoding,
  'disaggregated-pd': DisaggregatedPD,
  'multiproc-executor': MultiProcExecutor,
  'distributed-serving': DistributedServing,
  benchmarking: Benchmarking,
}

const render = (Comp) => renderToStaticMarkup(h(MemoryRouter, null, h(Comp)))

describe('every stage renders', () => {
  it('the roadmap map renders and links every stage', () => {
    const html = render(RoadmapMap)
    expect(html.length).toBeGreaterThan(2000)
    stages.forEach((s) => expect(html).toContain(`/stage/${s.slug}`))
  })

  for (const [slug, Comp] of Object.entries(PAGES)) {
    it(`${slug} renders without throwing`, () => {
      const html = render(Comp)
      expect(html.length).toBeGreaterThan(1500)
      // a stage without a simulator would be a content bug
      expect(html).toContain('simulator')
    })
  }
})

describe('routing and content wiring', () => {
  it('the roadmap declares a page for every stage, and vice versa', () => {
    const slugs = stages.map((s) => s.slug).sort()
    expect(Object.keys(PAGES).sort()).toEqual(slugs)
  })

  it('stage numbers are contiguous from 1', () => {
    stages.forEach((s, i) => expect(s.n).toBe(i + 1))
  })

  it('every stage builds only on stages that came before it', () => {
    const byNumber = new Map(stages.map((s) => [s.n, s]))
    stages.forEach((s) => {
      expect(Array.isArray(s.prereq), `${s.slug} has no prereq list`).toBe(true)
      s.prereq.forEach((n) => {
        expect(byNumber.has(n), `${s.slug} names a stage ${n} that does not exist`).toBe(true)
        expect(n, `${s.slug} cannot build on a later stage`).toBeLessThan(s.n)
      })
    })
    // Stage 01 is the entry point and depends on nothing.
    expect(stages[0].prereq).toEqual([])
  })

  it('every stage names its chapter, concepts, and simulators', () => {
    stages.forEach((s) => {
      expect(s.chapter).toMatch(/^ch[1-6]$/)
      expect(s.concepts.length).toBeGreaterThan(2)
      expect(s.sims.length).toBeGreaterThan(0)
      expect(s.hook.length).toBeGreaterThan(20)
    })
  })
})

/**
 * The two-pane stage layout, pinned.
 *
 * Every stage puts its primary simulator in a sticky right-hand pane and its
 * prose on the left, and several pages say "the panel on the right" in so many
 * words. Losing the sticky pane, or letting the simulator fall back into the
 * prose flow, would make that copy wrong while still rendering fine — so it is
 * asserted rather than trusted.
 */
describe('every stage is laid out as prose + a pinned simulator', () => {
  for (const [slug, Comp] of Object.entries(PAGES)) {
    it(`${slug} puts its simulator in the sticky pane`, () => {
      const html = render(Comp)
      const article = html.indexOf('<article')
      const aside = html.indexOf('<aside')
      expect(article, 'no prose pane').toBeGreaterThan(-1)
      expect(aside, 'no simulator pane').toBeGreaterThan(-1)
      // Prose first in the DOM; CSS `order` puts the pane first on narrow screens.
      expect(article).toBeLessThan(aside)
      expect(html).toContain('lg:sticky')
      // The transport and the simulator chrome live inside the pane, not the prose.
      const pane = html.slice(aside)
      expect(pane, 'simulator chrome is not in the pane').toContain('simulator')
      expect(pane, 'step controls are not in the pane').toContain('▶ Step')
    })
  }

  it('gives the pane the full width in focus mode, with no prose sliver left', async () => {
    const { paneLayout } = await import('../components/layout/StageLayout')
    const open = paneLayout(false)
    const focus = paneLayout(true)

    // open: two tracks, prose in flow
    expect(open.main).toContain('1.06fr')
    expect(open.article).not.toContain('lg:hidden')

    // focus: one track, and the prose out of flow entirely. Collapsing the track
    // to 0px is not enough — border-box keeps the article's padding and 2px rule
    // on screen as a sliver.
    expect(focus.main).toContain('lg:grid-cols-[minmax(0,1fr)]')
    expect(focus.main).not.toContain('0px')
    expect(focus.article).toContain('lg:hidden')
  })

  it('reserves SimFrame for the stages that have a second simulator', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const stagesDir = dirname(fileURLToPath(import.meta.url))

    const inline = []
    for (const f of readdirSync(stagesDir)) {
      if (!f.endsWith('.jsx') || f.endsWith('.test.jsx')) continue
      if (readFileSync(join(stagesDir, f), 'utf8').includes('<SimFrame')) inline.push(f)
    }
    // Only these two stages ship a secondary simulator inline in the prose.
    expect(inline.sort()).toEqual(['Benchmarking.jsx', 'ForwardPass.jsx'])
  })
})

describe('blog figures resolve to downloaded files', () => {
  it('every referenced image exists in public/img', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    // Resolve relative to this file, not the cwd vitest happened to start in.
    const stagesDir = dirname(fileURLToPath(import.meta.url))
    const root = join(stagesDir, '..', '..')

    const onDisk = new Set(readdirSync(join(root, 'public', 'img')))
    const referenced = new Set()
    for (const f of readdirSync(stagesDir)) {
      if (!f.endsWith('.jsx')) continue
      const src = readFileSync(join(stagesDir, f), 'utf8')
      for (const m of src.matchAll(/src="([\w-]+\.png)"/g)) referenced.add(m[1])
    }
    expect(referenced.size).toBeGreaterThan(10)
    referenced.forEach((img) => expect(onDisk, `missing ${img}`).toContain(img))
  })
})

/**
 * The prose is the other half of the teaching, so it gets the same treatment as
 * the sims: the claims about how it reads are asserted, not trusted.
 *
 * Everything here measures the *rendered* article — what a reader actually sees
 * — rather than the JSX source, so a sentence split across three source lines
 * counts once and a `className` never counts at all.
 */

/** Visible text of the prose pane, one entry per paragraph or list item. */
function proseBlocks(html) {
  const article = html.slice(html.indexOf('<article'), html.indexOf('</article>'))
  return [...article.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) =>
    m[2]
      .replace(/<[^>]*>/g, ' ')
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * Sentences never run across a block boundary: a list of four items ending in
 * semicolons is four sentences, not one 90-word monster.
 */
function sentences(blocks) {
  return blocks
    .flatMap((b) => b.split(/(?<=[.!?])\s+(?=[A-Z(“"'`])/))
    .map((x) => x.trim())
    .filter((x) => x.split(/\s+/).length > 3)
}

function readability(html) {
  const all = sentences(proseBlocks(html))
  const lengths = all.map((s) => s.split(/\s+/).length)
  return {
    count: all.length,
    avg: lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1),
    longest: all[lengths.indexOf(Math.max(...lengths))] ?? '',
    max: Math.max(0, ...lengths),
  }
}

/**
 * A ratchet, not a target. These are the numbers each stage reads at today; the
 * rule is that a change may lower them and may never raise them. The bar a
 * rewritten stage aims for is the one `engine-anatomy` already meets — an
 * average under 18 words and no sentence over 35 — so the remaining rows are a
 * to-do list in numeric form.
 */
const READABILITY_BUDGET = {
  'prefill-vs-decode': { avg: 15.0, max: 29 },
  'engine-anatomy': { avg: 16.0, max: 30 },
  'paged-attention': { avg: 16.0, max: 31 },
  scheduler: { avg: 15.5, max: 28 },
  'forward-pass': { avg: 17.0, max: 35 },
  'chunked-prefill': { avg: 18.0, max: 33 },
  'prefix-caching': { avg: 20.5, max: 40 },
  'guided-decoding': { avg: 18.0, max: 45 },
  'speculative-decoding': { avg: 16.0, max: 37 },
  'disaggregated-pd': { avg: 17.0, max: 30 },
  'multiproc-executor': { avg: 18.5, max: 38 },
  'distributed-serving': { avg: 17.0, max: 44 },
  benchmarking: { avg: 17.0, max: 57 },
}

describe('the prose reads for a beginner', () => {
  it('budgets every stage, so a new one cannot skip the check', () => {
    expect(Object.keys(READABILITY_BUDGET).sort()).toEqual(Object.keys(PAGES).sort())
  })

  for (const [slug, Comp] of Object.entries(PAGES)) {
    it(`${slug} does not get harder to read`, () => {
      const r = readability(render(Comp))
      const budget = READABILITY_BUDGET[slug]

      expect(r.count, 'no prose found — did the article markup change?').toBeGreaterThan(20)
      expect(
        Number(r.avg.toFixed(1)),
        `average sentence is ${r.avg.toFixed(1)} words, budget ${budget.avg}. Lower the budget when you shorten the prose; never raise it.`
      ).toBeLessThanOrEqual(budget.avg)
      expect(
        r.max,
        `longest sentence is ${r.max} words, budget ${budget.max}:\n  "${r.longest}"`
      ).toBeLessThanOrEqual(budget.max)
    })
  }

  it('never leaves a cross-stage reference as bare prose', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const stagesDir = dirname(fileURLToPath(import.meta.url))

    const offenders = []
    for (const f of readdirSync(stagesDir)) {
      if (!f.endsWith('.jsx') || f.endsWith('.test.jsx')) continue
      // The map's "Start at stage 01" is a call to action, not a reference.
      if (f === 'RoadmapMap.jsx') continue
      const src = readFileSync(join(stagesDir, f), 'utf8')
      for (const m of src.matchAll(/stage \d\d/g)) offenders.push(`${f}: "${m[0]}"`)
    }
    expect(
      offenders,
      'write <StageRef n={7} /> instead — a beginner needs to be able to follow a forward reference'
    ).toEqual([])
  })
})

describe('acts hand off to each other', () => {
  it('every act but the last carries a handoff, and it lands on that act’s final stage', () => {
    chapters.forEach((ch, i) => {
      const last = stagesOf(ch.id).at(-1)
      const isFinalAct = i === chapters.length - 1

      expect(Boolean(ch.handoff), `${ch.id} handoff`).toBe(!isFinalAct)
      stagesOf(ch.id).forEach((s) => {
        const expected = !isFinalAct && s.slug === last.slug
        expect(Boolean(bridgeFor(s.slug)), `bridge on ${s.slug}`).toBe(expected)
      })
    })
  })

  it('renders the bridge at the foot of the act, pointing at the next act', () => {
    const html = render(PAGES['engine-anatomy'])
    const bridge = bridgeFor('engine-anatomy')
    expect(html).toContain('End of this act')
    expect(html).toContain(bridge.have)
    expect(html).toContain(`/stage/${bridge.firstStage.slug}`)
    // A mid-act stage gets nothing.
    expect(render(PAGES['prefill-vs-decode'])).not.toContain('End of this act')
  })
})
