/**
 * The history bookkeeping behind `useSimulation`, kept as pure functions.
 *
 * These used to live inside React state updaters, which was a bug: StrictMode
 * double-invokes updaters in development, so a nested setState appended every
 * tick twice. Pure functions computed *before* setState avoid that entirely —
 * and can be unit-tested without a renderer.
 */

export const MAX_HISTORY = 600

/**
 * Advance one tick. Re-uses an already-computed future when the user has
 * stepped back, so `back` then `step` replays rather than recomputes.
 */
export function advance(sim, params, history, idx) {
  if (idx < history.length - 1) {
    return { history, idx: idx + 1, done: false }
  }
  const cur = history[idx]
  if (sim.isDone(cur, params)) {
    return { history, idx, done: true }
  }
  const next = sim.step(cur, params)
  const grown = [...history, next]
  const trimmed =
    grown.length > MAX_HISTORY ? grown.slice(grown.length - MAX_HISTORY) : grown
  return { history: trimmed, idx: trimmed.length - 1, done: false }
}

/** Run forward from `idx` until the sim reports done (bounded). */
export function advanceToEnd(sim, params, history, idx) {
  let cur = history[idx]
  const extra = []
  let guard = 0
  while (!sim.isDone(cur, params) && guard++ < MAX_HISTORY) {
    cur = sim.step(cur, params)
    extra.push(cur)
  }
  if (!extra.length) return { history, idx }
  const grown = [...history.slice(0, idx + 1), ...extra]
  const trimmed =
    grown.length > MAX_HISTORY ? grown.slice(grown.length - MAX_HISTORY) : grown
  return { history: trimmed, idx: trimmed.length - 1 }
}
