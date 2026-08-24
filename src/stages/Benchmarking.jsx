import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import roofline, { bSat, latency, latencyMetrics, stepModel } from '../sim/roofline'
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

const METRICS = [
  ['TTFT', 'time to first token', 'From submission until the first output token is received.'],
  ['ITL', 'inter-token latency', 'Time between two consecutive tokens, i.e. token i-1 → token i.'],
  ['TPOT', 'time per output token', 'The average ITL across all output tokens in a request.'],
  [
    'E2E',
    'end-to-end latency',
    'Total time to process a request: TTFT + the sum of all ITLs — equivalently, submission to last token.',
  ],
  [
    'Throughput',
    'tokens or requests / sec',
    'Total tokens processed per second (input, output, or both), or requests per second.',
  ],
  [
    'Goodput',
    'throughput meeting SLOs',
    'Only counts tokens from requests that met service-level objectives such as max TTFT, TPOT, or E2E latency.',
  ],
]

/* ------------------------------------------------------------- latency anatomy */

function LatencyViz({ sim }) {
  const { state, params } = sim
  const m = latencyMetrics(state)
  const total = Math.max(m.lastAt ?? 1, params.queueMs + params.prefillMs + params.itlMs)
  const pct = (ms) => (ms / total) * 100

  return (
    <div className="space-y-5">
      <StatRow>
        <StatTile label="TTFT" value={m.ttft.toFixed(0)} unit="ms" tone="accent" />
        <StatTile label="TPOT" value={m.tpot.toFixed(0)} unit="ms" />
        <StatTile label="E2E" value={m.e2e.toFixed(0)} unit="ms" tone="good" />
        <StatTile label="tokens out" value={`${state.tokens.length}/${params.outputTokens}`} />
      </StatRow>

      <div className="scroll-x border border-edge bg-neutral-100 p-4">
        <div className="min-w-[520px]">
          {/* the bar */}
          <div className="flex h-8 overflow-hidden rounded-sm">
            <div
              style={{ width: `${pct(params.queueMs)}%`, background: C.free }}
              title={`queueing: ${params.queueMs} ms`}
              className="flex items-center justify-center font-mono text-[0.55rem] text-ink-faint"
            >
              queue
            </div>
            <div
              style={{ width: `${pct(params.prefillMs)}%`, background: C.prefill }}
              title={`prefill: ${params.prefillMs} ms`}
              className="flex items-center justify-center font-mono text-[0.55rem] text-surface"
            >
              prefill
            </div>
            {m.itls.map((ms, i) => (
              <div
                key={i}
                style={{
                  width: `${pct(ms)}%`,
                  background: C.decode,
                  borderLeft: '1px solid var(--color-surface)',
                }}
                title={`ITL ${i + 1}: ${ms} ms`}
              />
            ))}
          </div>

          {/* token ticks */}
          <div className="relative mt-1 h-4">
            {state.tokens.map((t) => (
              <span
                key={t.i}
                className="absolute font-mono text-[0.5rem] text-ink-faint"
                style={{ left: `${pct(t.atMs)}%`, transform: 'translateX(-50%)' }}
                title={`token ${t.i + 1} at ${t.atMs.toFixed(0)} ms`}
              >
                ▲{t.i + 1}
              </span>
            ))}
          </div>

          {/* measurement brackets */}
          <div className="relative mt-3 h-12">
            <div
              className="absolute top-0 border-t border-l border-r px-1 pt-0.5 text-center font-mono text-[0.55rem]"
              style={{
                left: 0,
                width: `${pct(m.ttft)}%`,
                borderColor: C.warn,
                color: C.warn,
                height: 14,
              }}
            >
              TTFT
            </div>
            {m.itls.length > 0 && (
              <div
                className="absolute top-5 border-t border-l border-r px-1 pt-0.5 text-center font-mono text-[0.55rem]"
                style={{
                  left: `${pct(m.ttft)}%`,
                  width: `${pct(m.itls[0])}%`,
                  borderColor: C.decode,
                  color: C.decode,
                  height: 14,
                }}
              >
                ITL
              </div>
            )}
            <div
              className="absolute top-10 border-t border-l border-r px-1 pt-0.5 text-center font-mono text-[0.55rem]"
              style={{
                left: 0,
                width: `${pct(m.e2e)}%`,
                borderColor: C.good,
                color: C.good,
                height: 14,
              }}
            >
              E2E latency = TTFT + Σ ITL
            </div>
          </div>
        </div>
      </div>

      <p className="text-[0.75rem] leading-relaxed text-ink-faint">
        Note that <strong>queueing time counts toward TTFT</strong>. A request that waits behind
        others has bad TTFT even though the engine's prefill was fast — which is why the scheduler
        and load balancer are latency features, not just capacity features.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------- roofline */

function RooflineViz({ sim }) {
  const { state, params } = sim
  const sat = bSat(params)
  const cur = stepModel(state.B, params)
  const t = state.trace

  const maxB = 1024
  const ladder = []
  for (let b = 1; b <= maxB; b = b < 4 ? b + 1 : Math.ceil(b * 1.35)) ladder.push(b)
  const all = ladder.map((b) => ({ B: b, ...stepModel(b, params) }))
  const revealed = new Set(t.map((x) => x.B))

  return (
    <div className="space-y-5">
      <StatRow>
        <StatTile label="batch size" value={state.B} tone="accent" />
        <StatTile
          label="step latency / ITL"
          value={cur.stepMs.toFixed(1)}
          unit="ms"
          tone={cur.stepMs > params.slaItlMs ? 'bad' : 'good'}
        />
        <StatTile label="throughput" value={cur.throughput.toFixed(0)} unit=" tok/s" tone="good" />
        <StatTile
          label="bound by"
          value={cur.bound}
          tone={cur.bound === 'compute' ? 'warn' : 'neutral'}
          hint={`B_sat ≈ ${sat.toFixed(0)}`}
        />
      </StatRow>

      <Card className="p-3">
        <LineChart
          height={190}
          xLabel="batch size B (log-ish ladder)"
          yLabel="step latency (ms)"
          yTicks={[
            Number(cur.tMemMs.toFixed(1)),
            Number((cur.tMemMs * 2).toFixed(1)),
            Number((cur.tMemMs * 4).toFixed(1)),
          ]}
          xTicks={[1, 32, 128, 512, 1024]}
          series={[
            {
              label: 'weight-streaming floor',
              points: all.map((x) => [x.B, x.tMemMs]),
              color: C.faint,
              dashed: true,
            },
            {
              label: 'compute time',
              points: all.map((x) => [x.B, x.tComputeMs]),
              color: C.prefill,
              dashed: true,
            },
            {
              label: 'step latency',
              points: all.filter((x) => revealed.has(x.B)).map((x) => [x.B, x.stepMs]),
              color: C.decode,
              dot: [state.B, cur.stepMs],
            },
          ]}
          markers={[{ x: sat, label: `B_sat ≈ ${sat.toFixed(0)}`, color: C.warn }]}
        />
      </Card>

      <Card className="p-3">
        <LineChart
          height={170}
          xLabel="batch size B"
          yLabel="throughput (tok/s)"
          xTicks={[1, 32, 128, 512, 1024]}
          yTicks={[Math.round(all.at(-1).throughput / 2), Math.round(all.at(-1).throughput)]}
          series={[
            {
              label: 'throughput',
              points: all.filter((x) => revealed.has(x.B)).map((x) => [x.B, x.throughput]),
              color: C.good,
              dot: [state.B, cur.throughput],
            },
          ]}
          markers={[{ x: sat, label: 'B_sat', color: C.warn }]}
        />
      </Card>

      {/* SLO band */}
      <div>
        <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
          which batch sizes meet the {params.slaItlMs} ms ITL SLO
        </div>
        <div className="flex flex-wrap gap-1">
          {all.map((x) => {
            const ok = x.stepMs <= params.slaItlMs
            return (
              <span
                key={x.B}
                className="rounded px-1 py-0.5 font-mono text-[0.55rem]"
                style={{
                  background: revealed.has(x.B) ? (ok ? C.good : C.bad) : C.free,
                  color: revealed.has(x.B) ? C.bg : C.faint,
                  outline: x.B === state.B ? `1.5px solid var(--color-accent)` : undefined,
                }}
                title={`B=${x.B}: ${x.stepMs.toFixed(1)} ms, ${x.throughput.toFixed(0)} tok/s — ${ok ? 'within' : 'over'} SLO`}
              >
                {x.B}
              </span>
            )
          })}
        </div>
        <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-faint">
          The largest green number is the batch size that maximizes <strong>goodput</strong>: the
          most throughput you can buy without breaking the latency promise. That's the number an
          auto-tuner is searching for.
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the stage */

export default function Benchmarking() {
  const lat = useSimulation(latency)
  const roof = useSimulation(roofline)

  return (
    <StageLayout
      slug="benchmarking"
      sim={roof}
      simTitle="Roofline sweep"
      simSubtitle="Step the batch size up a geometric ladder. The dashed lines are the two competing costs; the solid line is their max, which is what you actually pay."
      tryThis={[
        'Step to B = 256: still 4.8ms a step, with throughput up from 209 to 53,600 tokens a second.',
        'Set Model size to 70. The flat line lifts to 41.8ms and B_sat does not move.',
        'Drop HBM bandwidth to 1: now B_sat moves, to 990. The knee belongs to the GPU, not the model.',
      ]}
      panel={<RooflineViz sim={roof} />}
      legend={[
        { label: 'step latency (what you pay)', color: C.decode },
        { label: 'compute time', color: C.prefill },
        { label: 'weight-streaming floor', color: C.faint },
        { label: 'meets the ITL SLO', color: C.good },
        { label: 'violates it', color: C.bad },
      ]}
      simFooter={
        <>
          The whole free lunch of batched inference lives in the flat part of the latency curve.
          Try a 70B model on 3.35 TB/s: the flat part lifts from 4.8ms to 41.8ms, while{' '}
          <Code>B_sat</Code> stays exactly where it was — the knee belongs to the hardware, not the
          model. Then set an ITL SLO and read off the largest passing batch size. That is the
          goodput-maximising configuration, and finding it is what vLLM's auto-tune script does.
        </>
      }
    >
      <p>
        Every stage so far has followed individual requests through the engine. This one zooms out
        to the only question that settles whether any of it worked: how do you measure the whole
        system?
      </p>
      <p>
        There are two headline numbers, and they pull against each other.
      </p>
      <p>
        <strong>Latency</strong> is how long a request waits before tokens come back. It is what
        matters when a person is sitting there. <strong>Throughput</strong> is tokens or requests
        per second across everybody. It is what matters for offline work: generating synthetic data,
        cleaning datasets, classifying in bulk.
      </p>
      <p>
        One more term, because the rest of the page leans on it. An <strong>SLO</strong> is a
        service level objective: a promise about a number, such as "95% of requests see their first
        token within 300ms". It is the line you have decided not to cross.
      </p>

      <h2>The vocabulary</h2>
      <div className="my-5 overflow-hidden rounded-lg border border-edge">
        {METRICS.map(([k, sub, def], i) => (
          <div
            key={k}
            className={`grid gap-1 px-4 py-2.5 sm:grid-cols-[130px_1fr] ${i % 2 ? 'bg-neutral-200' : ''}`}
          >
            <div>
              <div className="font-mono text-[0.75rem] text-accent-700">{k}</div>
              <div className="font-mono text-[0.58rem] text-ink-faint">{sub}</div>
            </div>
            <p className="text-[0.8rem] leading-relaxed text-ink-dim">{def}</p>
          </div>
        ))}
      </div>

      <SimFrame
        sim={lat}
        keys
        title="Latency anatomy"
        subtitle="One request's timeline. Step to emit tokens and watch the measurement brackets extend."
        legend={[
          { label: 'queueing', color: C.free },
          { label: 'prefill', color: C.prefill },
          { label: 'one decode step', color: C.decode },
        ]}
      >
        <LatencyViz sim={lat} />
      </SimFrame>

      <BlogFigure src="latency_diagram.png" caption="TTFT, ITL, and end-to-end latency" max={560} />

      <h2>Why the two metrics compete</h2>
      <p>
        The clash is clearest in what batch size <Code>B</Code> does to one decode step. Push{' '}
        <Code>B</Code> down toward 1 and ITL falls, because the step has less work in it and your
        token is not queued behind anybody else's.
      </p>
      <p>
        Push <Code>B</Code> up and ITL climbs, because the step now does more arithmetic. But
        throughput improves, because the one expensive trip through the weights is being shared by
        more tokens.
      </p>

      <Callout kind="key" title="The roofline picture">
        <p>
          Below a saturation batch size <Code>B_sat</Code>, a step is limited by memory bandwidth:
          the time goes on streaming weights out of HBM, not on arithmetic. Step time is therefore
          almost <strong>flat</strong>. Computing one token or a hundred takes about the same time,
          so those extra tokens are very nearly free.
        </p>
        <p>
          Above <Code>B_sat</Code> the arithmetic becomes the limit and step time grows roughly in
          step with <Code>B</Code>. Now every extra token in the batch adds to everybody's ITL.
        </p>
        <p>
          It is called a roofline because that is the shape: a flat ceiling set by bandwidth, then a
          slope set by compute. You are always under one or the other.
        </p>
        <p>
          One assumption: this treats weight traffic as the thing that dominates, rather than
          KV-cache traffic, which holds for reasonably short sequences.
        </p>
      </Callout>

      <h2>Watch it happen</h2>
      <p>
        The panel steps batch size up a ladder for an 8B model on 3.35 TB/s of bandwidth. The step
        time sits at 4.8ms and does not budge from <Code>B = 1</Code> all the way to{' '}
        <Code>B = 256</Code>.
      </p>
      <p>
        Throughput over that same range goes from 209 tokens per second to 53,600. That is 256 times
        the output for the same 4.8ms per step, and it is the entire reason batched inference is
        worth doing.
      </p>
      <p>
        Now drag <Code>Model size</Code> to 70B. The flat line jumps from 4.8ms to 41.8ms, because
        there are nearly nine times as many weights to stream every step. Throughput at{' '}
        <Code>B = 256</Code> drops to 6,126 tokens per second.
      </p>
      <p>
        But look at <Code>B_sat</Code>: it has not moved. It is 295 for a 1B model and 295 for a 70B
        model.
      </p>

      <Callout kind="note" title="B_sat belongs to the GPU, not to the model">
        <p>
          Work the algebra through and <Code>B_sat</Code> comes out as peak compute divided by
          memory bandwidth. The model size cancels: it appears in both the streaming time and the
          arithmetic time, so it moves the whole curve up or down without moving the knee.
        </p>
        <p>
          The knee moves when the hardware changes. Drop <Code>HBM bandwidth</Code> to 1 TB/s and{' '}
          <Code>B_sat</Code> goes to 990 — slower memory means you can batch much further before
          arithmetic becomes the problem. Raise <Code>Peak compute</Code> to 2000 TFLOP/s and it
          moves to 597.
        </p>
      </Callout>

      <p>
        Finally, set an <Code>ITL SLO</Code> and see what it does to your choices. At 30ms the 8B
        model passes everywhere on the ladder — 4.8ms is nowhere near the line. The 70B model fails
        at <em>every</em> batch size, including 1, because 41.8ms of weight streaming breaks the
        promise before any batching happens.
      </p>
      <p>
        That is worth sitting with. No batch size, scheduler setting or clever feature will rescue
        that target on that hardware. The only moves left are a smaller model, faster memory, or a
        different promise.
      </p>

      <BlogFigure src="roofline.png" caption="The roofline performance model" max={520} />

      <Callout kind="note" title="A caveat on the simple model">
        <p>
          A rigorous treatment has to account for kernel auto-tuning: as <Code>B</Code> grows the
          runtime may switch to a more efficient kernel for that shape, changing the achieved
          performance <Code>P_kernel</Code>. Step latency is <Code>t = FLOPs_step / P_kernel</Code>,
          so once <Code>P_kernel</Code> reaches <Code>P_peak</Code>, more compute per step
          translates directly into more latency. The simulator above assumes a fixed{' '}
          <Code>P_peak</Code>, which is why its curve is cleaner than a real measurement.
        </p>
      </Callout>

      <h2>The three benchmark commands</h2>
      <p>
        vLLM ships a <Code>vllm bench {'{serve,latency,throughput}'}</Code> CLI wrapping{' '}
        <Code>vllm/benchmarks/{'{server,latency,throughput}'}.py</Code>. They measure genuinely
        different things:
      </p>
      <div className="my-5 space-y-2">
        {[
          {
            cmd: 'vllm bench latency',
            what: 'Short input (default 32 tokens), 128 output tokens, small batch (default 8). Runs several iterations and reports end-to-end latency for the batch.',
            use: 'Best-case latency of your config. Answers "how fast is one request when the server is not busy".',
          },
          {
            cmd: 'vllm bench throughput',
            what: 'Submits a fixed prompt set (default 1000 ShareGPT samples) all at once — QPS=∞ — and reports input/output/total tokens and requests per second.',
            use: 'Your ceiling for offline batch work. Deliberately unrealistic as a serving model: nobody sends all their traffic simultaneously.',
          },
          {
            cmd: 'vllm bench serve',
            what: 'Launches a server and samples request inter-arrival times from a Poisson (more generally Gamma) distribution over a time window. Measures every metric above, and can enforce a server-side max concurrency via a semaphore (e.g. 64).',
            use: 'The one that resembles production. Use this for any SLO claim.',
          },
        ].map((x) => (
          <Card key={x.cmd} className="p-3.5">
            <div className="font-mono text-[0.72rem] text-accent-700">{x.cmd}</div>
            <p className="mt-1.5 text-[0.78rem] leading-relaxed text-ink-dim">{x.what}</p>
            <p className="mt-1 text-[0.75rem] leading-relaxed text-ink-faint">{x.use}</p>
          </Card>
        ))}
      </div>

      <CodeBlock
        lang="bash"
        caption="Benchmark configs used in vLLM's CI live under .buildkite/nightly-benchmarks/tests."
        code={`vllm bench latency \\
  --model <model-name> \\
  --input-tokens 32 \\
  --output-tokens 128 \\
  --batch-size 8`}
      />

      <Callout kind="key" title="Goodput is the metric that matters">
        <p>
          Raw throughput is easy to inflate: push the batch size up and the number goes up, while
          every user's ITL quietly becomes unacceptable. Goodput only counts tokens from requests
          that met their SLOs, so it cannot be gamed that way. vLLM's <strong>auto-tune</strong>{' '}
          script drives the <Code>serve</Code> benchmark to search for argument settings satisfying
          a target — "maximize throughput while keeping p99 E2E under 500 ms" — and returns a
          suggested config.
        </p>
      </Callout>

      <Callout kind="gotcha" title="Benchmarking mistakes worth avoiding">
        <ul>
          <li>
            <strong>Reporting throughput without a latency constraint.</strong> The number is
            meaningless on its own; it's a point on a curve, and you chose the point.
          </li>
          <li>
            <strong>Benchmarking with prefix caching accidentally on.</strong> Repeat the same
            prompts and prefix caching (<StageRef n={7} />) makes your prefill numbers fictional.
          </li>
          <li>
            <strong>
              Forgetting <Code>ignore_eos</Code>.
            </strong>{' '}
            Without it, output lengths vary and you're measuring the model's verbosity as much as
            the engine.
          </li>
          <li>
            <strong>Using QPS=∞ to predict interactive serving.</strong> That's{' '}
            <Code>throughput</Code>'s job, not <Code>serve</Code>'s, and the two answer different
            questions.
          </li>
        </ul>
      </Callout>

      <h2>That's the whole system</h2>
      <p>
        Work backwards from the curve you just swept. Goodput depends on batch size. Batch size
        depends on how many requests fit in the KV cache, and on how the scheduler spends its token
        budget.
      </p>
      <p>
        Those in turn depend on paged blocks, prefix caching and chunked prefill. And all of it runs
        on an executor that might be one GPU or sixteen across two machines. Every stage in this
        roadmap is a lever on that one curve.
      </p>
      <p>
        Plenty is skipped here, as it was in the original post. On the model side: MLA,
        mixture-of-experts and expert parallelism, encoder-decoder models, pooling and embedding
        models, LoRA, sliding-window attention, multimodal models, and state-space models such as
        Mamba and Jamba. On the engine side: hybrid KV-cache allocation (Jenga), beam search, and
        experimental async scheduling.
      </p>
      <p>
        Most of them are close to independent of the flow described here. They attach to it more
        like plugins than like rewrites.
      </p>

      <Takeaways
        items={[
          'TTFT includes queueing delay; E2E = TTFT + Σ ITL; TPOT is the mean ITL. Latency and throughput are two ends of one batch-size dial, not independent goals.',
          "Below B_sat a decode step is bandwidth-bound and its duration barely changes, so extra batched tokens are nearly free. Above B_sat it is compute-bound and each token adds to everyone's ITL.",
          'Use `latency` for best-case single-request timing, `throughput` for the offline ceiling at QPS=∞, and `serve` with Poisson arrivals for anything resembling production.',
          'Goodput — throughput that meets SLOs — is the only headline number that cannot be inflated by simply raising the batch size. Auto-tune searches for the config that maximizes it.',
        ]}
      />
    </StageLayout>
  )
}
