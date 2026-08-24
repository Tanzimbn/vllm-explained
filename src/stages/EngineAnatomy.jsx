import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import engine, { ENGINE_EDGES, ENGINE_GROUPS, ENGINE_NODES, PHASES } from '../sim/engine'
import { BlogFigure, Callout, Card, Code, CodeBlock, StageRef, Takeaways } from '../components/ui'
import { NodeGraph } from '../components/viz'

function EngineViz({ sim }) {
  const { state } = sim
  const phase = PHASES[state.i]
  return (
    <div className="space-y-4">
      <NodeGraph
        nodes={ENGINE_NODES}
        edges={ENGINE_EDGES}
        groups={ENGINE_GROUPS}
        width={560}
        height={300}
        active={phase.node}
        activeEdge={phase.edge}
      />
      <div className="rounded-lg border border-accent bg-accent/[0.06] px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[0.62rem] tracking-widest text-accent-700 uppercase">
            {phase.phase === 'step' ? 'inside step()' : 'setup / teardown'}
          </span>
          <h5 className="font-mono text-[0.82rem] text-ink">{phase.title}</h5>
        </div>
        <p className="mt-1.5 text-[0.82rem] leading-relaxed text-ink-dim">{phase.detail}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2 font-mono text-[0.65rem]">
          <span className="text-ink-faint">now holding:</span>
          <span className="rounded bg-panel-2 px-1.5 py-0.5 text-accent border border-edge">
            {phase.produces}
          </span>
          {state.loops > 0 && state.i >= 4 && state.i <= 8 && (
            <span className="text-ink-faint">
              · decode loop iteration {state.loops + 1}, {state.tokens} token(s) out
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function EngineAnatomy() {
  const sim = useSimulation(engine)

  return (
    <StageLayout
      slug="engine-anatomy"
      sim={sim}
      simTitle="One request through the whole engine"
      simSubtitle="The highlighted box is the part doing work right now. The dashed arrows only matter later on: freed blocks going back to the pool, and the grammar mask reaching into sampling."
      tryThis={[
        'Step 9 times to follow one request from the processor out to the caller, reading each caption as it lights up.',
        'Notice it passes through schedule, forward pass and postprocess 2 times before finishing. That is the decode loop.',
      ]}
      panel={<EngineViz sim={sim} />}
    >
      <p>
        Before we open any one box, it helps to count the boxes. The engine is only a handful of
        parts, and each part has one clear job. Everything later in this roadmap is either a closer
        look at one of these parts, or a swap of one part for a bigger version of itself.
      </p>

      <h2>What gets built at startup</h2>
      <p>
        Making an <Code>LLM</Code> object runs the constructor — the setup that happens once, before
        any request shows up. It puts four things in place:
      </p>
      <ul>
        <li>
          <strong>vLLM config</strong> — one bag holding every setting: which model, how big the
          cache is, how many GPUs to spread across.
        </li>
        <li>
          <strong>Processor</strong> — the front door. It checks your input, turns the text into
          token ids, and packs the result into an <Code>EngineCoreRequest</Code>.
        </li>
        <li>
          <strong>Engine core client</strong> — the middleman. When any code wants the engine to do
          work, it calls the client, and the client passes the job to the <Code>EngineCore</Code>{' '}
          that actually does it.
        </li>
        <li>
          <strong>Output processor</strong> — the back door. It turns the engine's raw{' '}
          <Code>EngineCoreOutputs</Code> into the <Code>RequestOutput</Code> you actually read.
        </li>
      </ul>

      <p>
        That middleman looks pointless at first, and right now it nearly is. The client here is an{' '}
        <Code>InprocClient</Code>, and the <Code>EngineCore</Code> is sitting in the very same
        process, so "passing the job along" is an ordinary function call. Nothing is sent anywhere.
      </p>
      <p>
        It earns its keep by being replaceable. In <StageRef n={12} /> the client becomes a{' '}
        <Code>DPLBAsyncMPClient</Code>: it takes the exact same request, but sends it over a socket
        to engine processes running elsewhere, and load-balances across them. The code on either
        side of it does not change — the caller still just calls the client. Swapping that one part
        is most of what turning this into a real server means.
      </p>

      <p>
        Open up the <Code>EngineCore</Code> and there are three more parts inside:
      </p>
      <ul>
        <li>
          <strong>Model executor</strong> — runs the forward passes. For now that is a{' '}
          <Code>UniProcExecutor</Code>: one worker, one GPU.
        </li>
        <li>
          <strong>Structured output manager</strong> — keeps the output to a shape you asked for,
          like valid JSON (<StageRef n={8} />).
        </li>
        <li>
          <strong>Scheduler</strong> — decides who runs next. It holds the policy (<Code>FCFS</Code>{' '}
          or <Code>priority</Code>), a <Code>waiting</Code> queue and a <Code>running</Code> queue,
          and the <strong>KV cache manager</strong> — the heart of paged attention.
        </li>
      </ul>

      <BlogFigure
        src="engine_constructor.png"
        caption="The engine's components and their relationships"
      />

      <Callout kind="key" title="The one data structure to remember">
        <p>
          The KV cache manager keeps a <Code>free_block_queue</Code>: a pool of KV-cache blocks that
          nobody is using yet. There are often hundreds of thousands of them, depending on how much
          VRAM you have and how big a block is. A block is where the model parks the keys and values
          it has already worked out for a few tokens, so it never has to work them out twice.
          Handing blocks out and taking them back is what paged attention <em>is</em> —{' '}
          <StageRef n={3} /> is entirely about this.
        </p>
      </Callout>

      <p>For a standard (non-MLA) transformer layer, one block takes up this many bytes:</p>
      <CodeBlock
        lang="text"
        caption="This is why block_size, num_kv_heads and dtype keep coming up in capacity planning: together they decide how many blocks fit in the VRAM that is left once the weights are loaded."
        code={`2 (key/value) * block_size (default=16) * num_kv_heads * head_size * dtype_num_bytes`}
      />

      <h2>Worker startup: three steps</h2>
      <p>
        Building the model executor creates one <Code>Worker</Code>, and that worker runs three
        setup steps. Learn their names now: later, when there are many GPUs, these exact three run
        on every worker process at once.
      </p>
      <div className="my-5 grid gap-3 sm:grid-cols-3">
        {[
          {
            n: '01',
            t: 'Init device',
            d: 'Pick a CUDA device, check the dtype works on it, and check there is enough VRAM for the gpu_memory_utilization you asked for. Then wire up the parallelism groups (DP/TP/PP/EP) and build a model_runner plus an InputBatch — the CPU-side scratch space for block tables and sampling settings.',
          },
          {
            n: '02',
            t: 'Load model',
            d: 'Build the network, load the weights into it, switch it to eval mode, and optionally hand it to torch.compile().',
          },
          {
            n: '03',
            t: 'Initialize KV cache',
            d: 'Ask each layer how much cache it needs. Run one fake forward pass and measure the VRAM left over — that number decides how many blocks fit. Allocate them, hand them to the layers, then record CUDA graphs for a few common batch sizes.',
          },
        ].map((x) => (
          <Card key={x.n} className="p-3.5">
            <div className="font-mono text-[0.6rem] text-accent-700">{x.n}</div>
            <div className="mt-0.5 font-mono text-[0.78rem] text-ink">{x.t}</div>
            <p className="mt-1.5 text-[0.75rem] leading-relaxed text-ink-faint">{x.d}</p>
          </Card>
        ))}
      </div>

      <Callout kind="note" title="Where the KV cache size comes from">
        <p>
          Notice that nobody sets the number of KV blocks by hand. Step 03 measures it: run a fake
          forward pass, see how much VRAM is left, divide by the size of one block. So changing{' '}
          <Code>gpu_memory_utilization</Code>, the model, or the dtype quietly changes how many
          requests you can keep in flight at once — and that is your throughput ceiling.
        </p>
      </Callout>

      <h2>The loop</h2>
      <p>
        Once requests start arriving, the engine just calls <Code>step()</Code> over and over. Every
        step does the same three things in the same order: <strong>schedule</strong> →{' '}
        <strong>forward pass</strong> → <strong>postprocess</strong>. Nothing else. Step the panel
        on the right to follow one request the whole way round, including two laps of the decode
        loop.
      </p>

      <BlogFigure src="engine_loop.png" caption="The engine loop" max={520} />

      <h2>When a request stops</h2>
      <p>Postprocess is also where a request ends. Any one of these is enough to finish it:</p>
      <ul>
        <li>
          it got too long — past <Code>max_model_length</Code>, or past its own{' '}
          <Code>max_tokens</Code>;
        </li>
        <li>
          the token just sampled is the EOS id — unless you set <Code>ignore_eos</Code>, which
          benchmarks do so that every request produces exactly the same number of tokens;
        </li>
        <li>
          the token just sampled is one of <Code>stop_token_ids</Code>;
        </li>
        <li>
          a stop <em>string</em> shows up in the text, in which case the output is cut at the first
          place it appears and the request is aborted.
        </li>
      </ul>
      <Callout kind="gotcha">
        <p>
          The two stop settings behave differently, which is easy to trip over. A token from{' '}
          <Code>stop_token_ids</Code> <em>stays</em> in the output. A stop string does <em>not</em>{' '}
          — it gets cut off.
        </p>
      </Callout>

      <Takeaways
        items={[
          'The whole engine is: Processor → EngineCoreClient → EngineCore (Scheduler + KVCacheManager + ModelExecutor + StructuredOutputManager) → OutputProcessor. Scaling up swaps bigger parts in behind those same seams; the shape never changes.',
          'Every step is schedule → forward pass → postprocess. Nothing else happens, and every feature later in this roadmap plugs into one of those three.',
          'The number of KV-cache blocks is measured at startup by a fake forward pass, never configured — so it moves whenever your model, dtype, or gpu_memory_utilization moves.',
        ]}
      />
    </StageLayout>
  )
}
