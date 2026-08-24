import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import distributed, { balanceStats, score } from '../sim/distributed'
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
  Term,
} from '../components/ui'
import { C, MeterBar } from '../components/viz'

function LbViz({ sim }) {
  const { state, params } = sim
  const stats = balanceStats(state)
  const scores = state.engines.map(score)
  const minScore = Math.min(...scores)

  return (
    <div className="space-y-5">
      <StatRow>
        <StatTile
          label="mean imbalance"
          value={stats.mean.toFixed(2)}
          tone={stats.mean < 1.5 ? 'good' : stats.mean < 3 ? 'warn' : 'bad'}
          hint="Average gap between the busiest and idlest replica"
        />
        <StatTile label="worst imbalance" value={stats.max} tone={stats.max > 5 ? 'bad' : 'warn'} />
        <StatTile label="completed" value={stats.completed} tone="good" />
        <StatTile
          label="completion spread"
          value={stats.spread}
          hint="Difference in requests finished between the best and worst replica"
        />
      </StatRow>

      {/* the two nodes and their engines */}
      {[0, 1].map((node) => (
        <div key={node}>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
              node {node} · 8×H100
            </span>
            <span className="font-mono text-[0.58rem] text-neutral-600">
              {node === 0 ? '--headless' : 'API server + DPCoordinator'}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {state.engines
              .filter((e) => e.node === node)
              .map((e) => {
                const sc = score(e)
                const isPick = state.lastPick?.engine === e.id
                const isMin = sc === minScore
                return (
                  <div
                    key={e.id}
                    className="rounded-lg border px-3 py-2 transition-colors duration-200"
                    style={{
                      borderColor: isPick ? C.good : isMin ? C.decode + '77' : C.edge,
                      background: isPick ? 'rgba(93,219,164,0.10)' : 'transparent',
                    }}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[0.68rem] text-ink">
                        {e.id}{' '}
                        <span className="text-[0.55rem] text-ink-faint">
                          DPEngineCoreProc · TP=4
                        </span>
                      </span>
                      <span
                        className="font-mono text-[0.65rem] tabular-nums"
                        style={{ color: isMin ? C.good : C.dim }}
                      >
                        score {sc}
                      </span>
                    </div>
                    <div className="mt-1.5 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-14 font-mono text-[0.55rem] text-ink-faint">
                          running
                        </span>
                        <div className="flex gap-[3px]">
                          {Array.from({ length: params.capacity }, (_, i) => (
                            <span
                              key={i}
                              className="h-3 w-3"
                              style={{
                                background: i < e.running.length ? C.decode : C.free,
                              }}
                            />
                          ))}
                        </div>
                        <span className="font-mono text-[0.55rem] text-ink-faint tabular-nums">
                          ×1
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-14 font-mono text-[0.55rem] text-ink-faint">
                          waiting
                        </span>
                        <div className="flex flex-wrap gap-[3px]">
                          {e.waiting.length === 0 ? (
                            <span className="font-mono text-[0.55rem] text-neutral-500">—</span>
                          ) : (
                            e.waiting.map((id) => (
                              <span
                                key={id}
                                className="h-3 w-3"
                                style={{ background: C.prefill }}
                                title={id}
                              />
                            ))
                          )}
                        </div>
                        <span className="font-mono text-[0.55rem]" style={{ color: C.prefill }}>
                          ×4
                        </span>
                      </div>
                    </div>
                    <div className="mt-1.5 font-mono text-[0.55rem] text-ink-faint">
                      {e.completed} done · {e.idleSteps} idle step(s)
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      ))}

      {/* the routing decision */}
      <div className="rounded-lg border border-edge bg-neutral-200 px-3 py-2.5">
        <div className="mb-1.5 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
          get_core_engine_for_request
        </div>
        {state.lastPick ? (
          <div className="font-mono text-[0.68rem] leading-relaxed text-ink-dim">
            scores = [{state.lastPick.scores.join(', ')}] →{' '}
            {params.policy === 'score' ? (
              <>
                min at <span style={{ color: C.good }}>{state.lastPick.engine}</span>
              </>
            ) : (
              <>
                {params.policy} chose <span style={{ color: C.warn }}>{state.lastPick.engine}</span>{' '}
                <span className="text-ink-faint">(load ignored)</span>
              </>
            )}
          </div>
        ) : (
          <div className="font-mono text-[0.65rem] text-neutral-500">no arrivals this step</div>
        )}
      </div>

      <MeterBar
        label="load imbalance over time"
        value={state.imbalanceHistory.at(-1) ?? 0}
        max={Math.max(8, stats.max)}
        color={stats.mean > 3 ? C.bad : C.decode}
        sublabel={`current gap ${state.imbalanceHistory.at(-1) ?? 0}`}
      />

      <p className="rounded-md bg-neutral-200 px-3 py-2 font-mono text-[0.7rem] leading-relaxed text-ink-dim">
        <span className="text-accent-700">tick {state.tick}:</span> {state.note}
      </p>
    </div>
  )
}

export default function DistributedServing() {
  const sim = useSimulation(distributed)

  return (
    <StageLayout
      slug="distributed-serving"
      sim={sim}
      simTitle="Load balancer router"
      simSubtitle="Four DP replicas across two nodes. Requests arrive with skewed costs — mostly short, occasionally very long. The engine with the lowest score gets the next one."
      legend={[
        { label: 'running slot', color: C.decode },
        { label: 'queued request', color: C.prefill },
        { label: 'chosen this step', color: C.good },
        { label: 'free capacity', color: C.free },
      ]}
      simFooter={
        <>
          Switch between <Code>vLLM score</Code>, <Code>round-robin</Code> and{' '}
          <Code>random</Code>, and watch <strong>mean imbalance</strong>. At zero cost skew the
          three are close, because counting requests is a fine proxy for counting work. Raise the
          skew and the arrival rate and they separate hard: round-robin shares out request{' '}
          <em>counts</em> perfectly and cannot see that it just handed E1 a request ten times longer
          than the last.
        </>
      }
      tryThis={[
        'At Request-cost skew 0, round-robin (0.81) beats vLLM score (0.89). Counting requests is enough when they are identical.',
        'Set skew to 10 and Arrivals per step to 5. Score holds at 1.07 while round-robin reaches 2.60 and random 9.15.',
      ]}
      panel={<LbViz sim={sim} />}
    >
      <p>
        We can now run a model as big as the hardware allows. What is left is to scale{' '}
        <em>out</em>. Run several copies of the whole engine, put an API server in front of them,
        and add just enough coordination to send each request somewhere sensible.
      </p>
      <p>
        Running several complete copies is <Term>data parallelism</Term>, or DP. It is different
        from the splitting in <StageRef n={11} />: there, one model was cut across GPUs because it
        did not fit. Here the model already fits, and we simply want more of it.
      </p>

      <h2>A concrete deployment</h2>
      <p>
        Two H100 machines, four vLLM engines, and a model that needs TP=4. That is TP=4 × DP=4 = 16
        GPUs, two engine copies per machine.
      </p>
      <p>
        One machine runs <Term>headless</Term> — engines only, no API server, nothing listening
        for HTTP. The other runs the same two engines <em>plus</em> the frontend that users actually
        talk to.
      </p>

      <BlogFigure
        src="server_setup.png"
        caption="Two 8×H100 nodes: one headless, one hosting the API server"
        max={560}
      />

      <CodeBlock
        lang="bash"
        caption="The same command on both nodes, differing only in --headless and the DP start rank."
        code={`# node 0 — headless
vllm serve <model-name> \\
  --tensor-parallel-size 4 \\
  --data-parallel-size 4 \\
  --data-parallel-size-local 2 \\
  --data-parallel-start-rank 0 \\
  --data-parallel-address <master-ip> \\
  --data-parallel-rpc-port 13345 \\
  --headless

# node 1 — same, but hosts the API server and starts at rank 2
vllm serve <model-name> \\
  --tensor-parallel-size 4 \\
  --data-parallel-size 4 \\
  --data-parallel-size-local 2 \\
  --data-parallel-start-rank 2 \\
  --data-parallel-address <master-ip> \\
  --data-parallel-rpc-port 13345`}
      />

      <h2>The backend: DPEngineCoreProc</h2>
      <p>
        On each node a <Code>CoreEngineProcManager</Code> launches{' '}
        <Code>--data-parallel-size-local</Code> processes, each running{' '}
        <Code>EngineCoreProc.run_engine_core</Code>, which creates a <Code>DPEngineCoreProc</Code>{' '}
        and enters its busy loop. Startup does:
      </p>
      <ol>
        <li>
          create an <Code>input_queue</Code> and <Code>output_queue</Code> (plain{' '}
          <Code>queue.Queue</Code>);
        </li>
        <li>
          handshake with the frontend over a <Code>DEALER</Code> ZMQ socket and receive coordination
          addresses;
        </li>
        <li>initialize the DP group (e.g. NCCL backend);</li>
        <li>
          initialize the <Code>EngineCore</Code> with a <Code>MultiProcExecutor</Code> — the TP=4
          machinery from <StageRef n={11} />;
        </li>
        <li>
          start a background <strong>input</strong> thread and a background{' '}
          <strong>output</strong> thread. Then wait on a <Code>ready_event</Code> until every input
          thread, across all four processes on both machines, has finished its handshake;
        </li>
        <li>
          send a "ready" message to the frontend with metadata such as <Code>num_gpu_blocks</Code>;
        </li>
        <li>all three threads enter their steady-state busy loops.</li>
      </ol>

      <Callout kind="key" title="Three threads, one job each">
        <p>
          <strong>Input thread</strong> — blocks on the input socket; on receipt decodes the
          payload, does <Code>input_queue.put_nowait(...)</Code>, and goes back to blocking.
        </p>
        <p>
          <strong>Main thread</strong> — wakes on <Code>input_queue.get(...)</Code>, feeds the
          request to the engine, then calls <Code>engine_core.step()</Code> over and over, pushing
          results to <Code>output_queue</Code>. That is the same schedule, forward pass, postprocess
          loop from <StageRef n={2} />, now with <Code>MultiProcExecutor</Code> underneath.
        </p>
        <p>
          <strong>Output thread</strong> — wakes on <Code>output_queue.get(...)</Code>, sends
          results back to the API server, resumes blocking.
        </p>
      </Callout>

      <BlogFigure
        src="dpenginecoreproc.png"
        caption="Four DP replicas, each a DPEngineCoreProc with main, input, and output threads"
      />

      <h2>The frontend, and the routing decision</h2>
      <p>
        The API server node builds an <Code>AsyncLLM</Code>, a wrapper that lets the engine be
        driven from asynchronous code. That in turn creates a <Code>DPLBAsyncMPClient</Code> — the
        engine core client from <StageRef n={2} />, in its full form: data-parallel,
        load-balancing, asynchronous, multiprocessing.
      </p>
      <p>
        Then <Code>launch_core_engines</Code> sets up the socket addresses for the handshake, spawns
        a <Code>DPCoordinator</Code> process, and creates a <Code>CoreEngineProcManager</Code> just
        like the headless node did.
      </p>
      <p>
        The <Code>DPCoordinator</Code> sits between frontend and backend. It periodically sends
        load-balancing info (queue sizes, waiting/running counts) to the frontend's{' '}
        <Code>run_engine_stats_update_task</Code>, handles <Code>SCALE_ELASTIC_EP</Code> commands to
        change the engine count dynamically (Ray backend only), and relays{' '}
        <Code>START_DP_WAVE</Code> events.
      </p>
      <p>
        And when a request arrives, <Code>get_core_engine_for_request</Code> picks the replica with
        the minimum score:
      </p>

      <CodeBlock
        lang="python"
        caption="Queued work is weighted 4× a running request, because a queued request has not started producing anything yet."
        code={`score = len(waiting) * 4 + len(running)
chosen = min(engines, key=score)`}
      />

      <h2>Watch it happen</h2>
      <p>
        The panel runs four engine replicas and lets you swap the routing rule. Its main readout is{' '}
        <strong>mean imbalance</strong>: on average, how unevenly queued work is spread across the
        four.
      </p>
      <p>
        Start with <Code>Request-cost skew</Code> at 0, so every request costs the same, and{' '}
        <Code>Routing</Code> on <Code>round-robin</Code>. Imbalance sits around 0.8.{' '}
        <Code>vLLM score</Code> gives 0.89 — very slightly <em>worse</em>.
      </p>
      <p>
        That is not a bug, it is the honest answer. When every request is identical, counting
        requests is already a perfect proxy for counting work, and round-robin counts perfectly.
      </p>
      <p>
        Now turn <Code>Request-cost skew</Code> up to 10 and <Code>Arrivals per step</Code> to 5.
        Round-robin degrades to 2.60 and <Code>random</Code> to 9.15, while <Code>vLLM score</Code>{' '}
        barely moves, at 1.07.
      </p>
      <p>
        That is the whole case for load-aware routing. Round-robin still shares out request{' '}
        <em>counts</em> perfectly; it just cannot see that the request it handed to E1 will run ten
        times longer than the last one. Score-based routing looks at what each engine is actually
        holding, so uneven costs stop mattering.
      </p>

      <h2>The full request lifecycle</h2>
      <Card className="my-5 p-4">
        <ol className="space-y-1.5 text-[0.82rem] leading-relaxed text-ink-dim">
          <li>
            <Code>curl</Code> POSTs to <Code>/v1/completions</Code>; the request hits{' '}
            <Code>OpenAIServingCompletion.create_completion</Code>.
          </li>
          <li>
            The prompt is tokenized asynchronously and metadata prepared (request id, sampling
            params, timestamp).
          </li>
          <li>
            <Code>AsyncLLM.generate</Code> is called, following the same flow as the synchronous
            engine, eventually reaching <Code>DPAsyncMPClient.add_request_async</Code>.
          </li>
          <li>
            <Code>get_core_engine_for_request</Code> load-balances on the coordinator's state and
            picks the minimum-score engine.
          </li>
          <li>
            The <Code>ADD</Code> request goes to that engine's <Code>input_socket</Code>.
          </li>
          <li>
            At the engine: input thread decodes and enqueues → main thread runs{' '}
            <Code>engine_core.step()</Code> until a stop condition → output thread ships results
            back.
          </li>
          <li>
            Those results wake the frontend's <Code>process_outputs_socket</Code> and{' '}
            <Code>output_handler</Code> asyncio tasks, which propagate tokens to the FastAPI route.
          </li>
          <li>
            FastAPI attaches finish reason, logprobs, and usage info, and Uvicorn returns the{' '}
            <Code>JSONResponse</Code>.
          </li>
        </ol>
      </Card>

      <Callout kind="note" title="Two mechanisms that look odd until explained">
        <p>
          <strong>DP waves.</strong> The system tracks "waves": when all engines go idle they
          quiesce, and the counter increments when new work arrives. It exists for coordination and
          metrics.
        </p>
        <p>
          <strong>Dummy steps.</strong> If <em>any</em> replica has work, <em>every</em> replica
          runs a forward step. The idle ones run a fake one purely to take part in the
          synchronisation points the others are waiting at, so they never hold up the busy replica.
        </p>
        <p>
          Strictly this is only needed for mixture-of-experts models, where the expert layers form
          one communication group while attention stays data-parallel. It is currently done under
          data parallelism always, because plain non-MoE DP has limited use anyway — for that you
          could just run independent vLLMs behind an ordinary load balancer.
        </p>
        <p>
          Adding more API servers needs nothing special: load balancing then happens at the
          OS/socket level, invisible to the application.
        </p>
      </Callout>

      <Takeaways
        items={[
          'Scaling out is DP replicas of the whole engine, each internally TP-sharded, with a DPCoordinator process feeding load state to the frontend and one or more FastAPI/Uvicorn servers in front.',
          'Each replica is a DPEngineCoreProc with three threads: input (socket → queue), main (the familiar step() loop), output (queue → socket). ZMQ between processes, plain queues within.',
          'Routing is score = len(waiting) * 4 + len(running), minimized. Weighting the queue 4× beats round-robin whenever request costs are uneven — which is always.',
          'Dummy steps keep idle replicas participating in collective sync points so they cannot stall a busy one; DP waves track the idle/active transitions for coordination and metrics.',
        ]}
      />
    </StageLayout>
  )
}
