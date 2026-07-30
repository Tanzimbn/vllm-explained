import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import engine, { ENGINE_EDGES, ENGINE_GROUPS, ENGINE_NODES, PHASES } from '../sim/engine'
import { BlogFigure, Callout, Card, Code, CodeBlock, SimFrame, Takeaways } from '../components/ui'
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
      simSubtitle="Highlighted node = the component currently doing work. The dashed edges are the ones that only matter later: freed blocks returning to the pool, and the grammar bitmask reaching into sampling."
      panel={<EngineViz sim={sim} />}
    >
      <p>
        Before opening any single box, it helps to know how many boxes there are. The engine is a
        small number of components with clean responsibilities, and the whole rest of this roadmap
        is either zooming into one of them or swapping one for a bigger version of itself.
      </p>

      <h2>The constructor</h2>
      <p>
        Building an <Code>LLM</Code> assembles four things:
      </p>
      <ul>
        <li>
          <strong>vLLM config</strong> — every knob for model, cache, and parallelism settings.
        </li>
        <li>
          <strong>Processor</strong> — turns raw inputs into <Code>EngineCoreRequest</Code>s via
          validation, tokenization, and processing.
        </li>
        <li>
          <strong>Engine core client</strong> — here an <Code>InprocClient</Code>, which is
          basically the <Code>EngineCore</Code> itself. Stage 12 replaces it with a{' '}
          <Code>DPLBAsyncMPClient</Code> and that is most of what "serving at scale" means.
        </li>
        <li>
          <strong>Output processor</strong> — converts raw <Code>EngineCoreOutputs</Code> into the{' '}
          <Code>RequestOutput</Code> the caller sees.
        </li>
      </ul>
      <p>
        The <Code>EngineCore</Code> in turn contains a <strong>Model Executor</strong> (drives
        forward passes; a <Code>UniProcExecutor</Code> with one worker on one GPU for now), a{' '}
        <strong>Structured Output Manager</strong> (guided decoding, stage 08), and the{' '}
        <strong>Scheduler</strong> — which holds the policy setting (<Code>FCFS</Code> or{' '}
        <Code>priority</Code>), the <Code>waiting</Code> and <Code>running</Code> queues, and the{' '}
        <strong>KV cache manager</strong>: the heart of paged attention.
      </p>

      <BlogFigure
        src="engine_constructor.png"
        caption="The engine's components and their relationships"
      />

      <Callout kind="key" title="The one data structure to remember">
        <p>
          The KV-cache manager maintains a <Code>free_block_queue</Code> — a pool of available
          KV-cache blocks, often hundreds of thousands of them depending on VRAM and block size.
          During paged attention these blocks are the indexing structure mapping tokens to their
          computed KV cache. Stage 03 is entirely about this.
        </p>
      </Callout>

      <p>For a standard (non-MLA) transformer layer, one block's size in bytes is:</p>
      <CodeBlock
        lang="text"
        caption="Which is why block_size, num_kv_heads and dtype all show up in capacity planning: they decide how many blocks fit in the VRAM left over after weights."
        code={`2 (key/value) * block_size (default=16) * num_kv_heads * head_size * dtype_num_bytes`}
      />

      <h2>Worker startup: three procedures</h2>
      <p>
        Constructing the model executor creates a <Code>Worker</Code> and runs three procedures.
        These same three will later run independently on every worker process across every GPU — so
        it is worth knowing them by name.
      </p>
      <div className="my-5 grid gap-3 sm:grid-cols-3">
        {[
          {
            n: '01',
            t: 'Init device',
            d: 'Assign a CUDA device, check the dtype is supported, verify enough VRAM given gpu_memory_utilization, set up DP/TP/PP/EP, then build a model_runner and an InputBatch (CPU-side buffers, block tables, sampling metadata).',
          },
          {
            n: '02',
            t: 'Load model',
            d: 'Instantiate the architecture, load weights, call model.eval(), and optionally torch.compile() it.',
          },
          {
            n: '03',
            t: 'Initialize KV cache',
            d: 'Get the per-layer KV-cache spec, run a dummy profiling forward pass and snapshot GPU memory to compute how many blocks fit, allocate and bind the KV tensors, then capture CUDA graphs for a set of warmup batch sizes.',
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
          Notice that nobody configures the number of KV blocks directly. Step 03 measures it: run a
          dummy forward pass, see how much VRAM is left, divide by block size. That is why changing{' '}
          <Code>gpu_memory_utilization</Code>, the model, or the dtype silently changes how many
          requests you can hold in flight — and therefore your throughput ceiling.
        </p>
      </Callout>

      <h2>The loop</h2>
      <p>
        Once fed, the engine repeatedly calls <Code>step()</Code>, and each step has exactly three
        stages: <strong>schedule</strong> → <strong>forward pass</strong> →{' '}
        <strong>postprocess</strong>. Step through the simulator to follow one request all the way
        around, including two trips around the decode loop.
      </p>

      <BlogFigure src="engine_loop.png" caption="The engine loop" max={520} />

      <h2>Stop conditions</h2>
      <p>Postprocess ends a request when any of these fire:</p>
      <ul>
        <li>
          the request exceeds its length limit — <Code>max_model_length</Code> or its own{' '}
          <Code>max_tokens</Code>;
        </li>
        <li>
          the sampled token is the EOS id — unless <Code>ignore_eos</Code> is set, which
          benchmarking uses to force an exact output length;
        </li>
        <li>
          the sampled token is in <Code>stop_token_ids</Code>;
        </li>
        <li>
          a stop <em>string</em> appears, in which case the output is truncated at its first
          occurrence and the request aborted.
        </li>
      </ul>
      <Callout kind="gotcha">
        <p>
          A small asymmetry worth remembering: <Code>stop_token_ids</Code> <em>will</em> appear in
          the output, but stop strings will <em>not</em>.
        </p>
      </Callout>

      <Takeaways
        items={[
          'The engine is: Processor → EngineCoreClient → EngineCore (Scheduler + KVCacheManager + ModelExecutor + StructuredOutputManager) → OutputProcessor. Scaling up swaps implementations behind those same seams without changing the shape.',
          'Every step is schedule → forward pass → postprocess. Nothing else happens; every feature later in this roadmap hooks into one of those three.',
          'The number of KV-cache blocks is measured at startup by a dummy forward pass, not configured — which makes it a function of your model, dtype, and gpu_memory_utilization.',
        ]}
      />
    </StageLayout>
  )
}
