import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { inkOn, reqColor, reqInk, C } from './components/viz'

/**
 * The design-system contract.
 *
 * The site is built on Modernist (see the design project's `readme.md`): a light
 * ground, ink, one red accent with 100–900 ramps, and zero corner radius. Those
 * are load-bearing decisions rather than preferences — a stray radius or an
 * ad-hoc hex is how a system quietly stops being one — so they are pinned here
 * the same way the deployment wiring is pinned in deploy.test.jsx.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src', 'index.css'), 'utf8')

describe('Modernist tokens', () => {
  it('defines the ground, the ink and the single accent', () => {
    expect(css).toMatch(/--color-surface:\s*#f3f2f2/)
    expect(css).toMatch(/--color-ink:\s*#201e1d/)
    expect(css).toMatch(/--color-accent:\s*#ec3013/)
  })

  it('carries a full 100-900 step for both ramps', () => {
    for (const step of [100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      expect(css, `neutral-${step}`).toMatch(new RegExp(`--color-neutral-${step}:\\s*#`))
      expect(css, `accent-${step}`).toMatch(new RegExp(`--color-accent-${step}:\\s*#`))
    }
  })

  it('zeroes the radius scale rather than editing call sites', () => {
    // Every `rounded-*` utility in the components resolves through these, so a
    // non-zero value here would round hundreds of corners at once.
    const radii = [...css.matchAll(/--radius-[\w-]+:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(radii.length).toBeGreaterThan(4)
    radii.forEach((r) => expect(r).toBe('0px'))
  })

  it('sets Archivo as both the heading and body face', () => {
    expect(css).toMatch(/--font-heading:\s*'Archivo'/)
    expect(css).toMatch(/--font-sans:\s*'Archivo'/)
  })

  it('loads Archivo with the display weights the system uses', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8')
    expect(html).toContain('family=Archivo')
    expect(html).toMatch(/800/) // headings are 800, display figures 900
    expect(html).toContain('display=swap')
  })

  it('pairs every role fill with the text colour that belongs on it', () => {
    // A light ground means some role fills are dark and some are light, so the
    // pairing cannot be guessed at the call site.
    for (const role of ['prefill', 'decode', 'free', 'alloc', 'cached', 'partial']) {
      expect(css, role).toMatch(new RegExp(`--color-${role}:`))
      expect(css, `${role}-ink`).toMatch(new RegExp(`--color-${role}-ink:`))
    }
  })
})

describe('text on a fill', () => {
  it('puts ground on dark role fills and ink on light ones', () => {
    expect(inkOn(C.prefill)).toBe('var(--color-prefill-ink)')
    expect(inkOn(C.partial)).toBe('var(--color-partial-ink)')
  })

  it('reads lightness out of a reqColor to pick a side', () => {
    // base is dark (L 42) → ground; the light variant (L 74) → ink
    expect(reqInk(0)).toBe(C.bg)
    expect(reqInk(0, { light: true })).toBe(C.ink)
  })

  it('falls back to ink for an unknown fill rather than throwing', () => {
    expect(inkOn(undefined)).toBe(C.ink)
    expect(inkOn('#123456')).toBe(C.ink)
  })
})

describe('request identity colours', () => {
  it('is stable per index, so request #2 looks the same in every sim', () => {
    expect(reqColor(2)).toBe(reqColor(2))
    expect(reqColor(2)).not.toBe(reqColor(3))
  })

  it('wraps rather than running off the end of the hue list', () => {
    expect(reqColor(0)).toBe(reqColor(10))
  })

  it('stays muted enough to sit on a light ground', () => {
    // Full-saturation hues would fight the mono chrome; the set is pulled down
    // so it reads as one printed-ink family.
    for (let i = 0; i < 10; i++) {
      const [, s, l] = /hsl\(\d+ (\d+)% (\d+)%\)/.exec(reqColor(i)).map(Number)
      expect(s).toBeLessThanOrEqual(45)
      expect(l).toBeLessThanOrEqual(50)
    }
  })
})
