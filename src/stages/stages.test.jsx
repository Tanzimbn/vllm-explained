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
