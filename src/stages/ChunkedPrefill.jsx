import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import chunkedPrefill, { itlStats } from '../sim/chunkedPrefill'
import {
  BlogFigure,
  Callout,
  Code,
  CodeBlock,
  SimFrame,
  StageRef,
  StatRow,
  StatTile,
  Takeaways,
} from '../components/ui'
import { C, MeterBar } from '../components/viz'

function ChunkViz({ sim }) {
  const { state, params } = sim
  const stats = itlStats(state)
  const maxMs = Math.max(...state.steps.map((x) => x.ms), 20)

  return (
    <div className="space-y-5">
      <StatRow>
        <StatTile
          label="worst ITL"
          value={stats.max.toFixed(0)}
          unit="ms"
          tone={stats.max > 60 ? 'bad' : stats.max > 30 ? 'warn' : 'good'}
          hint="The longest a decoding request waited for a single token"
        />
        <StatTile label="median ITL" value={stats.p50.toFixed(0)} unit="ms" />
        <StatTile
          label="spike factor"
          value={stats.spike ? `${stats.spike.toFixed(1)}×` : '—'}
          tone={stats.spike > 3 ? 'bad' : stats.spike > 1.6 ? 'warn' : 'good'}
          hint="Worst ITL ÷ median ITL — how badly one step hurt"
        />
        <StatTile
          label="prefill TTFT"
          value={state.prefillTTFT ? state.prefillTTFT.toFixed(0) : '—'}
          unit={state.prefillTTFT ? 'ms' : ''}
          tone="accent"
        />
      </StatRow>

      <MeterBar
        label="long prompt prefilled"
        value={state.prefillDone}
        max={params.longPromptLen}
        color={C.prefill}
        sublabel={`${state.prefillDone} / ${params.longPromptLen} tokens`}
      />

      {/* step duration bars */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
            step duration — height is wall-clock ms
          </span>
          <span className="font-mono text-[0.6rem] text-ink-faint tabular-nums">
            {state.elapsedMs.toFixed(0)} ms total
          </span>
        </div>
        <div className="scroll-x border border-edge bg-neutral-100 p-3">
          <div className="flex min-w-max items-end gap-[3px]" style={{ height: 120 }}>
            {state.steps.map((x, i) => {
              const h = (x.ms / maxMs) * 100
              const prefillShare =
                x.ms > 0 ? x.prefillTokens / (x.prefillTokens + x.decodeTokens) : 0
              return (
                <div
                  key={i}
                  className="flex w-4 flex-col justify-end"
                  style={{ height: '100%' }}
                  title={`step ${i}: ${x.prefillTokens} prefill + ${x.decodeTokens} decode tokens → ${x.ms.toFixed(1)} ms`}
                >
                  <div
                    className="w-full transition-all"
                    style={{
                      height: `${Math.max(2, h * prefillShare)}%`,
                      background: C.prefill,
                      display: x.prefillTokens ? 'block' : 'none',
                    }}
                  />
                  <div
                    className="w-full transition-all"
                    style={{
                      height: `${Math.max(2, h * (1 - prefillShare))}%`,
                      background: C.decode,
                      display: x.decodeTokens ? 'block' : 'none',
                    }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* per-decoder ITL trace */}
      <div>
        <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
          each decoder's inter-token latency
        </div>
        <div className="space-y-1">
          {state.decoders.map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <span className="w-7 font-mono text-[0.65rem] text-ink-dim">{d.id}</span>
              <div className="scroll-x flex flex-1 items-end gap-[2px]" style={{ height: 26 }}>
                {d.itls.map((ms, i) => (
                  <div
                    key={i}
                    title={`token ${i + 1}: ${ms.toFixed(1)} ms`}
                    className="w-2.5 shrink-0 rounded-t-[2px]"
                    style={{
                      height: `${Math.max(8, (ms / maxMs) * 100)}%`,
                      background: ms > stats.p50 * 2.5 ? C.bad : C.decode,
                    }}
                  />
                ))}
              </div>
              <span className="w-16 text-right font-mono text-[0.6rem] text-ink-faint tabular-nums">
                {d.generated}/{d.outLen} tok
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="rounded-md bg-neutral-200 px-3 py-2 font-mono text-[0.7rem] leading-relaxed text-ink-dim">
        <span className="text-accent-700">step {state.tick}:</span> {state.note}
      </p>
    </div>
  )
}

export default function ChunkedPrefill() {
  const sim = useSimulation(chunkedPrefill)

  return (
    <StageLayout
      slug="chunked-prefill"
      sim={sim}
      simTitle="Chunking on/off"
      simSubtitle="A 1024-token prompt arrives while four requests are already streaming. Bar height is how long each step took; orange is the prefill's share, blue the decodes'."
      legend={[
        { label: 'prefill tokens in step', color: C.prefill },
        { label: 'decode tokens in step', color: C.decode },
        { label: 'ITL far above median', color: C.bad },
      ]}
      simFooter={
        <>
          Run it with chunking <Code>off</Code>, note the spike factor, then switch it{' '}
          <Code>on</Code>. Total work is identical — the same 1024 tokens get prefilled either way,
          and end-to-end time does not move at all. What changes is the <em>distribution</em> of
          latency: one catastrophic step becomes eight ordinary ones. Then drop the token budget
          below the prompt length with chunking still <Code>off</Code>. Nothing deadlocks, because
          the prompt gets chunked implicitly to fit the budget.
        </>
      }
      panel={<ChunkViz sim={sim} />}
    >
      <p>
        <StageRef n={4} title /> left the scheduler with a hole in it. A prefill is all-or-nothing,
        so a prompt longer than the token budget can never be scheduled at all. And even a long
        prompt that <em>does</em> fit makes life worse for everybody it shares a step with.
      </p>
      <p>
        Two words for the damage, because they are the words everyone measures with.{' '}
        <strong>TTFT</strong> is time to first token: how long you wait after sending a prompt
        before any text appears. <strong>ITL</strong> is inter-token latency: the gap between one
        token of the answer and the next, once text is flowing.
      </p>

      <h2>The cost is step duration, not queue order</h2>
      <p>
        Decodes are scheduled before prefills, so a long prompt cannot push a decoding request out
        of a step. What it does instead is make the step take much longer.
      </p>
      <p>
        Every request in a step waits for the whole step to finish. A step that also has to chew
        through 1024 prefill tokens delivers its decode tokens late. For somebody watching text
        appear, that is a visible stall in the middle of their answer.
      </p>

      <Callout kind="key" title="Head-of-line blocking, restated">
        <p>
          One very long request takes over an engine step and delays everyone else in it. The
          scheduler is scrupulously fair about <em>order</em> and still hands out unfair{' '}
          <em>latency</em>. The unit of fairness is the step, and steps are not all the same size.
        </p>
      </Callout>

      <h2>Watch it happen</h2>
      <p>
        The panel drops a 1024-token prompt on four requests that are already streaming. Run it with{' '}
        <Code>Chunked prefill</Code> set to <Code>off</Code>. A typical token arrives 6ms after the
        one before it — and one token takes 99ms, a spike of more than 15×. That single tall bar is
        the prefill step.
      </p>
      <p>
        Now switch <Code>Chunked prefill</Code> to <Code>on</Code> and run it again. The tall bar is
        gone: every gap is now about 18ms and the spike factor is 1.
      </p>
      <p>
        Look at what did <em>not</em> change. The run still takes 10 steps and 156ms, because it is
        the same 1024 tokens of prefill either way. Nothing got faster. The waiting was simply
        spread evenly instead of being dumped on one unlucky token.
      </p>
      <p>
        One number did get worse. The long prompt's own TTFT went from 99ms to 143ms, because its
        final chunk now lands several steps later. That is the trade, and it is the whole tuning
        decision.
      </p>

      <h2>The fix is almost embarrassingly simple</h2>
      <p>
        Cap how many new tokens a prefill may contribute in one step. If it asks for more than{' '}
        <Code>long_prefill_token_threshold</Code>, give it exactly the threshold instead.
      </p>
      <p>
        Nothing else has to change, and that is the good part. The block indexing from{' '}
        <StageRef n={3} /> already copes with a request whose KV shows up in instalments. The{' '}
        <Code>slot_mapping</Code> arithmetic does not care whether positions 0–127 and 128–255 were
        computed in the same forward pass.
      </p>
      <p>
        A prompt split into three chunks takes at least three engine steps. Only the last chunk, the
        one holding the final prompt token, samples a new token. The earlier chunks produce no
        output at all; they exist purely to fill in KV.
      </p>

      <BlogFigure
        src="chunked_pt1.png"
        caption="A long prompt prefilled in chunks across several steps"
      />

      <CodeBlock
        lang="text"
        caption="That is genuinely the whole mechanism. Everything that makes it work was already built in the paged-attention and scheduler stages."
        code={`num_new_tokens = req.num_prompt_tokens - req.num_computed_tokens

if num_new_tokens > long_prefill_token_threshold:
    num_new_tokens = long_prefill_token_threshold   # <- chunked prefill

allocate_slots(req, num_new_tokens)`}
      />

      <Callout kind="gotcha" title="It can happen whether you ask for it or not">
        <p>
          You turn chunked prefill on in vLLM V1 by setting{' '}
          <Code>long_prefill_token_threshold</Code> to a positive number. But chunking also happens
          on its own: a prompt longer than the step's token budget is cut down to fit and runs as a
          chunked prefill regardless.
        </p>
        <p>
          So the threshold controls the chunk size, not whether chunking can occur. This is also why
          the deadlock from the scheduler stage cannot happen here — an oversized prompt gets fed in
          pieces rather than being refused forever.
        </p>
      </Callout>

      <Callout kind="note" title="Choosing a threshold">
        <p>
          The two numbers move in opposite directions, and the panel will show you. At a threshold
          of 512 the spike is still 8×, but the long prompt's TTFT is a brisk 105ms. Drop to 64 and
          the spike disappears entirely, while that TTFT stretches to 192ms.
        </p>
        <p>
          Smaller chunks smooth everyone else's ITL and cost the long request its own TTFT, because
          it needs more steps before its final chunk lands. There is no setting that wins both.
        </p>
      </Callout>

      <Takeaways
        items={[
          'A long prefill hurts the decodes it shares a step with by making the step longer, not by jumping the queue — decodes are always scheduled first.',
          'Chunked prefill caps prefill tokens per step at long_prefill_token_threshold. Only the final chunk samples a token; the rest just fill in KV.',
          'It needs no new machinery, because paged block indexing already tolerates a prefill arriving in pieces. It also removes the case where a prompt longer than the token budget could never be scheduled.',
          "Smaller chunks buy smoother ITL for everyone else and pay for it with the long request's own TTFT. Total work and total time are unchanged either way.",
        ]}
      />
    </StageLayout>
  )
}
