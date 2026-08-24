import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import batching, { utilization } from '../sim/batching'
import { Callout, Code, CodeBlock, StageRef, StatRow, StatTile, Takeaways } from '../components/ui'
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
        Send a prompt to an LLM and the engine does two quite different jobs to answer it. The
        first job runs once. The second runs again for every word it writes back. They want
        opposite things from the GPU, and they have to share one.
      </p>
      <p>
        That tension shapes every design decision in the rest of this roadmap. It is worth getting
        straight before anything else.
      </p>

      <h2>The two jobs</h2>
      <p>
        <strong>Prefill</strong> is the first job. The model reads your whole prompt and works out
        one thing: the first token of the reply. Every token of the prompt is handled at the same
        time, because they are all already known.
      </p>
      <p>
        That is a lot of arithmetic, and none of it waits on anything else. The limit is simply how
        fast the GPU can multiply, so we call prefill <strong>compute-bound</strong>. Give the chip
        more of this work and it will keep up.
      </p>
      <p>
        <strong>Decode</strong> is the second job. It runs once for every token after the first,
        and each run reads exactly one token — the one just produced — to predict the next.
      </p>
      <p>
        One token is barely any arithmetic. The model kept its working from all the earlier tokens
        in a scratchpad called the <strong>KV cache</strong>, so nothing gets recomputed. What that
        cache holds, and why storing it is hard, is the subject of <StageRef n={3} />.
      </p>
      <p>
        But there is a catch, and it is the reason this whole field exists. To predict that single
        token, the GPU still has to drag every weight in the model out of memory and through the
        arithmetic units. That memory is <strong>HBM</strong>, the bank of high-bandwidth chips
        sitting beside the GPU. On a large model it means moving tens of gigabytes to produce a
        couple of bytes of output.
      </p>
      <p>
        So the arithmetic units now sit mostly idle, waiting to be fed. The limit has moved to
        memory, which is why decode is called <strong>memory-bandwidth-bound</strong>. Per token it
        is a terrible deal.
      </p>

      <Callout kind="intuition" title="Why decode is such a bad deal">
        <p>
          Imagine driving a lorry across town to collect a single apple. The apple weighs nothing;
          the trip costs the same whether you bring back one apple or a thousand.
        </p>
        <p>
          That trip is streaming the weights out of HBM, and one decode step brings back one token.
          Batching is simply the decision to fill the lorry.
        </p>
      </Callout>

      <Callout kind="key">
        <p>
          The tension in one line. Prefill wants many tokens at once, to keep the arithmetic units
          busy. Decode wants many <em>sequences</em> at once, so that one expensive trip through
          the weights produces many tokens instead of one. Both have to happen on the same GPU,
          taking turns, without either being starved.
        </p>
      </Callout>

      <p>
        vLLM's V1 scheduler can put prefills and decodes in the <em>same</em> step. The older V0
        engine had to pick one or the other, which left capacity unused. <StageRef n={5} title />{' '}
        shows how the mixing works.
      </p>

      <h2>Why the obvious fix isn't enough</h2>
      <p>
        Decode is held up by memory traffic, so the fix suggests itself: run several sequences
        together. One trip through the weights then yields <Code>B</Code> tokens instead of one,
        and the expensive part is paid once rather than <Code>B</Code> times.
      </p>
      <p>
        The simple way to do that is <strong>static batching</strong>. Collect <Code>B</Code>{' '}
        requests, run them together until every one of them has finished, return the results, then
        collect the next <Code>B</Code>.
      </p>
      <p>
        It fails for a dull reason: requests do not finish together. One wants 3 tokens, another
        wants 400. The batch cannot be broken up part-way, so the short request's slot stays
        occupied and idle until the long one is done. Meanwhile new requests wait outside for a
        slot that is doing nothing.
      </p>

      <h2>Watch it happen</h2>
      <p>
        The panel on the right puts eight requests through four batch slots. Leave{' '}
        <Code>Batching</Code> on <Code>static</Code> and press <Code>▶ Run</Code>. It takes 21
        steps, wastes 23 slot-steps and ends at 73% slot utilization.
      </p>
      <p>
        Now switch <Code>Batching</Code> to <Code>continuous</Code> and run it again. The same eight
        requests take 17 steps and waste 7 slot-steps.
      </p>
      <p>
        Then drag <Code>Output-length spread</Code> down to 0, so every request asks for the same
        number of tokens, and run each mode once more. Both finish in 4 steps and waste nothing at
        all. That is where the waste actually comes from: not from batching, but from batching
        things that finish at different times.
      </p>

      <h2>Continuous batching</h2>
      <p>
        <strong>Continuous batching</strong> (from a system called Orca) changes when the engine is
        allowed to reshuffle. Rather than admitting and retiring a whole batch at a time, it does
        both after every single step.
      </p>
      <p>
        A sequence that hits its stop condition gives up its slot straight away. Before the next
        step, the scheduler looks at everything in the system — the requests still running and any
        that have just arrived — and decides again who goes.
      </p>
      <p>
        Reshuffling that often sounds expensive. Here it is nearly free, and the reason is worth
        knowing early. A vLLM batch is not a fixed block of sequences that has to be held together
        from one step to the next. There is no shape to preserve, so changing who is in it costs
        nothing. <StageRef n={5} title /> shows what it is instead.
      </p>

      <Callout kind="gotcha" title="Offline vs online">
        <p>
          The offline engine you get from <Code>LLM(...)</Code> only ever sees the prompts you hand
          it up front. Nothing can arrive mid-run, so there is little for continuous batching to
          react to. It earns its keep in the <em>asynchronous</em> engine, where requests turn up
          over the network at unpredictable times. The ability is built into the engine core
          either way.
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
          'Prefill reads the whole prompt at once and is limited by GPU arithmetic. Decode produces one token per pass and is limited by memory bandwidth. Nearly every optimization in this roadmap exists because those two limits are different.',
          'Static batching wastes capacity in proportion to how much output lengths vary, because a slot is only free again when the slowest member of its batch is done.',
          'Continuous batching admits and retires requests every step rather than every batch. It is possible because a vLLM batch has no fixed shape to hold together between steps — the forward-pass stage shows what it is instead.',
        ]}
      />
    </StageLayout>
  )
}
