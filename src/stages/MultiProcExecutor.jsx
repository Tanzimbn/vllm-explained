import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import parallelism, { LAYER_COMPUTE, tpCost } from '../sim/parallelism'
import {
  BlogFigure,
  Callout,
  Card,
  Code,
  CodeBlock,
  SimFrame,
  StageRef,
  StatRow,
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
      <StatRow>
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
      </StatRow>

      {/* the parent + queues + workers */}
      <div className="space-y-3">
        <div className="rounded-lg border border-edge bg-neutral-200 px-3 py-2">
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
            <span
              className="ml-2 font-mono text-[0.6rem] leading-6"
              style={{ color: state.phase === 'broadcast' ? C.warn : C.faint }}
            >
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
                  <span
                    className="font-mono text-[0.52rem]"
                    style={{ color: C.accent ?? C.decode }}
                  >
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
              style={{
                color: state.phase === 'collect' || state.phase === 'done' ? C.cached : C.faint,
              }}
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
        <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
          layers · compute then all-reduce, per layer
        </div>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: params.numLayers }, (_, l) => (
            <div key={l} className="flex items-center gap-[2px]">
              <span
                className="flex h-6 w-8 items-center justify-center rounded-l-[3px] font-mono text-[0.55rem]"
                style={{
                  background:
                    l < state.layer || (l === state.layer && state.phase !== 'broadcast')
                      ? C.decode
                      : C.free,
                  color: l <= state.layer ? C.bg : C.faint,
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
                    color: l < state.layer ? C.bg : C.faint,
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

      <p className="rounded-md bg-neutral-200 px-3 py-2 font-mono text-[0.7rem] leading-relaxed text-ink-dim">
        <span className="text-accent-700">tick {state.tick}:</span> {state.note}
      </p>
    </div>
  )
}

function ScalingChart({ params }) {
  const sizes = [1, 2, 4, 8, 16, 32]
  const curve = (commCost) => sizes.map((tp) => [tp, tpCost(tp, { ...params, commCost }).speedup])
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
    <StageLayout
      slug="multiproc-executor"
      sim={sim}
      simTitle="One forward pass at TP=8"
      simSubtitle="Step through the queue handshake and per-layer compute/all-reduce cycle. Then raise the all-reduce cost and watch parallel efficiency fall apart."
      legend={[
        { label: 'shard compute', color: C.decode },
        { label: 'all-reduce', color: C.prefill },
        { label: 'queue active', color: C.warn },
        { label: 'result returned', color: C.cached },
      ]}
      simFooter={
        <>
          The number to watch is parallel efficiency. Compute per worker falls as <Code>1/TP</Code>,
          while the all-reduce cost per layer <em>grows</em> with the group size — a wider
          collective needs more hops. So past some point you're adding GPUs mainly to pay for more
          communication. This is the entire reason TP isn't simply set as high as you have GPUs.
        </>
      }
      panel={<TpViz sim={sim} />}
    >
      <p>
        Everything so far assumed the model fits on one GPU. When it does not, you cut it into
        pieces and spread it across several — and the engine needs something to drive those several
        worker processes as though they were one.
      </p>
      <p>
        That something is <Code>MultiProcExecutor</Code>. The remarkable thing about it is how
        little the rest of the engine notices.
      </p>

      <h2>Two ways to split a model</h2>
      <p>
        <strong>Tensor parallelism</strong>, or TP, cuts the individual weight matrices up. Every
        GPU holds a slice of every layer, and they work on each layer together.
      </p>
      <p>
        Working together has a price. Each GPU computes a partial answer from its own slice, so
        after every sharded block they all have to swap partials and add them up. That exchange is
        an <strong>all-reduce</strong>, and there is one per block, every layer, every step. It is a
        lot of traffic, which is why TP normally stays <em>inside</em> one machine where the links
        between GPUs are fastest.
      </p>
      <p>
        <strong>Pipeline parallelism</strong>, or PP, cuts by layer instead. GPU 0 holds the first
        few layers, GPU 1 the next few, and so on, so data is handed forward once per boundary.
      </p>
      <p>
        That is far less traffic, which makes PP the way to span machines. The cost is a{' '}
        <strong>bubble</strong>. While GPU 0 works on the first layers, the GPUs holding later
        layers have nothing to do yet, and they idle again at the end of the batch.
      </p>

      <Callout kind="note" title="The usual ordering">
        <p>
          Links inside a machine are much faster than links between machines. So the usual recipe is
          to fill one machine with TP first, then reach for PP across machines only if the model
          still does not fit.
        </p>
        <p>
          Two more schemes exist — expert parallelism for mixture-of-experts models, and sequence
          parallelism — but TP and PP are what you meet for a standard transformer.
        </p>
      </Callout>

      <BlogFigure
        src="multiprocexecutor.png"
        caption="MultiProcExecutor at TP=8, with rank 0 as the driver worker"
        max={560}
      />

      <h2>Watch it happen</h2>
      <p>
        Step the panel at <Code>TP=8</Code> and you get nine ticks: one broadcast to wake the
        workers, then compute and all-reduce for each of the three layers, then a collect. That
        alternation is the whole shape of a tensor-parallel forward pass.
      </p>
      <p>
        Now watch the efficiency number as you change <Code>Tensor parallel size</Code>, with the
        all-reduce cost left at 1. Two GPUs give a speedup of 1.6× — 80% efficient. Four give 2.0×,
        which is 50%. Eight give 2.0× as well.
      </p>
      <p>
        Read that last pair again. Going from four GPUs to eight doubled the hardware and bought{' '}
        <em>nothing</em>, because the compute each worker does halved while the all-reduce it must
        take part in got bigger.
      </p>
      <p>
        Set <Code>All-reduce cost per layer</Code> to 0 and the same sweep scales perfectly: 8 GPUs,
        8× faster, 100% efficiency all the way. Communication is the entire story. Push the cost to
        4 instead and <Code>TP=8</Code> lands at 0.62× — eight GPUs, slower than one.
      </p>
      <p>
        This is why TP is not simply set as high as your GPU count. Compute per worker falls as{' '}
        <Code>1/TP</Code> while the all-reduce grows with the group, so past some point extra GPUs
        are bought mainly to pay for extra talking.
      </p>

      <Card className="my-6 p-4">
        <ScalingChart params={sim.params} />
        <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-faint">
          Speedup against the dashed ideal, at several all-reduce costs. The curves bend, then
          flatten, and at high communication cost they eventually bend <em>down</em>. This is
          Amdahl's law: the part you cannot parallelise sets a ceiling on the whole thing, and here
          the interconnect is that part.
        </p>
      </Card>

      <h2>How the processes are wired</h2>
      <ol>
        <li>
          <Code>MultiProcExecutor</Code> initializes an <Code>rpc_broadcast_mq</Code> message queue,
          implemented over shared memory.
        </li>
        <li>
          The constructor loops over <Code>world_size</Code> — 8, at TP=8 — and spawns one
          background process per rank via <Code>WorkerProc.make_worker_process</Code>. Each gets a
          reader and a writer pipe.
        </li>
        <li>
          Each new process runs <Code>WorkerProc.worker_main</Code>, instantiating a worker through
          the very same "init device / load model / initialize KV cache" procedures from{' '}
          <StageRef n={2} /> — now with TP-partitioned weights.
        </li>
        <li>
          Each worker works out whether it is the <strong>driver</strong> — rank 0 in the TP
          group — or a regular worker. It then sets up two queues: <Code>rpc_broadcast_mq</Code>,
          shared with the parent, for receiving work; and its own <Code>worker_response_mq</Code>{' '}
          for replies.
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
          The scheduler, the KV-cache manager and every feature so far are untouched. That is why
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
          'MultiProcExecutor spawns one process per rank. Work goes out over a shared-memory rpc_broadcast_mq without blocking, and each worker replies on its own worker_response_mq; the parent collects from the designated output rank.',
          'Compute per worker scales as 1/TP while the all-reduce grows with the group size, so parallel efficiency falls as TP rises. On slow links a wider TP group can be outright slower than a narrow one, which makes TP a decision about the interconnect and not only about VRAM.',
          'EngineCore still just calls execute_model. Every stage before this one keeps working unchanged, which is why scaling up is a late, small chapter rather than a rewrite.',
        ]}
      />
    </StageLayout>
  )
}
