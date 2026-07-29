import { useSimulation } from '../hooks/useSimulation'
import chunkedPrefill, { itlStats } from '../sim/chunkedPrefill'
import {
  BlogFigure,
  Callout,
  Code,
  CodeBlock,
  SimFrame,
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
      </div>

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
          <span className="font-mono text-[0.62rem] tracking-widest text-ink-faint uppercase">
            step duration — height is wall-clock ms
          </span>
          <span className="font-mono text-[0.6rem] text-ink-faint tabular-nums">
            {state.elapsedMs.toFixed(0)} ms total
          </span>
        </div>
        <div className="scroll-x rounded-md border border-edge bg-[#08090d] p-3">
          <div className="flex min-w-max items-end gap-[3px]" style={{ height: 120 }}>
            {state.steps.map((x, i) => {
              const h = (x.ms / maxMs) * 100
              const prefillShare = x.ms > 0 ? x.prefillTokens / (x.prefillTokens + x.decodeTokens) : 0
              return (
                <div
                  key={i}
                  className="flex w-4 flex-col justify-end"
                  style={{ height: '100%' }}
                  title={`step ${i}: ${x.prefillTokens} prefill + ${x.decodeTokens} decode tokens → ${x.ms.toFixed(1)} ms`}
                >
                  <div
                    className="w-full rounded-t-[2px] transition-all"
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
        <div className="mb-2 font-mono text-[0.62rem] tracking-widest text-ink-faint uppercase">
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

      <p className="rounded-md bg-panel-2/50 px-3 py-2 font-mono text-[0.7rem] leading-relaxed text-ink-dim">
        <span className="text-accent">step {state.tick}:</span> {state.note}
      </p>
    </div>
  )
}

export default function ChunkedPrefill() {
  const sim = useSimulation(chunkedPrefill)

  return (
    <>
      <p>
        Stage 04 left the scheduler with a hole in it: a prefill is all-or-nothing, so a prompt
        longer than the token budget can never be scheduled at all. And even when a long prompt{' '}
        <em>does</em> fit, running it in a single step hurts everybody else in that step.
      </p>

      <h3>The cost is step duration, not queue order</h3>
      <p>
        Remember that decodes are scheduled before prefills, so a long prompt cannot push a
        decoding request out of a step. What it does instead is make the step{' '}
        <strong>take much longer</strong>. Every request in a step waits for the whole step to
        finish, so a step that also computes 2048 prefill tokens delivers its decode tokens late.
        For a user watching text stream in, that is a visible stall.
      </p>

      <Callout kind="key" title="Head-of-line blocking, restated">
        <p>
          Without chunking, one very long request monopolizes an engine step — postponing other
          requests and increasing their latency. The scheduler is fair about <em>order</em> and
          still delivers unfair <em>latency</em>, because the unit of fairness is the step and steps
          are not all the same size.
        </p>
      </Callout>

      <h3>The fix is almost embarrassingly simple</h3>
      <p>
        Cap the number of new tokens a prefill may contribute per step. If the requested number
        exceeds <Code>long_prefill_token_threshold</Code>, reset it to exactly that value. The
        block-indexing logic from stage 03 already handles a request whose KV arrives in pieces —{' '}
        <Code>slot_mapping</Code> doesn't care whether positions 0–127 and 128–255 were computed in
        the same forward pass. So nothing else has to change.
      </p>
      <p>
        A prompt <Code>P</Code> split into chunks <Code>x-y-z</Code> takes at least three engine
        steps, and only in the <em>last</em> chunk — the one containing the final prompt token — is a
        new token sampled. The intermediate chunks produce no output at all; they are pure KV
        population.
      </p>

      <BlogFigure src="chunked_pt1.png" caption="A long prompt prefilled in chunks across several steps" />

      <SimFrame
        sim={sim}
        keys
        title="Chunking on/off"
        subtitle="A 1024-token prompt arrives while four requests are already streaming. Bar height is how long each step took; orange is the prefill's share, blue the decodes'."
        legend={[
          { label: 'prefill tokens in step', color: C.prefill },
          { label: 'decode tokens in step', color: C.decode },
          { label: 'ITL far above median', color: C.bad },
        ]}
        footer={
          <>
            Run it with chunking <Code>off</Code>, note the spike factor, then switch it{' '}
            <Code>on</Code>. Total work is identical — the same 1024 tokens get prefilled either
            way, and end-to-end time barely moves. What changes is the <em>distribution</em> of
            latency: one catastrophic step becomes eight ordinary ones. Then try dropping the token
            budget below the prompt length with chunking off, and watch it deadlock exactly as the
            stage-04 scheduler did.
          </>
        }
      >
        <ChunkViz sim={sim} />
      </SimFrame>

      <CodeBlock
        lang="text"
        caption="That is genuinely the whole mechanism. Everything that makes it work was already built in stages 03 and 04."
        code={`num_new_tokens = req.num_prompt_tokens - req.num_computed_tokens

if num_new_tokens > long_prefill_token_threshold:
    num_new_tokens = long_prefill_token_threshold   # <- chunked prefill

allocate_slots(req, num_new_tokens)`}
      />

      <Callout kind="gotcha" title="It can happen whether you ask for it or not">
        <p>
          In vLLM V1 you enable chunked prefill by setting{' '}
          <Code>long_prefill_token_threshold</Code> to a positive integer. But chunking also occurs
          implicitly: if a prompt is longer than the step's token budget, it gets truncated to fit
          and runs as a chunked prefill anyway. The threshold is how you control chunk size, not
          whether chunking is possible.
        </p>
      </Callout>

      <Callout kind="note" title="Choosing a threshold">
        <p>
          Smaller chunks smooth ITL further but add per-step overhead and delay the long request's
          own TTFT — it needs more steps before its final chunk lands. Watch both the spike factor
          and the prefill TTFT readout as you change the threshold: they move in opposite
          directions. That trade-off is the entire tuning decision.
        </p>
      </Callout>

      <Takeaways
        items={[
          'A long prefill hurts co-scheduled decodes by inflating step duration, not by jumping the queue — decodes are always scheduled first.',
          'Chunked prefill caps prefill tokens per step at long_prefill_token_threshold. Only the final chunk samples a token; the rest just populate KV.',
          'It needs no new machinery: paged block indexing already tolerates a prefill arriving in pieces. It also removes the deadlock where a prompt longer than the token budget could never be scheduled.',
          'Smaller chunks trade the long request\'s own TTFT for smoother ITL on everyone else.',
        ]}
      />
    </>
  )
}
