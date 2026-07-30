import { Link } from 'react-router-dom'
import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import batching, { utilization } from '../sim/batching'
import { Callout, Code, CodeBlock, StatRow, StatTile, Takeaways } from '../components/ui'
import { C, QueueLane, Timeline } from '../components/viz'

function BatchingViz({ sim }) {
  const { state, params } = sim
  const util = utilization(state)
  const done = state.requests.filter((r) => r.status === 'done')
  const avgLatency = done.length
    ? done.reduce((a, r) => a + (r.doneAt - 0 + 1), 0) / done.length
    : 0

  return (
    <div className="space-y-5">
      <StatRow>
        <StatTile
          label="slot utilization"
          value={util.toFixed(0)}
          unit="%"
          tone={util > 75 ? 'good' : util > 45 ? 'warn' : 'bad'}
          hint="Share of batch-slot-steps that did real work"
        />
        <StatTile label="wasted slot-steps" value={state.wastedSlotSteps} tone="bad" />
        <StatTile label="tokens emitted" value={state.tokensOut} tone="accent" />
        <StatTile
          label="finished"
          value={`${done.length}/${state.requests.length}`}
          tone={done.length === state.requests.length ? 'good' : 'neutral'}
        />
      </StatRow>

      {/* live batch slots */}
      <div>
        <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
          batch slots ({params.maxBatch})
        </div>
        <div className="flex flex-wrap gap-2">
          {state.slots.map((idx, si) => {
            const r = idx === null ? null : state.requests[idx]
            const finished = r?.status === 'done'
            return (
              <div
                key={si}
                className="flex h-14 w-24 flex-col items-center justify-center border font-mono text-[0.68rem] transition-colors duration-300"
                style={{
                  borderColor: r && !finished ? C.decode : C.divider,
                  background: r ? (finished ? C.n200 : C.a100) : 'transparent',
                  borderStyle: r ? 'solid' : 'dashed',
                }}
              >
                {r ? (
                  <>
                    <span style={{ color: finished ? C.faint : C.ink }}>{r.id}</span>
                    <span className="text-[0.6rem] text-neutral-600">
                      {finished ? 'idle — held' : `${r.generated}/${r.outLen} tok`}
                    </span>
                  </>
                ) : (
                  <span className="text-neutral-500">free</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <QueueLane
        label="waiting"
        accent={C.prefill}
        empty="—"
        items={state.requests
          .filter((r) => r.status === 'waiting')
          .map((r) => ({ id: r.id, sub: `·${r.outLen}`, tone: 'prefill', dim: true }))}
      />

      {/* per-request timeline */}
      <div>
        <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
          engine steps →
        </div>
        <Timeline
          rows={state.requests.map((r, i) => ({
            label: `${r.id} ·${r.outLen}`,
            cells: state.rows[i].length ? state.rows[i] : [{ kind: 'idle' }],
          }))}
          cursor={state.tick - 1}
        />
      </div>

      <p className="bg-neutral-200 px-3 py-2 font-mono text-[0.7rem] leading-relaxed text-ink-dim">
        <span className="text-accent-700">tick {state.tick}:</span> {state.note}
      </p>
    </div>
  )
}

export default function PrefillVsDecode() {
  const sim = useSimulation(batching)

  return (
    <StageLayout
      slug="prefill-vs-decode"
      sim={sim}
      simTitle="Static vs continuous batching"
      simSubtitle="One tick is one engine step. Each request's first step is its prefill; the rest are decodes. Turn up the output-length spread to make the effect brutal."
      panel={<BatchingViz sim={sim} />}
      legend={[
        { label: 'prefill step', color: C.prefill },
        { label: 'decode step', color: C.decode },
        { label: 'queued outside the batch', color: C.n300 },
        { label: 'finished', color: C.n500 },
      ]}
      simFooter={
        <>
          Notice what changes and what doesn't: continuous batching does not make any single forward
          pass faster. It just stops you from paying for capacity you aren't using — which is why
          the wasted-slot-step counter, not the tick counter, is the one to watch.
        </>
      }
    >
      <p>
        An inference engine spends its life doing two jobs that want opposite things from the
        hardware. Getting them to share one GPU efficiently is the problem that shapes every design
        decision in the rest of this roadmap.
      </p>

      <h2>The two workloads</h2>
      <p>
        A <strong>prefill</strong> is a forward pass over every token of the prompt at once. There
        is a lot of arithmetic to do and it is all independent, so the GPU's compute units are the
        bottleneck: prefill is <strong>compute-bound</strong>. At the end you sample exactly one
        token, from the distribution at the final position.
      </p>
      <p>
        A <strong>decode</strong> is a forward pass over a single token — the one just generated.
        Every earlier key/value vector is already sitting in the KV cache, so there is almost no
        arithmetic to do. But you still have to stream every weight in the model from HBM into the
        chip to compute that one token. Decode is <strong>memory-bandwidth-bound</strong>, and it is
        wildly inefficient per token: you move gigabytes to produce a handful of bytes.
      </p>

      <Callout kind="key">
        <p>
          This asymmetry is the engine's central tension. Prefill wants big batches of tokens to
          saturate the compute units. Decode wants many sequences in flight so that the one
          expensive weight-streaming pass gets amortized across as many tokens as possible. And both
          need to happen on the same GPU, interleaved, without either starving the other.
        </p>
      </Callout>

      <p>
        vLLM's V1 scheduler can mix prefills and decodes in the <em>same</em> step. The V0 engine
        could only do one or the other per step, which left performance on the table — you'll see
        exactly how the mixing works in <Link to="/stage/forward-pass">stage 05</Link>.
      </p>

      <h2>Why batching naively goes wrong</h2>
      <p>
        Since decode is bandwidth-bound, batching is the obvious fix: run <Code>B</Code> sequences
        together and one weight-streaming pass yields <Code>B</Code> tokens instead of one. The
        naive way to do that is <strong>static batching</strong> — collect <Code>B</Code> requests,
        run them together, return all the results, collect the next <Code>B</Code>.
      </p>
      <p>
        The problem is that requests don't finish together. One asks for 3 tokens, another for 400.
        In a static batch every slot is held hostage by the slowest member: finished sequences sit
        in the batch doing nothing while new requests queue up outside. Run the panel on the right
        in <Code>static</Code> mode and watch the slot utilization number — then flip it to{' '}
        <Code>continuous</Code>.
      </p>

      <h2>Continuous batching</h2>
      <p>
        <strong>Continuous batching</strong> (introduced by Orca) retires and admits requests at{' '}
        <em>step</em> granularity instead of batch granularity. The moment a sequence hits its stop
        condition its slot is released, and after every step the scheduler reconsiders the whole
        population — old requests and newly arrived ones together.
      </p>
      <p>
        The reason this is even possible is a detail of how the forward pass is built: rather than
        stacking sequences into a padded rectangle, vLLM concatenates them into one long flat "super
        sequence", with position indices and custom attention kernels making sure each sequence only
        attends to its own tokens. There is no rectangle to keep intact, so there is nothing
        stopping the batch composition from changing every step.
      </p>

      <Callout kind="gotcha" title="Offline vs online">
        <p>
          The synchronous, offline engine you get from <Code>LLM(...)</Code> processes only the
          prompts you handed it — there is no mechanism to inject new requests mid-run. Continuous
          batching becomes visible with the <em>asynchronous</em> engine, where requests arrive over
          the network at arbitrary times. But the underlying capability is in the engine core either
          way, because of that flattened-batch design.
        </p>
      </Callout>

      <CodeBlock
        caption="The offline engine used as the running example throughout this roadmap. Everything else — paging, scheduling, speculation, distributed serving — is built around this two-line API."
        code={`from vllm import LLM, SamplingParams

prompts = [
    "Hello, my name is",
    "The president of the United States is",
]

sampling_params = SamplingParams(temperature=0.8, top_p=0.95)

def main():
    llm = LLM(model="TinyLlama/TinyLlama-1.1B-Chat-v1.0")
    outputs = llm.generate(prompts, sampling_params)

if __name__ == "__main__":
    main()`}
      />

      <Takeaways
        items={[
          'Prefill is compute-bound and processes the whole prompt at once; decode is memory-bandwidth-bound and produces one token per pass. Nearly every optimization in this roadmap exists because these two profiles differ.',
          'Static batching wastes capacity in proportion to how much output lengths vary, because the batch is only as free as its slowest member.',
          'Continuous batching admits and retires requests per step. It works because the batch is a flat concatenated sequence rather than a padded rectangle — so its composition can change at any step.',
        ]}
      />
    </StageLayout>
  )
}
