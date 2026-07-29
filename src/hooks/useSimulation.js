import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { checkInvariants, paramDefaults } from '../sim/createSim'
import { advance, advanceToEnd } from './simHistory'

const SPEEDS = [0.5, 1, 2, 4]

/**
 * Drives any module built with `defineSim`.
 *
 * Because sims are pure, history is just an array of snapshots — which is how
 * `back()` works with no effort from the sim author. Changing any param resets.
 *
 * All history arithmetic happens in pure helpers (see simHistory.js) *before*
 * any setState call, never inside an updater — StrictMode double-invokes
 * updaters, and a nested setState there would double every tick.
 *
 * Returns everything <SimFrame> needs, so a new simulator on this site is
 * "write one pure file + one render function" with zero clock plumbing.
 */
export function useSimulation(sim, overrides = {}) {
  const defaults = useMemo(() => ({ ...paramDefaults(sim), ...overrides }), [sim])
  const [params, setParams] = useState(defaults)
  const [history, setHistory] = useState(() => [sim.init(defaults)])
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  const state = history[idx]
  const done = sim.isDone(state, params)

  const restart = useCallback(
    (p) => {
      setHistory([sim.init(p)])
      setIdx(0)
      setPlaying(false)
    },
    [sim],
  )

  const setParam = useCallback(
    (key, value) => {
      const next = { ...params, [key]: value }
      setParams(next)
      // Params are structural, so mid-run changes would produce an incoherent
      // trace. Restart instead — cheap, and keeps every sim honest.
      restart(next)
    },
    [params, restart],
  )

  const step = useCallback(() => {
    const r = advance(sim, params, history, idx)
    if (r.done) {
      setPlaying(false)
      return
    }
    if (r.history !== history) setHistory(r.history)
    setIdx(r.idx)
  }, [history, idx, params, sim])

  const back = useCallback(() => {
    setPlaying(false)
    setIdx((i) => Math.max(0, i - 1))
  }, [])

  const toEnd = useCallback(() => {
    setPlaying(false)
    const r = advanceToEnd(sim, params, history, idx)
    if (r.history === history) return
    setHistory(r.history)
    setIdx(r.idx)
  }, [history, idx, params, sim])

  // Clock. stepRef keeps the interval callback pointed at the latest closure
  // so it always sees current history/idx.
  const stepRef = useRef(step)
  stepRef.current = step
  useEffect(() => {
    if (!playing) return
    if (done) {
      setPlaying(false)
      return
    }
    const id = setInterval(() => stepRef.current(), 620 / speed)
    return () => clearInterval(id)
  }, [playing, speed, done])

  // Dev-only correctness net: the sims carry the site's factual claims.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const problems = checkInvariants(sim, state, params)
    if (problems.length) {
      console.warn(`[sim:${sim.name}] invariant violation`, problems, state)
    }
  }, [sim, state, params])

  return {
    state,
    params,
    setParam,
    paramSpec: sim.params,
    tick: idx,
    total: history.length - 1,
    playing,
    done,
    speed,
    speeds: SPEEDS,
    setSpeed,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    toggle: () => setPlaying((p) => !p),
    step,
    back,
    toEnd,
    reset: () => restart(params),
    canBack: idx > 0,
  }
}
