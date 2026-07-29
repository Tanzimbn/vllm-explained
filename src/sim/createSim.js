/**
 * The simulator contract.
 *
 * Every simulator on this site is a *pure* module — no React, no DOM, no time,
 * no Math.random(). That buys three things:
 *   1. `useSimulation` can implement step-backwards by simply keeping snapshots.
 *   2. Sims are unit-testable, so the claims the prose makes are executable.
 *   3. Replays are exact.
 *
 * Shape:
 *   defineSim({
 *     name,
 *     params:  { key: { label, min, max, step, default, unit? } | { label, options, default } },
 *     init:    (p) => state,        // must be deterministic in p
 *     step:    (state, p) => state, // one tick; must not mutate `state`
 *     isDone:  (state, p) => bool,
 *     invariants: [ (state, p) => true|string ],   // checked in dev
 *   })
 */

export function defineSim(spec) {
  const { name, params = {}, init, step, isDone = () => false, invariants = [] } = spec
  if (typeof init !== 'function') throw new Error(`sim "${name}": init must be a function`)
  if (typeof step !== 'function') throw new Error(`sim "${name}": step must be a function`)
  return { name, params, init, step, isDone, invariants }
}

/** Default values for a sim's declared params. */
export function paramDefaults(sim) {
  const out = {}
  for (const [k, def] of Object.entries(sim.params)) out[k] = def.default
  return out
}

/**
 * Stateless hash-based randomness.
 * Because it derives from (seed, tick, salt) rather than a mutable stream,
 * stepping backwards and replaying produce identical values.
 */
export function rand(...nums) {
  let h = 2166136261 >>> 0
  for (const n of nums) {
    let x = Math.imul(Number(n) | 0, 0x9e3779b1) >>> 0
    h = (h ^ x) >>> 0
    h = Math.imul(h, 16777619) >>> 0
    h = (h ^ (h >>> 13)) >>> 0
  }
  h = (h ^ (h >>> 16)) >>> 0
  return h / 4294967296
}

/** Integer in [lo, hi] inclusive, from the stateless stream. */
export function randInt(lo, hi, ...salt) {
  return lo + Math.floor(rand(...salt) * (hi - lo + 1))
}

/** Poisson-ish inter-arrival gap in ticks, mean `mean`, from the stateless stream. */
export function randGap(mean, ...salt) {
  const u = Math.max(1e-6, rand(...salt))
  return Math.max(1, Math.round(-Math.log(u) * mean))
}

/** Run a sim's invariants; returns an array of violation messages (empty === healthy). */
export function checkInvariants(sim, state, params) {
  const problems = []
  for (const inv of sim.invariants) {
    let res
    try {
      res = inv(state, params)
    } catch (e) {
      res = e.message
    }
    if (res !== true && res !== undefined) {
      problems.push(typeof res === 'string' ? res : `invariant failed in "${sim.name}"`)
    }
  }
  return problems
}

/** Advance a sim n ticks from a fresh init. Used heavily by the tests. */
export function runSim(sim, overrides = {}, ticks = 200) {
  const params = { ...paramDefaults(sim), ...overrides }
  let state = sim.init(params)
  const trace = [state]
  for (let i = 0; i < ticks && !sim.isDone(state, params); i++) {
    state = sim.step(state, params)
    trace.push(state)
  }
  return { state, trace, params }
}

export const ceilDiv = (a, b) => Math.ceil(a / b)
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
export const sum = (xs) => xs.reduce((a, b) => a + b, 0)
