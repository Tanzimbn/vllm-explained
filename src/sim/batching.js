import { defineSim, randInt } from './createSim'

/**
 * Static batching vs continuous batching.
 *
 * The whole motivation for everything else in this site lives here: requests
 * finish at wildly different times, so a batch that is admitted and retired as
 * a unit spends most of its life half-empty.
 *
 * One tick == one engine step. A request's first step is its prefill; every
 * step after that is a decode producing one token.
 */

const SEED = 991

export default defineSim({
  name: 'batching',
  params: {
    mode: {
      label: 'Batching',
      options: [
        { value: 'static', label: 'static' },
        { value: 'continuous', label: 'continuous' },
      ],
      default: 'static',
    },
    numRequests: { label: 'Requests', min: 4, max: 12, default: 8 },
    maxBatch: { label: 'Batch slots', min: 1, max: 6, default: 4 },
    spread: { label: 'Output-length spread', min: 0, max: 12, default: 9 },
  },

  init(p) {
    const requests = Array.from({ length: p.numRequests }, (_, i) => ({
      id: `R${i}`,
      idx: i,
      promptLen: 6 + randInt(0, 40, SEED, i, 3),
      outLen: 2 + randInt(0, p.spread, SEED, i, 11),
      generated: 0,
      prefilled: false,
      status: 'waiting', // waiting | running | done
      slot: null,
      admittedAt: null,
      firstTokenAt: null,
      doneAt: null,
    }))
    return {
      tick: 0,
      requests,
      slots: Array(p.maxBatch).fill(null),
      rows: requests.map(() => []),
      wastedSlotSteps: 0,
      busySlotSteps: 0,
      tokensOut: 0,
      note: 'nothing admitted yet',
    }
  },

  step(s, p) {
    const tick = s.tick
    const requests = s.requests.map((r) => ({ ...r }))
    let slots = [...s.slots]
    let note = ''

    // ---- admission ------------------------------------------------------
    const batchInFlight = slots.some((x) => x !== null)
    const canAdmit = p.mode === 'continuous' || !batchInFlight

    if (canAdmit) {
      const before = slots.filter((x) => x === null).length
      for (let si = 0; si < slots.length; si++) {
        if (slots[si] !== null) continue
        const next = requests.find((r) => r.status === 'waiting')
        if (!next) break
        next.status = 'running'
        next.slot = si
        next.admittedAt = tick
        slots[si] = next.idx
      }
      const filled = before - slots.filter((x) => x === null).length
      if (filled > 0) {
        note =
          p.mode === 'static'
            ? `admitted a fresh batch of ${filled} — no new request can join until every one of them finishes`
            : `${filled} request(s) slotted straight into free capacity`
      }
    } else if (p.mode === 'static' && requests.some((r) => r.status === 'waiting')) {
      note = 'requests are waiting, but the batch is locked until its slowest member finishes'
    }

    // ---- one engine step ------------------------------------------------
    const rows = s.rows.map((r) => [...r])
    let wasted = s.wastedSlotSteps
    let busy = s.busySlotSteps
    let tokens = s.tokensOut

    for (let si = 0; si < slots.length; si++) {
      const idx = slots[si]
      if (idx === null) {
        wasted++ // a slot with nothing in it is capacity you paid for and didn't use
        continue
      }
      const r = requests[idx]
      if (r.status === 'done') {
        // Static batching only: the request is finished but its slot stays
        // reserved until the whole batch retires. This is exactly the waste.
        wasted++
        rows[idx][tick] = { kind: 'idle', title: `${r.id} finished — slot held idle` }
        continue
      }
      busy++
      if (!r.prefilled) {
        r.prefilled = true
        r.generated = 1
        r.firstTokenAt = tick
        tokens++
        rows[idx][tick] = { kind: 'prefill', title: `${r.id} prefill (${r.promptLen} tokens)` }
      } else {
        r.generated++
        tokens++
        rows[idx][tick] = { kind: 'decode', title: `${r.id} decode → token ${r.generated}` }
      }
      if (r.generated >= r.outLen) {
        r.status = 'done'
        r.doneAt = tick
      }
    }

    // ---- retirement -----------------------------------------------------
    if (p.mode === 'continuous') {
      // free the slot the instant the request is finished
      for (let si = 0; si < slots.length; si++) {
        const idx = slots[si]
        if (idx !== null && requests[idx].status === 'done') {
          slots[si] = null
          requests[idx].slot = null
        }
      }
    } else {
      // static: the slot stays reserved (and idle) until the whole batch retires
      const allDone = slots.every((x) => x === null || requests[x].status === 'done')
      if (allDone) {
        slots = slots.map(() => null)
        requests.forEach((r) => {
          if (r.status === 'done') r.slot = null
        })
      }
    }

    // fill in the gaps for this tick so the timeline stays rectangular
    requests.forEach((r, i) => {
      if (rows[i][tick]) return
      if (r.status === 'waiting') rows[i][tick] = { kind: 'wait', title: `${r.id} waiting` }
      else if (r.status === 'done')
        rows[i][tick] =
          r.doneAt === tick ? { kind: 'done', title: `${r.id} finished` } : { kind: 'idle' }
      else rows[i][tick] = { kind: 'idle' }
    })

    return {
      tick: tick + 1,
      requests,
      slots,
      rows,
      wastedSlotSteps: wasted,
      busySlotSteps: busy,
      tokensOut: tokens,
      note: note || (p.mode === 'static' ? 'batch grinding on' : 'steady state'),
    }
  },

  isDone(s) {
    return s.requests.every((r) => r.status === 'done')
  },

  invariants: [
    (s, p) => s.slots.length === p.maxBatch || 'slot count must equal maxBatch',
    (s) =>
      s.requests.every((r) => r.generated <= r.outLen) ||
      'a request generated more tokens than it asked for',
    (s) => {
      // no request may occupy two slots
      const occupied = s.slots.filter((x) => x !== null)
      return new Set(occupied).size === occupied.length || 'a request is in two slots at once'
    },
  ],
})

/** Utilization of the paid-for batch capacity, as a percentage. */
export function utilization(s) {
  const total = s.busySlotSteps + s.wastedSlotSteps
  return total === 0 ? 0 : (s.busySlotSteps / total) * 100
}
