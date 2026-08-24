import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import guidedDecoding, { allowedAt, isAccepting, VOCAB, WORDS } from '../sim/guidedDecoding'
import {
  BlogFigure,
  Callout,
  Code,
  CodeBlock,
  StageRef,
  StatRow,
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
              className="flex h-6 w-6 items-center justify-center font-mono text-[0.65rem] transition-all duration-200"
              style={{
                background: committed
                  ? C.decode
                  : current
                    ? 'rgba(125,211,252,0.18)'
                    : 'transparent',
                boxShadow: current
                  ? `inset 0 0 0 1.5px var(--color-accent)`
                  : `inset 0 0 0 1px var(--color-edge)`,
                color: committed ? C.bg : current ? C.ink : C.faint,
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
      <StatRow>
        <StatTile
          label="output so far"
          value={state.emitted || '—'}
          tone={state.violations ? 'bad' : 'good'}
        />
        <StatTile
          label="legal next tokens"
          value={`${allowed.length}/${VOCAB.length}`}
          tone="accent"
        />
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
      </StatRow>

      <div className="rounded-lg border border-edge bg-neutral-200 px-4 py-3">
        <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
          the FSM
        </div>
        <FsmDiagram state={state.fsm} />
      </div>

      {last && (
        <>
          <div>
            <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
              _grammar_bitmask — {VOCAB.length} bits, one per vocab token
            </div>
            <div className="scroll-x border border-edge bg-neutral-100 p-3">
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
                        className="flex h-6 w-6 items-center justify-center font-mono text-[0.62rem]"
                        style={{
                          background: b ? C.cached : C.free,
                          color: b ? C.bg : C.faint,
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
                  <span className="font-mono text-[0.68rem] text-accent-700">
                    0b{last.mask.binary} = {last.mask.value}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
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
              picked <span className="text-accent-700">"{last.char}"</span>
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
    <StageLayout
      slug="guided-decoding"
      sim={sim}
      simTitle="FSM + bitmask stepper"
      simSubtitle='choice=["Positive", "Negative"] at character level, with a 16-token vocab. The junk tokens x, #, and 7 are deliberately given high logits so you can watch masking earn its keep.'
      legend={[
        { label: 'allowed by the FSM', color: C.cached },
        { label: 'masked to −∞', color: C.bad },
        { label: 'sampled', color: C.good },
      ]}
      simFooter={
        <>
          Turn guided decoding <Code>off</Code> and step: the model happily samples <Code>x</Code>{' '}
          or <Code>#</Code>, the FSM cannot advance, and the output is garbage no post-hoc validator
          can rescue. Turn it back <Code>on</Code> and the same logits produce a guaranteed-valid
          word. The model never changed — only what it was allowed to say.
        </>
      }
      tryThis={[
        'Run with guiding on: 8 steps, the word Positive, no illegal characters.',
        'Turn it off. The same scores now give Posx.',
        'Lean the model toward Negative with guiding still off: it emits 7 on the very first step.',
      ]}
      panel={<GuidedViz sim={sim} />}
    >
      <p>
        Sometimes you need output that <em>parses</em>: JSON matching a schema, a SQL statement, one
        of exactly two labels. Asking politely in the prompt and hoping is a bet.
      </p>
      <p>
        Guided decoding turns it into a guarantee. At every step it edits the logits — the model's
        raw scores over the vocabulary, from <StageRef n={5} /> — so that an invalid token cannot be
        chosen at all.
      </p>

      <h2>Grammar becomes a state machine</h2>
      <p>
        A grammar is compiled into a <strong>finite state machine</strong>, or FSM: a small set of
        states, each of which knows which characters may come next. Think of it as a map with
        one-way streets.
      </p>
      <p>
        At each decode step the FSM's current state says which tokens are legal. Every other logit
        is set to −∞ before sampling, which makes its probability exactly zero — not small, zero.
        Once a token is sampled, the FSM moves to its next state.
      </p>
      <p>
        This is not limited to short lists of choices. The same machinery covers anything a regular
        expression can describe, and grammar backends extend it to the nested structures that
        programming languages and JSON need.
      </p>

      <BlogFigure src="fsm.png" caption="The toy example's FSM" max={560} />

      <h2>Watch it happen</h2>
      <p>
        The panel constrains a 16-character vocabulary to the two words{' '}
        <Code>Positive</Code> and <Code>Negative</Code>, one character per step. Three junk
        characters — <Code>x</Code>, <Code>#</Code> and <Code>7</Code> — are deliberately given high
        scores, so masking has something to do.
      </p>
      <p>
        Run it with <Code>Guided decoding</Code> on <Code>on</Code>. Eight steps, the word{' '}
        <Code>Positive</Code>, zero illegal characters. Flip{' '}
        <Code>What the model leans toward</Code> to <Code>Negative</Code> and it produces{' '}
        <Code>Negative</Code> just as cleanly.
      </p>
      <p>
        Now turn <Code>Guided decoding</Code> to <Code>off</Code> and run it again. The model gets
        three characters in and then samples <Code>x</Code>, leaving <Code>Posx</Code>. Lean it
        toward <Code>Negative</Code> with guiding off and it emits <Code>7</Code> on the very first
        step.
      </p>
      <p>
        The model did not change between those runs. Its scores were identical. The only difference
        is what it was permitted to say — which is why no validator bolted on afterwards can achieve
        the same thing. By then the token is already in the output.
      </p>

      <h2>How vLLM wires it up</h2>
      <ol>
        <li>
          At engine construction a <Code>StructuredOutputManager</Code> is created with access to
          the tokenizer, holding a <Code>_grammar_bitmask</Code> tensor.
        </li>
        <li>
          When a guided request arrives, its status becomes <Code>WAITING_FOR_FSM</Code> and{' '}
          <Code>grammar_init</Code> picks a backend compiler, such as <Code>xgrammar</Code>.
        </li>
        <li>The grammar is compiled in the background.</li>
        <li>
          During scheduling, a request whose grammar is ready flips to <Code>WAITING</Code> and
          joins <Code>structured_output_request_ids</Code>. One that is not ready goes to{' '}
          <Code>skipped_waiting_requests</Code> and is tried again next step.
        </li>
        <li>
          After the scheduling loop, the manager asks the backend to build or update{' '}
          <Code>_grammar_bitmask</Code> for every guided request in the batch.
        </li>
        <li>
          After the forward pass produces logits, the mask is expanded to vocabulary width and the
          disallowed logits are set to −∞.
        </li>
        <li>
          After sampling, each request's FSM advances through <Code>accept_tokens</Code>.
        </li>
      </ol>

      <Callout kind="key" title="Why a bitmask and not a list of booleans">
        <p>
          The mask stores one bit per token, packed 32 tokens to an <Code>int32</Code>. For a
          128k-token vocabulary that is 4k integers rather than 128k booleans.
        </p>
        <p>
          That 32× saving matters because the mask is rebuilt <em>every step, for every guided
          request</em>. It is the difference between guided decoding costing almost nothing and
          becoming the bottleneck. It gets expanded back to full width on the GPU, right before
          masking.
        </p>
        <p>
          The panel shows the whole thing as one integer, because its vocabulary is only 16 tokens
          wide. At the first step just <Code>P</Code> and <Code>N</Code> are legal, so the mask is{' '}
          <Code>0000000010000001</Code> — the number 129. Every 0 in there is a logit about to
          become −∞.
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
          <strong>Compilation is not free.</strong> A complicated grammar takes real time to
          compile, which is why vLLM does it in the background and parks the request in{' '}
          <Code>WAITING_FOR_FSM</Code>. The first request with a brand-new schema pays for that in
          its time to first token.
        </p>
        <p>
          <strong>Valid is not the same as correct.</strong> Guided decoding guarantees the shape of
          the output, nothing more. A schema-perfect JSON object full of invented values is still
          wrong — and now it parses cleanly, which makes it easier to miss.
        </p>
        <p>
          Most of the hard work lives in third-party libraries such as <Code>xgrammar</Code>, whose
          job is turning the current FSM state into those bit patterns.
        </p>
      </Callout>

      <Takeaways
        items={[
          'A grammar compiles to a finite state machine. At each step the FSM decides which tokens are legal, and every other logit is set to −∞ so sampling cannot pick it. Invalid output becomes impossible rather than unlikely.',
          'The guarantee comes from editing logits before sampling, which is why a validator applied afterwards is not equivalent — by then the wrong token has already been emitted.',
          '_grammar_bitmask packs one bit per token, 32 per int32, and is rebuilt every step for every guided request. That compactness is what makes it affordable at a 128k vocabulary.',
          'Grammars compile in the background (status WAITING_FOR_FSM) because compiling inline would hurt time to first token.',
          'The guarantee is syntactic only. Schema-valid output can still be factually wrong, and it is now harder to spot.',
        ]}
      />
    </StageLayout>
  )
}
