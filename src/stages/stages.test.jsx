import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createElement as h } from 'react'

import { stages } from '../content/roadmap'
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
