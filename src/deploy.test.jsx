import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createElement as h } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import App from './App'
import { stages } from './content/roadmap'

/**
 * Deployment wiring, verified without a browser.
 *
 * GitHub Pages serves this site from a sub-path, which breaks three things if
 * they aren't set up: asset URLs, router matching, and deep links. These tests
 * pin all three, since a mistake there produces a blank page rather than an
 * error anyone would notice in the build log.
 */

const BASE = '/vllm-explained/'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Render the whole app as the browser would at a given Pages URL. */
function renderAt(url, basename = BASE) {
  return renderToStaticMarkup(
    h(MemoryRouter, { basename, initialEntries: [url] }, h(App)),
  )
}

describe('routing under a GitHub Pages sub-path', () => {
  it('serves the roadmap at the base path', () => {
    const html = renderAt(BASE)
    expect(html).toContain('Inside vLLM')
    expect(html).toContain('interactive companion')
  })

  it('resolves every deep link to its own stage', () => {
    const escape = (t) => t.replace(/&/g, '&amp;') // titles land in HTML text
    stages.forEach((s) => {
      const html = renderAt(`${BASE}stage/${s.slug}`)
      expect(html, `stage/${s.slug} did not render`).toContain(
        `stage ${String(s.n).padStart(2, '0')}`,
      )
      expect(html).toContain(escape(s.title))
    })
  })

  it('emits links that already carry the base path', () => {
    const html = renderAt(BASE)
    expect(html).toContain(`href="${BASE}stage/${stages[0].slug}"`)
    // and never a bare, base-less internal link
    expect(html).not.toMatch(/href="\/stage\//)
  })

  it('cross-references inside stage prose respect the base path', () => {
    // PrefillVsDecode links to stage 05 mid-sentence; as a plain <a href="/...">
    // that would escape the sub-path and 404.
    const html = renderAt(`${BASE}stage/prefill-vs-decode`)
    expect(html).toContain(`href="${BASE}stage/forward-pass"`)
  })

  it('handles an unknown path without crashing', () => {
    // The recovery itself is a <Navigate>, which redirects from an effect —
    // renderToStaticMarkup runs no effects, so all that can be checked here is
    // that the shell renders and no stage content leaks through.
    const html = renderAt(`${BASE}stage/does-not-exist`)
    expect(html).toContain('min-h-screen')
    expect(html).not.toContain('simulator')
  })

  it('still works when served from a domain root', () => {
    const html = renderAt('/stage/scheduler', '/')
    expect(html).toContain('The scheduler')
  })
})

describe('build config', () => {
  it('base has both leading and trailing slashes', () => {
    // '/vllm-explained' without the trailing slash, or 'vllm-explained' without
    // the leading one, both silently produce broken asset URLs on deep routes.
    const cfg = readFileSync(join(root, 'vite.config.js'), 'utf8')
    const m = cfg.match(/base:\s*process\.env\.BASE_PATH\s*\?\?\s*'([^']+)'/)
    expect(m, 'base not found in vite.config.js').toBeTruthy()
    expect(m[1]).toBe(BASE)
    expect(m[1].startsWith('/')).toBe(true)
    expect(m[1].endsWith('/')).toBe(true)
  })

  it('the router basename is driven by Vite base, not hardcoded', () => {
    const main = readFileSync(join(root, 'src', 'main.jsx'), 'utf8')
    expect(main).toContain('basename={import.meta.env.BASE_URL}')
  })

  it('figures are prefixed with BASE_URL rather than an absolute /img/', () => {
    const ui = readFileSync(join(root, 'src', 'components', 'ui', 'index.jsx'), 'utf8')
    expect(ui).toContain('${import.meta.env.BASE_URL}img/')
    expect(ui).not.toMatch(/src=\{`\/img\//)
  })

  it('the workflow tests before it builds', () => {
    const wf = readFileSync(join(root, '.github', 'workflows', 'deploy.yml'), 'utf8')
    expect(wf).toMatch(/run:\s*npm run test/)
    expect(wf.indexOf('npm run test')).toBeLessThan(wf.indexOf('npm run build'))
    expect(wf).toContain('actions/deploy-pages')
  })
})
