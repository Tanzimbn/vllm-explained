import { useSimulation } from '../hooks/useSimulation'
import guidedDecoding, { allowedAt, isAccepting, VOCAB, WORDS } from '../sim/guidedDecoding'
import {
  BlogFigure,
  Callout,
  Code,
  CodeBlock,
  SimFrame,
  StatTile,
  Takeaways,
} from '../components/ui'
import { C, DistChart } from '../components/viz'

function FsmDiagram({ state }) {
  const allowed = allowedAt(state)
  const rows = WORDS.map((w, wi) => {
    const onBranch = state.branch === null || state.branch === wi
    return (
      <div key={w} className="flex items-center gap-1">
        <span
          className="w-16 shrink-0 font-mono text-[0.62rem]"
          style={{ color: onBranch ? C.dim : C.faint, opacity: onBranch ? 1 : 0.4 }}
        >
          {w}
        </span>
        {w.split('').map((ch, i) => {
          const committed = onBranch && i < state.pos
          const current = onBranch && i === state.pos
          return (
            <span
              key={i}
              className="flex h-6 w-6 items-center justify-center rounded-[3px] font-mono text-[0.65rem] transition-all duration-200"
              style={{
                background: committed ? C.decode : current ? 'rgba(125,211,252,0.18)' : 'transparent',
                boxShadow: current
                  ? `inset 0 0 0 1.5px var(--color-accent)`
                  : `inset 0 0 0 1px var(--color-edge)`,
                color: committed ? '#08090d' : current ? C.ink : C.faint,
                opacity: onBranch ? 1 : 0.3,
              }}
            >
              {ch}
            </span>
          )
        })}
        {onBranch && state.pos === w.length && (
          <span className="ml-1 font-mono text-[0.6rem]" style={{ color: C.good }}>
            ✓ accept
          </span>
        )}
      </div>
    )
  })
  return (
    <div className="space-y-1.5">
      {rows}
      <div className="pt-1 font-mono text-[0.62rem] text-ink-faint">
        state: pos={state.pos}, branch={state.branch === null ? 'undecided' : WORDS[state.branch]} ·
        legal next: {allowed.length ? allowed.map((a) => `"${a}"`).join(' ') : 'none (accepting)'}
      </div>
    </div>
  )
}

