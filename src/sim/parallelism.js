import { defineSim } from './createSim'

/**
 * MultiProcExecutor under tensor parallelism.
 *
 * The mechanics being shown are the message queues: the parent enqueues one work
 * item into a shared-memory rpc_broadcast_mq (non-blocking), every worker is
 * blocked on dequeue, they all execute their shard, and the parent collects from
 * the designated output rank's worker_response_mq.
 *
 * The cost being shown is the all-reduce after each layer. Compute per worker
 * falls as 1/TP while communication *grows* with the group size — which is why
 * TP has a practical ceiling and why it stays inside a node.
 */

// Arbitrary but internally consistent units.
const LAYER_COMPUTE = 8 // cost of one layer on one GPU

/**
 * All-reduce cost per layer. It grows with the number of participants — a
 * ring/tree collective needs more hops as the group widens — which is what
 * makes parallel efficiency fall, and at high cost makes wider TP actively
 * slower. Modelled as commCost * log2(TP), a standard first-order shape.
 */
export function allReduceCost(tpSize, commCost) {
  return tpSize > 1 ? commCost * Math.log2(tpSize) : 0
}

export default defineSim({
  name: 'parallelism',
  params: {
    tpSize: { label: 'Tensor parallel size', options: [1, 2, 4, 8], default: 8 },
    numLayers: { label: 'Layers', min: 2, max: 6, default: 3 },
    commCost: { label: 'All-reduce cost per layer', min: 0, max: 4, step: 0.25, default: 1 },
  },

  init(p) {
    return {
      tick: 0,
      phase: 'idle', // idle | broadcast | compute | allreduce | collect | done
      layer: 0,
      computeTime: 0,
      commTime: 0,
      events: [],
      note: 'workers are blocked on rpc_broadcast_mq.dequeue()',
    }
  },

  step(s, p) {
    const perWorker = LAYER_COMPUTE / p.tpSize
    const comm = allReduceCost(p.tpSize, p.commCost)
    let { phase, layer, computeTime, commTime } = s
    let note = ''
    let event = null

    switch (phase) {
      case 'idle':
        phase = 'broadcast'
        note = `MultiProcExecutor enqueued the work item into rpc_broadcast_mq — non-blocking, all ${p.tpSize} worker(s) wake up`
        event = { kind: 'broadcast', text: 'rpc_broadcast_mq.enqueue(work)' }
        break

      case 'broadcast':
        phase = 'compute'
        note = `layer ${layer}: each worker computes its 1/${p.tpSize} shard — ${perWorker.toFixed(2)} units each instead of ${LAYER_COMPUTE}`
        event = { kind: 'compute', text: `layer ${layer} shard compute` }
        computeTime += perWorker
        break

      case 'compute':
        if (p.tpSize > 1) {
          phase = 'allreduce'
          commTime += comm
          note = `layer ${layer}: all-reduce — every worker needs every other worker's partial result before the next layer can start`
          event = { kind: 'allreduce', text: `all-reduce (${comm.toFixed(2)} units)` }
        } else {
          layer += 1
          if (layer >= p.numLayers) {
            phase = 'collect'
            note = 'all layers done — the parent waits on the output rank\'s worker_response_mq.dequeue()'
            event = { kind: 'collect', text: 'worker_response_mq.dequeue()' }
          } else {
            phase = 'compute'
            computeTime += perWorker
            note = `layer ${layer}: compute`
            event = { kind: 'compute', text: `layer ${layer} compute` }
          }
        }
        break

      case 'allreduce':
        layer += 1
        if (layer >= p.numLayers) {
          phase = 'collect'
          note = `all ${p.numLayers} layers done — the parent collects the result from rank 0's worker_response_mq`
          event = { kind: 'collect', text: 'worker_response_mq.dequeue()' }
        } else {
          phase = 'compute'
          computeTime += perWorker
          note = `layer ${layer}: each worker computes its shard`
          event = { kind: 'compute', text: `layer ${layer} shard compute` }
        }
        break

      case 'collect':
        phase = 'done'
        note = 'execute_model returns. From the engine\'s point of view, nothing about this was different.'
        event = { kind: 'done', text: 'return to EngineCore' }
        break

      default:
        break
    }

    return {
      tick: s.tick + 1,
      phase,
      layer,
      computeTime,
      commTime,
      events: event ? [...s.events, event] : s.events,
      note,
    }
  },

  isDone(s) {
    return s.phase === 'done'
  },

  invariants: [
    (s) => s.commTime >= 0 || 'negative communication time',
    (s, p) => s.layer <= p.numLayers || 'ran more layers than the model has',
    (s, p) =>
      p.tpSize > 1 || s.commTime === 0 || 'TP=1 must not pay any all-reduce cost',
  ],
})

/** Wall-clock model and the parallel efficiency it implies. */
export function tpCost(tpSize, p) {
  const compute = (LAYER_COMPUTE / tpSize) * p.numLayers
  const comm = allReduceCost(tpSize, p.commCost) * p.numLayers
  const total = compute + comm
  const serial = LAYER_COMPUTE * p.numLayers
  return {
    compute,
    comm,
    total,
    speedup: serial / total,
    efficiency: serial / total / tpSize,
  }
}

export { LAYER_COMPUTE }
