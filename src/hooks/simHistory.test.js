import { describe, expect, it } from 'vitest'
import { advance, advanceToEnd, MAX_HISTORY } from './simHistory'
import { defineSim, paramDefaults } from '../sim/createSim'

/** A trivial counter sim, so the history logic is tested in isolation. */
const counter = defineSim({
  name: 'counter',
  params: { limit: { label: 'limit', min: 1, max: 5000, default: 10 } },
  init: () => ({ n: 0 }),
  step: (s) => ({ n: s.n + 1 }),
  isDone: (s, p) => s.n >= p.limit,
})

const start = (overrides = {}) => {
  const params = { ...paramDefaults(counter), ...overrides }
  return { params, history: [counter.init(params)], idx: 0 }
}

describe('simHistory.advance', () => {
  it('appends exactly one state per call — never two', () => {
    // This is the regression guard: the old implementation called setHistory
    // inside a setState updater, which StrictMode double-invoked.
    let { params, history, idx } = start()
    for (let i = 1; i <= 5; i++) {
      ;({ history, idx } = advance(counter, params, history, idx))
      expect(history.length).toBe(i + 1)
      expect(idx).toBe(i)
      expect(history[idx].n).toBe(i)
    }
  })

  it('is pure — calling it twice with the same input gives the same result', () => {
    const { params, history, idx } = start()
    const a = advance(counter, params, history, idx)
    const b = advance(counter, params, history, idx)
    expect(a.history.length).toBe(b.history.length)
    expect(a.idx).toBe(b.idx)
    expect(history.length).toBe(1) // input untouched
  })

  it('replays an existing future instead of recomputing after stepping back', () => {
    let { params, history, idx } = start()
    for (let i = 0; i < 4; i++) ({ history, idx } = advance(counter, params, history, idx))
    const snapshot = history
    const back = 2
    const r = advance(counter, params, history, back)
    expect(r.history).toBe(snapshot) // same array — nothing appended
    expect(r.idx).toBe(back + 1)
  })

  it('reports done and stops appending at the end', () => {
    let { params, history, idx } = start({ limit: 3 })
    for (let i = 0; i < 3; i++) ({ history, idx } = advance(counter, params, history, idx))
    expect(history[idx].n).toBe(3)
    const r = advance(counter, params, history, idx)
    expect(r.done).toBe(true)
    expect(r.history.length).toBe(history.length)
    expect(r.idx).toBe(idx)
  })

  it('caps history length and keeps the cursor at the newest entry', () => {
    let { params, history, idx } = start({ limit: MAX_HISTORY + 200 })
    for (let i = 0; i < MAX_HISTORY + 50; i++) {
      ;({ history, idx } = advance(counter, params, history, idx))
    }
    expect(history.length).toBe(MAX_HISTORY)
    expect(idx).toBe(MAX_HISTORY - 1)
    expect(history[idx].n).toBe(MAX_HISTORY + 50)
  })
})

describe('simHistory.advanceToEnd', () => {
  it('runs to completion in one call', () => {
    const { params, history, idx } = start({ limit: 25 })
    const r = advanceToEnd(counter, params, history, idx)
    expect(r.history[r.idx].n).toBe(25)
    expect(counter.isDone(r.history[r.idx], params)).toBe(true)
  })

  it('discards a stale future when run from a stepped-back position', () => {
    let { params, history, idx } = start({ limit: 20 })
    for (let i = 0; i < 6; i++) ({ history, idx } = advance(counter, params, history, idx))
    const r = advanceToEnd(counter, params, history, 2)
    // everything after index 2 was recomputed, so length reflects 2 + the run
    expect(r.history[2].n).toBe(2)
    expect(r.history[r.idx].n).toBe(20)
    expect(r.idx).toBe(r.history.length - 1)
  })

  it('is a no-op when already finished', () => {
    const { params } = start({ limit: 1 })
    const history = [{ n: 5 }]
    const r = advanceToEnd(counter, params, history, 0)
    expect(r.history).toBe(history)
    expect(r.idx).toBe(0)
  })
})