function GuidedViz({ sim }) {
  const { state, params } = sim
  const last = state.last
  const allowed = allowedAt(state.fsm)
  const done = isAccepting(state.fsm)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="output so far"
          value={state.emitted || '—'}
          tone={state.violations ? 'bad' : 'good'}
        />
        <StatTile label="legal next tokens" value={`${allowed.length}/${VOCAB.length}`} tone="accent" />
        <StatTile
          label="grammar violations"
          value={state.violations}
          tone={state.violations ? 'bad' : 'good'}
        />
        <StatTile
          label="status"
          value={done ? 'valid' : state.violations ? 'invalid' : 'in progress'}
          tone={done ? 'good' : state.violations ? 'bad' : 'neutral'}
        />
      </div>

      <div className="rounded-lg border border-edge bg-panel-2/40 px-4 py-3">
        <div className="mb-2 font-mono text-[0.62rem] tracking-widest text-ink-faint uppercase">
          the FSM
        </div>
        <FsmDiagram state={state.fsm} />
      </div>

      {last && (
        <>
          <div>
            <div className="mb-2 font-mono text-[0.62rem] tracking-widest text-ink-faint uppercase">
              _grammar_bitmask — {VOCAB.length} bits, one per vocab token
            </div>
            <div className="scroll-x rounded-md border border-edge bg-[#08090d] p-3">
              <div className="min-w-max space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-right font-mono text-[0.6rem] text-ink-faint">
                    token
                  </span>
                  <div className="flex gap-[3px]">
                    {VOCAB.map((t, i) => (
                      <span
                        key={i}
                        className="w-6 text-center font-mono text-[0.6rem]"
                        style={{ color: last.mask.bits[i] ? C.cached : C.faint }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-right font-mono text-[0.6rem] text-ink-faint">
                    bit
                  </span>
                  <div className="flex gap-[3px]">
                    {last.mask.bits.map((b, i) => (
                      <span
                        key={i}
                        className="flex h-6 w-6 items-center justify-center rounded-[3px] font-mono text-[0.62rem]"
                        style={{
                          background: b ? C.cached : C.free,
                          color: b ? '#08090d' : C.faint,
                        }}
                      >
                        {b}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <span className="w-20 shrink-0 text-right font-mono text-[0.6rem] text-ink-faint">
                    as an int
                  </span>
                  <span className="font-mono text-[0.68rem] text-accent">
                    0b{last.mask.binary} = {last.mask.value}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 font-mono text-[0.62rem] tracking-widest text-ink-faint uppercase">
              logits {params.guided === 'on' ? '— masked positions set to −∞' : '— unmasked'}
            </div>
            <DistChart
              height={110}
              bars={VOCAB.map((t, i) => {
                const masked = params.guided === 'on' && !last.mask.bits[i]
                return {
                  label: t,
                  // shift into positive range so bars are visible
                  value: masked ? 0.02 : Math.max(0.02, last.logits[i] + 2),
                  color: i === last.pick ? C.good : masked ? C.bad : C.decode,
                  muted: masked,
                }
              })}
            />
            <div className="mt-2 font-mono text-[0.68rem] text-ink-dim">
              picked <span className="text-accent">"{last.char}"</span>
              {last.legal ? (
                <span style={{ color: C.good }}> · legal, FSM advances (accept_tokens)</span>
              ) : (
                <span style={{ color: C.bad }}>
                  {' '}
                  · ILLEGAL — the grammar is broken and cannot be repaired
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function GuidedDecoding() {
  const sim = useSimulation(guidedDecoding)

  return (
    <>
      <p>
        Sometimes you need output that <em>parses</em> — JSON matching a schema, a SQL statement, one
        of exactly two labels. Prompting for it and hoping is a probabilistic bet. Guided decoding
        turns it into a guarantee, by constraining the logits at every step so that an invalid token
        cannot be sampled at all.
      </p>

      <h3>Grammar becomes a state machine</h3>
      <p>
        A grammar compiles into a finite state machine. At each decode step the FSM's current state
        determines which tokens are legal; every other logit is set to −∞ before sampling, so its
        probability after softmax is exactly zero. After a token is sampled, the FSM advances.
      </p>
      <p>
        This handles far more than enums: regular grammars (Chomsky type-3, so any regex) all the way
        up to context-free grammars (type-2, which covers most programming languages).
      </p>

      <SimFrame
        sim={sim}
        keys
        title="FSM + bitmask stepper"
        subtitle='choice=["Positive", "Negative"] at character level, with a 16-token vocab. The junk tokens x, #, and 7 are deliberately given high logits so you can watch masking earn its keep.'
        legend={[
          { label: 'allowed by the FSM', color: C.cached },
          { label: 'masked to −∞', color: C.bad },
          { label: 'sampled', color: C.good },
        ]}
        footer={
          <>
            Turn guided decoding <Code>off</Code> and step: the model happily samples{' '}
            <Code>x</Code> or <Code>#</Code>, the FSM cannot advance, and the output is garbage
            no post-hoc validator can rescue. Turn it back <Code>on</Code> and the same logits
            produce a guaranteed-valid word. The model never changed — only what it was allowed to
            say.
          </>
        }
      >
        <GuidedViz sim={sim} />
      </SimFrame>

      <BlogFigure src="fsm.png" caption="The toy example's FSM" max={560} />

      <h3>How vLLM wires it up</h3>
      <ol>
        <li>
          At engine construction a <Code>StructuredOutputManager</Code> is created with access to
          the tokenizer, holding a <Code>_grammar_bitmask</Code> tensor.
        </li>
        <li>
          When a guided request is added, its status becomes <Code>WAITING_FOR_FSM</Code> and{' '}
          <Code>grammar_init</Code> selects a backend compiler — e.g. <Code>xgrammar</Code>.
        </li>
        <li>The grammar is compiled asynchronously.</li>
        <li>
          During scheduling, if compilation has finished the status flips to <Code>WAITING</Code> and
          the id joins <Code>structured_output_request_ids</Code>; otherwise it goes to{' '}
          <Code>skipped_waiting_requests</Code> and is retried next step.
        </li>
        <li>
          After the scheduling loop, if any FSM requests are present the manager asks the backend to
          prepare or update <Code>_grammar_bitmask</Code>.
        </li>
        <li>
          After the forward pass produces logits, the bitmask is expanded to vocab size and
          disallowed logits are set to −∞.
        </li>
        <li>
          After sampling, the request's FSM advances via <Code>accept_tokens</Code>.
        </li>
      </ol>

      <Callout kind="key" title="Why a bitmask and not a boolean array">
        <p>
          One bit per token, packed 32 tokens to an <Code>int32</Code>. For a 128k vocab that's 4k
          integers instead of 128k booleans — and it has to be rebuilt <em>every step for every
          guided request</em>, so the 32× saving in size and bandwidth is the difference between
          guided decoding being cheap and being the bottleneck. It's expanded back out to vocab
          width on the GPU right before masking.
        </p>
        <p>
          With <Code>vocab_size = 32</Code> the whole mask is a single integer: <Code>101…001</Code>{' '}
          expands to <Code>[1, 0, 1, …, 0, 0, 1]</Code>, and every position holding 0 gets its logit
          set to −∞.
        </p>
      </Callout>

      <BlogFigure src="fsm2.png" caption="An 8-token vocab with an 8-bit mask" max={560} />

      <CodeBlock
        caption="The blog's classification example. The engine now cannot return anything but one of those two strings."
        code={`from vllm import LLM, SamplingParams
from vllm.sampling_params import GuidedDecodingParams

prompts = [
    "This sucks",
    "The weather is beautiful",
]

guided_decoding_params = GuidedDecodingParams(choice=["Positive", "Negative"])
sampling_params = SamplingParams(guided_decoding=guided_decoding_params)

llm = LLM(model="TinyLlama/TinyLlama-1.1B-Chat-v1.0")
outputs = llm.generate(prompts, sampling_params)`}
      />

      <Callout kind="gotcha" title="Two costs worth knowing about">
        <p>
          <strong>Compilation is not free.</strong> A complex grammar takes real time to compile,
          which is why vLLM does it asynchronously and lets the request sit in{' '}
          <Code>WAITING_FOR_FSM</Code>. A first request with a novel schema pays a TTFT penalty.
        </p>
        <p>
          <strong>Validity is not correctness.</strong> Guided decoding guarantees the output
          matches the grammar. It does not make the content right — a schema-valid JSON object full
          of hallucinated values is still wrong, and now it parses cleanly, which can make it harder
          to notice.
        </p>
        <p>
          Most of the real complexity lives in third-party libraries like{' '}
          <Code>xgrammar</Code>, which is responsible for producing the bit patterns from the
          current FSM state.
        </p>
      </Callout>

      <Takeaways
        items={[
          'A grammar compiles to an FSM; at each step the FSM decides which tokens are legal, and everything else is set to −∞ so sampling cannot pick it. Invalid output becomes impossible, not merely unlikely.',
          '_grammar_bitmask packs one bit per token, 32 per int32, and is rebuilt every step per guided request — that compactness is what makes it affordable at 128k vocab sizes.',
          'Grammars are compiled asynchronously (status WAITING_FOR_FSM) because compilation is slow enough to hurt TTFT if done inline.',
          'The guarantee is syntactic only. Schema-valid output can still be factually wrong — and it is now harder to spot.',
        ]}
      />
    </>
  )
}
