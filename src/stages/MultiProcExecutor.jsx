import { useSimulation } from '../hooks/useSimulation'
import parallelism, { LAYER_COMPUTE, tpCost } from '../sim/parallelism'
import {
  BlogFigure,
  Callout,
  Card,
  Code,
  CodeBlock,
  SimFrame,
  StatTile,
  Takeaways,
} from '../components/ui'
import { C, LineChart } from '../components/viz'

const WORKER_STATE = {
  idle: { label: 'blocked on dequeue', color: C.free },
  broadcast: { label: 'woken', color: C.warn },
  compute: { label: 'computing shard', color: C.decode },
  allreduce: { label: 'all-reduce', color: C.prefill },
  collect: { label: 'responding', color: C.cached },
  done: { label: 'blocked on dequeue', color: C.free },
}

function TpViz({ sim }) {
  const { state, params } = sim
  const cost = tpCost(params.tpSize, params)
  const ws = WORKER_STATE[state.phase] ?? WORKER_STATE.idle

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="compute per worker"
          value={cost.compute.toFixed(1)}
          hint={`${LAYER_COMPUTE} units per layer ÷ TP=${params.tpSize}`}
        />
        <StatTile
          label="communication"
          value={cost.comm.toFixed(1)}
          tone={cost.comm > cost.compute ? 'bad' : 'warn'}
        />
        <StatTile label="speedup" value={`${cost.speedup.toFixed(2)}×`} tone="accent" />
        <StatTile
          label="parallel efficiency"
          value={(cost.efficiency * 100).toFixed(0)}
          unit="%"
          tone={cost.efficiency > 0.7 ? 'good' : cost.efficiency > 0.4 ? 'warn' : 'bad'}
          hint="Speedup ÷ number of GPUs. 100% would be perfect scaling."
        />
      </div>

      {/* the parent + queues + workers */}
      <div className="space-y-3">
        <div className="rounded-lg border border-edge bg-panel-2/40 px-3 py-2">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[0.68rem] text-ink">MultiProcExecutor (parent)</span>
            <span className="font-mono text-[0.6rem] text-ink-faint">{state.phase}</span>
          </div>
        </div>

        {/* broadcast queue */}
        <div className="flex items-center gap-2">
          <span className="w-32 shrink-0 text-right font-mono text-[0.6rem] text-ink-faint">
            rpc_broadcast_mq
          </span>
          <div
            className="h-6 flex-1 rounded-md border transition-colors"
            style={{
              borderColor: state.phase === 'broadcast' ? C.warn : C.edge,
              background: state.phase === 'broadcast' ? 'rgba(224,179,65,0.14)' : 'transparent',
            }}
          >
            <span className="ml-2 font-mono text-[0.6rem] leading-6" style={{ color: state.phase === 'broadcast' ? C.warn : C.faint }}>
              {state.phase === 'broadcast' ? 'work item → all ranks' : 'empty (shared memory)'}
            </span>
          </div>
        </div>

        {/* the workers */}
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${Math.min(params.tpSize, 4)}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: params.tpSize }, (_, rank) => (
            <div
              key={rank}
              className="rounded-md border px-2 py-1.5 transition-colors duration-200"
              style={{
                borderColor: state.phase === 'idle' || state.phase === 'done' ? C.edge : ws.color,
                background:
                  state.phase === 'idle' || state.phase === 'done'
                    ? 'transparent'
                    : `${ws.color}1f`,
              }}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[0.62rem] text-ink">rank {rank}</span>
                {rank === 0 && (
                  <span className="font-mono text-[0.52rem]" style={{ color: C.accent ?? C.decode }}>
                    driver
                  </span>
                )}
              </div>
              <div className="font-mono text-[0.52rem] text-ink-faint">
                1/{params.tpSize} of each weight matrix
              </div>
              <div className="mt-1 font-mono text-[0.55rem]" style={{ color: ws.color }}>
                {ws.label}
              </div>
            </div>
          ))}
        </div>

        {/* response queue */}
        <div className="flex items-center gap-2">
          <span className="w-32 shrink-0 text-right font-mono text-[0.6rem] text-ink-faint">
            worker_response_mq
          </span>
          <div
            className="h-6 flex-1 rounded-md border transition-colors"
            style={{
              borderColor: state.phase === 'collect' || state.phase === 'done' ? C.cached : C.edge,
              background:
                state.phase === 'collect' || state.phase === 'done'
                  ? 'rgba(93,219,164,0.12)'
                  : 'transparent',
            }}
          >
            <span
              className="ml-2 font-mono text-[0.6rem] leading-6"
              style={{ color: state.phase === 'collect' || state.phase === 'done' ? C.cached : C.faint }}
            >
              {state.phase === 'collect' || state.phase === 'done'
                ? 'result ← output rank'
                : 'parent waiting'}
            </span>
          </div>
        </div>
      </div>

      {/* layer progress */}
      <div>
        <div className="mb-2 font-mono text-[0.62rem] tracking-widest text-ink-faint uppercase">
          layers · compute then all-reduce, per layer
        </div>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: params.numLayers }, (_, l) => (
            <div key={l} className="flex items-center gap-[2px]">
              <span
                className="flex h-6 w-8 items-center justify-center rounded-l-[3px] font-mono text-[0.55rem]"
                style={{
                  background: l < state.layer || (l === state.layer && state.phase !== 'broadcast') ? C.decode : C.free,
                  color: l <= state.layer ? '#08090d' : C.faint,
                }}
                title={`layer ${l} shard compute`}
              >
                L{l}
              </span>
              {params.tpSize > 1 && (
                <span
                  className="flex h-6 w-5 items-center justify-center rounded-r-[3px] font-mono text-[0.55rem]"
                  style={{
                    background:
                      l < state.layer || (l === state.layer && state.phase === 'allreduce')
                        ? C.prefill
                        : C.free,
                    color: l < state.layer ? '#08090d' : C.faint,
                  }}
                  title="all-reduce"
                >
                  ↔
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <p className="rounded-md bg-panel-2/50 px-3 py-2 font-mono text-[0.7rem] leading-relaxed text-ink-dim">
        <span className="text-accent">tick {state.tick}:</span> {state.note}
      </p>
    </div>
  )
}

function ScalingChart({ params }) {
  const sizes = [1, 2, 4, 8, 16, 32]
  const curve = (commCost) =>
    sizes.map((tp) => [tp, tpCost(tp, { ...params, commCost }).speedup])
  return (
    <LineChart
      height={200}
      xLabel="tensor parallel size"
      yLabel="speedup ×"
      xTicks={sizes}
      yTicks={[1, 4, 8, 16]}
      series={[
        {
          label: 'ideal',
          points: sizes.map((tp) => [tp, tp]),
          color: C.faint,
          dashed: true,
        },
        { label: 'comm 0.25', points: curve(0.25), color: C.good },
        { label: 'comm 1', points: curve(1), color: C.decode },
        { label: 'comm 2', points: curve(2), color: C.warn },
        { label: 'comm 4', points: curve(4), color: C.bad },
      ]}
      markers={[{ x: params.tpSize, label: `TP=${params.tpSize}`, color: C.faint }]}
    />
  )
}

export default function MultiProcExecutor() {
  const sim = useSimulation(parallelism)

  return (
    <>
      <p>
        Everything so far assumed the model fits on one GPU. When it doesn't, you shard it — and the
        engine needs an orchestration layer to drive several worker processes as if they were one.
        That layer is <Code>MultiProcExecutor</Code>, and the remarkable thing about it is how little
        the rest of the engine notices.
      </p>

      <h3>Two ways to split a model</h3>
      <p>
        <strong>Tensor parallelism (TP)</strong> shards individual weight matrices across GPUs, so
        every GPU holds a slice of every layer and they cooperate on each one. That cooperation means
        an all-reduce after each sharded block — a lot of communication, which is why TP is normally
        kept <em>within</em> a node where interconnect bandwidth is high.
      </p>
      <p>
        <strong>Pipeline parallelism (PP)</strong> assigns whole layers to different GPUs, so
        activations are passed forward once per stage boundary. It communicates far less data than
        TP, which makes it the option for spanning nodes — but it introduces pipeline bubbles.
      </p>

      <Callout kind="note" title="The usual ordering">
        <p>
          Intranode bandwidth is significantly higher than internode, so TP is generally preferred —
          fill a node with TP first, then reach for PP across nodes if the model still doesn't fit.
          (Expert parallelism for MoE models and sequence parallelism also exist; TP and PP are what
          you meet in practice for a standard transformer.)
        </p>
      </Callout>

      <SimFrame
        sim={sim}
        keys
        title="One forward pass at TP=8"
        subtitle="Step through the queue handshake and per-layer compute/all-reduce cycle. Then raise the all-reduce cost and watch parallel efficiency fall apart."
        legend={[
          { label: 'shard compute', color: C.decode },
          { label: 'all-reduce', color: C.prefill },
          { label: 'queue active', color: C.warn },
          { label: 'result returned', color: C.cached },
        ]}
        footer={
          <>
            The number to watch is parallel efficiency. Compute per worker falls as{' '}
            <Code>1/TP</Code>, while the all-reduce cost per layer <em>grows</em> with the group
            size — a wider collective needs more hops. So past some point you're adding GPUs mainly
            to pay for more communication. This is the entire reason TP isn't simply set as high as
            you have GPUs.
          </>
        }
      >
        <TpViz sim={sim} />
      </SimFrame>

      <BlogFigure
        src="multiprocexecutor.png"
        caption="MultiProcExecutor at TP=8, with rank 0 as the driver worker"
        max={560}
      />

      <Card className="my-6 p-4">
        <ScalingChart params={sim.params} />
        <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-faint">
          Speedup against the dashed ideal, at several all-reduce costs. The curves bend and then
          flatten — and at high communication cost they eventually bend <em>down</em>. Amdahl's law,
          with the interconnect as the serial part.
        </p>
      </Card>

      <h3>How the processes are wired</h3>
      <ol>
        <li>
          <Code>MultiProcExecutor</Code> initializes an <Code>rpc_broadcast_mq</Code> message queue,
          implemented over shared memory.
        </li>
        <li>
          The constructor loops over <Code>world_size</Code> (TP=8 ⇒ 8) and spawns a daemon process
          per rank via <Code>WorkerProc.make_worker_process</Code>, creating a reader and writer pipe
          for each.
        </li>
        <li>
          Each new process runs <Code>WorkerProc.worker_main</Code>, instantiating a worker through
          the very same "init device / load model / initialize KV cache" procedures from stage 02 —
          now with TP-partitioned weights.
        </li>
        <li>
          Each worker works out whether it is the <strong>driver</strong> (rank 0 in the TP group) or
          a regular worker, and sets up two queues: <Code>rpc_broadcast_mq</Code> (shared with the
          parent, for receiving work) and its own <Code>worker_response_mq</Code> (for replies).
        </li>
        <li>
          During init each child sends its <Code>worker_response_mq</Code> handle to the parent over
          the pipe. Once all handles are in, the parent unblocks — coordination complete.
        </li>
        <li>
          Workers enter a busy loop blocking on <Code>rpc_broadcast_mq.dequeue</Code>. Work arrives,
          they execute their partition, and results go back via{' '}
          <Code>worker_response_mq.enqueue</Code>.
        </li>
        <li>
          At runtime the executor enqueues into <Code>rpc_broadcast_mq</Code> (non-blocking, all
          children) then waits on the designated output rank's{' '}
          <Code>worker_response_mq.dequeue</Code>.
        </li>
      </ol>

      <Callout kind="key" title="The abstraction actually holds">
        <p>
          From <Code>EngineCore</Code>'s perspective nothing changed. It calls the model executor's{' '}
          <Code>execute_model</Code>, exactly as before.
        </p>
        <ul>
          <li>
            <Code>UniProcExecutor</Code>: that call directly invokes <Code>execute_model</Code> on
            the worker.
          </li>
          <li>
            <Code>MultiProcExecutor</Code>: it invokes <Code>execute_model</Code> on every worker{' '}
            <em>indirectly</em>, through <Code>rpc_broadcast_mq</Code>.
          </li>
        </ul>
        <p>
          The scheduler, KV-cache manager, and everything in stages 03–10 are untouched. That's why
          this stage arrives so late and is so short: sharding is a swap behind one seam.
        </p>
      </Callout>

      <CodeBlock
        lang="text"
        caption="Shared-memory queues rather than sockets, because these processes are on one machine and the payloads are hot-path."
        code={`parent                          workers (one process per rank)
  |                                |
  |-- rpc_broadcast_mq.enqueue --> |  all ranks wake from dequeue()
  |   (non-blocking)               |  execute their partition of the work
  |                                |
  |<-- worker_response_mq -------- |  output rank enqueues the result
  |    .dequeue() (blocking)       |  every rank returns to blocking dequeue`}
      />

      <Takeaways
        items={[
          'TP shards weight matrices and needs an all-reduce per layer, so it stays inside a node; PP splits layers, communicates far less, and is how you span nodes.',
          'MultiProcExecutor spawns one daemon process per rank, hands out a shared-memory rpc_broadcast_mq for work and a per-worker worker_response_mq for replies, then broadcasts non-blocking and collects from the designated output rank.',
          'Compute per worker scales as 1/TP while all-reduce cost grows with the group size, so parallel efficiency falls as TP rises — and on a slow interconnect a wider TP group can be outright slower. Higher TP is a decision about the interconnect, not just about VRAM.',
          'EngineCore still just calls execute_model. Every stage before this one keeps working unchanged, which is why scaling up is a late, small chapter rather than a rewrite.',
        ]}
      />
    </>
  )
}
