import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import specDecode, { METHOD_INFO, pDraft, pTarget, speedup, VOCAB } from '../sim/specDecode'
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
import { C, DistChart, LineChart } from '../components/viz'

function SpecViz({ sim }) {
  const { state, params } = sim
  const sp = speedup(state, params)
  const r = state.last
  const q = pDraft(params.agreement)
  const totalFirst = state.firstTokenHistogram.reduce((a, b) => a + b, 0) || 1

  return (
    <div className="space-y-5">
      <StatRow>
        <StatTile
          label="speedup"
          value={`${sp.factor.toFixed(2)}×`}
          tone={sp.factor > 1.5 ? 'good' : sp.factor > 1.02 ? 'warn' : 'bad'}
          hint="Tokens per round ÷ cost per round (1 target pass + k draft passes)"
        />
        <StatTile
          label="acceptance rate"
          value={(sp.acceptRate * 100).toFixed(0)}
          unit="%"
          tone={sp.acceptRate > 0.6 ? 'good' : sp.acceptRate > 0.3 ? 'warn' : 'bad'}
        />
        <StatTile label="tokens / round" value={sp.tokensPerRound.toFixed(2)} tone="accent" />
        <StatTile label="free bonus tokens" value={state.bonusTotal} tone="good" />
      </StatRow>

      {/* the current round */}
      {r && (
        <div className="rounded-lg border border-edge bg-neutral-200 px-4 py-3">
          <div className="mb-2.5 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
            round {state.tick} — draft, verify, accept/reject
          </div>
          <div className="scroll-x">
            <div className="flex min-w-max items-start gap-1.5">
              {r.verdicts.map((v, j) => (
                <div
                  key={j}
                  className="flex w-[104px] flex-col items-center rounded-md border px-1.5 py-2"
                  style={{
                    borderColor: v.accepted ? C.good : C.bad,
                    background: v.accepted ? 'rgba(93,219,164,0.10)' : 'rgba(239,122,133,0.10)',
                  }}
                >
                  <span className="font-mono text-[0.55rem] text-ink-faint">draft {j + 1}</span>
                  <span className="font-mono text-[0.78rem] text-ink">{VOCAB[v.token]}</span>
                  <span className="mt-1 font-mono text-[0.53rem] text-ink-faint tabular-nums">
                    p_t {v.pT.toFixed(3)}
                  </span>
                  <span className="font-mono text-[0.53rem] text-ink-faint tabular-nums">
                    p_d {v.pD.toFixed(3)}
                  </span>
                  <span
                    className="mt-1 font-mono text-[0.58rem] tabular-nums"
                    style={{ color: v.accepted ? C.good : C.bad }}
                  >
                    ratio {Math.min(9.99, v.ratio).toFixed(2)}
                  </span>
                  <span
                    className="font-mono text-[0.6rem]"
                    style={{ color: v.accepted ? C.good : C.bad }}
                  >
                    {v.accepted ? '✓ accept' : '✗ reject'}
                  </span>
                </div>
              ))}
              {/* untouched drafts after the first rejection */}
              {r.drafted.slice(r.verdicts.length).map((t, j) => (
                <div
                  key={`d${j}`}
                  className="flex w-[104px] flex-col items-center rounded-md border border-dashed border-edge px-1.5 py-2 opacity-40"
                  title="Never even examined — verification stops at the first rejection"
                >
                  <span className="font-mono text-[0.55rem] text-ink-faint">
                    draft {r.verdicts.length + j + 1}
                  </span>
                  <span className="font-mono text-[0.78rem] text-ink-faint">{VOCAB[t]}</span>
                  <span className="mt-3 font-mono text-[0.55rem] text-ink-faint">discarded</span>
                </div>
              ))}
              {r.resampled !== null && (
                <div
                  className="flex w-[104px] flex-col items-center rounded-md border px-1.5 py-2"
                  style={{ borderColor: C.warn, background: 'rgba(224,179,65,0.10)' }}
                  title="Sampled from normalize(max(0, p_target − p_draft))"
                >
                  <span className="font-mono text-[0.55rem]" style={{ color: C.warn }}>
                    resampled
                  </span>
                  <span className="font-mono text-[0.78rem] text-ink">{VOCAB[r.resampled]}</span>
                  <span className="mt-3 text-center font-mono text-[0.5rem] leading-tight text-ink-faint">
                    from the residual
                  </span>
                </div>
              )}
              {r.bonus !== null && (
                <div
                  className="flex w-[104px] flex-col items-center rounded-md border px-1.5 py-2"
                  style={{ borderColor: C.cached, background: 'rgba(93,219,164,0.10)' }}
                  title="All k accepted, so the target's (k+1)th distribution was already computed"
                >
                  <span className="font-mono text-[0.55rem]" style={{ color: C.cached }}>
                    bonus (k+1)
                  </span>
                  <span className="font-mono text-[0.78rem] text-ink">{VOCAB[r.bonus]}</span>
                  <span className="mt-3 font-mono text-[0.5rem] text-ink-faint">free</span>
                </div>
              )}
            </div>
          </div>
          <div className="mt-2.5 font-mono text-[0.68rem] text-ink-dim">
            {r.acceptedCount}/{params.k} accepted → {r.emitted.length} token(s) emitted this round:{' '}
            <span className="text-accent-700">{r.emitted.map((t) => VOCAB[t]).join(' ')}</span>
          </div>
        </div>
      )}

      {/* distributions */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
            target vs draft distribution
          </div>
          <DistChart
            height={100}
            bars={pTarget.map((pt, i) => ({ label: VOCAB[i], value: pt, color: C.decode }))}
          />
          <DistChart
            height={80}
            bars={q.map((pd, i) => ({ label: VOCAB[i], value: pd, color: C.prefill }))}
          />
        </div>
        <div>
          <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
            emitted first-token frequency vs p_target
          </div>
          <DistChart
            height={100}
            bars={state.firstTokenHistogram.map((c, i) => ({
              label: VOCAB[i],
              value: c / totalFirst,
              color: C.alloc,
            }))}
          />
          <p className="mt-1 text-[0.7rem] leading-relaxed text-ink-faint">
            This should converge on the blue target distribution above, no matter how bad the draft
            is. That equivalence is the correctness guarantee — and it is asserted in the test
            suite.
          </p>
        </div>
      </div>
    </div>
  )
}

function SpeedupChart({ params }) {
  // Expected tokens per round under a simple geometric acceptance model,
  // divided by cost — the shape that explains why k has a sweet spot.
  const curveFor = (accept) => {
    const pts = []
    for (let k = 1; k <= 12; k++) {
      let expected = 0
      for (let j = 1; j <= k; j++) expected += accept ** j
      expected += 1 // the resample or the bonus token
      pts.push([k, expected / (1 + k * params.draftCost)])
    }
    return pts
  }
  return (
    <LineChart
      height={190}
      xLabel="k (speculative tokens per round)"
      yLabel="speedup ×"
      xTicks={[1, 2, 4, 6, 8, 10, 12]}
      yTicks={[1, 2, 3]}
      series={[
        { label: 'accept 0.9', points: curveFor(0.9), color: C.good },
        { label: 'accept 0.7', points: curveFor(0.7), color: C.decode },
        { label: 'accept 0.5', points: curveFor(0.5), color: C.warn },
        { label: 'accept 0.3', points: curveFor(0.3), color: C.bad },
      ]}
      markers={[{ x: params.k, label: `k=${params.k}`, color: C.faint }]}
    />
  )
}

export default function SpeculativeDecoding() {
  const sim = useSimulation(specDecode)
  const info = METHOD_INFO[sim.params.method]

  return (
    <StageLayout
      slug="speculative-decoding"
      sim={sim}
      simTitle="Draft / verify / reject"
      simSubtitle="Each tick is one full speculation round. The ratio shown per draft token is p_target / p_draft — the actual acceptance test."
      legend={[
        { label: 'accepted', color: C.good },
        { label: 'rejected', color: C.bad },
        { label: 'resampled from residual', color: C.warn },
        { label: 'free bonus token', color: C.cached },
      ]}
      simFooter={
        <>
          Let it run a few hundred rounds and watch the purple histogram settle onto the blue target
          distribution — <em>at any agreement setting</em>, including 0. Then drag agreement down
          and watch the speedup collapse while the distribution stays correct. That is the whole
          character of the technique: it trades throughput risk for zero quality risk.
        </>
      }
      tryThis={[
        'Let it run a few hundred rounds: about 62% of drafts accepted, roughly 3.5 tokens a round, 2.5× overall.',
        'Drag draft agreement to 0 and keep going. The speedup collapses and the histogram still matches the target exactly.',
        'At agreement 0.2, sweep k: the peak is near 3, and k = 7 is worse than k = 3.',
      ]}
      panel={<SpecViz sim={sim} />}
    >
      <p>
        Decode is limited by memory bandwidth, as <StageRef n={1} /> showed: every step drags the
        whole model out of HBM to produce one token, and the arithmetic units mostly idle while it
        happens.
      </p>
      <p>
        Speculative decoding spends that idle capacity. If the weights are being moved anyway, you
        may as well check several candidate tokens in the same trip.
      </p>

      <Callout kind="intuition" title="A junior drafts, a senior signs off">
        <p>
          A junior writes a paragraph quickly and cheaply. A senior reads it in one pass and marks
          where they would have written something else, stopping at the first real disagreement.
          Everything above that line stands.
        </p>
        <p>
          The output is whatever the senior would have written on their own, because the senior
          checked every word of it. A bad junior costs you rewrites — never the quality of what
          finally ships.
        </p>
      </Callout>

      <h2>Draft, verify, and be careful about it</h2>
      <p>
        A small, cheap <strong>draft model</strong> guesses the next <Code>k</Code> tokens. The big{' '}
        <strong>target model</strong> then runs <em>once</em> over the context plus those guesses.
      </p>
      <p>
        One pass gives probabilities at all <Code>k</Code> guessed positions, plus one position
        beyond them. So a single expensive pass yields opinions about <Code>k+1</Code> tokens.
      </p>
      <p>Then the guesses are checked, left to right:</p>
      <ul>
        <li>
          if the target model's probability for the guessed token is <strong>at least</strong> the
          draft's, accept it;
        </li>
        <li>
          otherwise accept it with probability <Code>p_target(token) / p_draft(token)</Code> — the
          more the draft overreached, the likelier the rejection;
        </li>
        <li>
          stop at the first rejection, or accept all <Code>k</Code>.
        </li>
      </ul>
      <p>
        When a guess is rejected, its replacement is drawn from what is left of the target's opinion
        after removing what the draft already offered: <Code>normalize(max(0, p_target − p_draft))</Code>.
      </p>
      <p>
        That is less cryptic than it looks. In the panel the target gives{' '}
        <Code>the</Code> a probability of 0.42 while the draft only offers 0.29, so{' '}
        <Code>the</Code> keeps weight of 0.13 in the residual. The draft is over-eager about{' '}
        <Code>a</Code> — 0.29 against the target's 0.21 — so <Code>a</Code> is clamped to zero.
      </p>
      <p>
        The replacement is sampled only from where the target wanted <em>more</em> than the draft
        was offering. That is what keeps the arithmetic honest. And if nothing was rejected at all,
        the <Code>(k+1)</Code>th token comes free, straight from the target's own distribution,
        which was computed in the same pass.
      </p>

      <Callout kind="key" title="This is exact, not approximate">
        <p>
          A small model proposes the candidates, yet the accept-and-reject rule guarantees that the
          resulting text is distributed <em>exactly</em> as if you had sampled from the large model
          one token at a time.
        </p>
        <p>
          Speculative decoding is statistically indistinguishable from ordinary decoding. The draft
          model affects <em>speed</em> and never the output distribution. A bad draft costs you
          throughput, not quality.
        </p>
      </Callout>

      <BlogFigure src="specdec_pt1.png" caption="The drafting stage" />
      <BlogFigure src="specdec_pt2.png" caption="Verification and rejection sampling" />

      <h2>Watch it happen</h2>
      <p>
        The panel runs one full speculation round per tick, with <Code>k</Code> at 4 and the draft
        agreeing with the target 60% of the time. Let it run a few hundred rounds.
      </p>
      <p>
        About 62% of drafted tokens are accepted, which works out to roughly 3.5 tokens emitted per
        round instead of 1. After paying for the drafts, that is a speedup of about 2.5×.
      </p>
      <p>
        Now watch the purple histogram settle onto the blue target distribution. It does that at{' '}
        <em>any</em> agreement setting, including 0. Drag <Code>draft agreement</Code> to the floor
        and the speedup collapses while the distribution stays exactly right. That is the character
        of the whole technique: it risks throughput and never quality.
      </p>

      <h2>Why k has a sweet spot</h2>
      <p>
        Acceptance compounds. Getting the second guess accepted needs the first to be accepted too,
        so the chance of reaching the <Code>j</Code>th guess falls off like compound interest in
        reverse. Each extra speculative token contributes less than the one before it.
      </p>
      <p>
        Its cost, though, is paid in full every round whether it is used or not. Past some{' '}
        <Code>k</Code> you are buying tokens you will usually throw away.
      </p>
      <p>
        The panel will show you both ends of that. Set <Code>draft agreement</Code> to 0.2 and sweep{' '}
        <Code>k</Code>: the speedup peaks around <Code>k = 3</Code> at about 1.8× and then{' '}
        <em>falls</em> to 1.6× by <Code>k = 7</Code>. Set agreement to 0.9 and the same sweep climbs
        all the way to 4× at <Code>k = 7</Code> — the sweet spot has moved off the end of the knob.
      </p>

      <Card className="my-5 p-4">
        <SpeedupChart params={sim.params} />
        <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-faint">
          Expected tokens per round ÷ round cost, under a geometric acceptance model at the current
          draft-cost setting. Higher acceptance both raises the peak and pushes it rightward. At low
          acceptance, large <Code>k</Code> is actively harmful — you can end up slower than plain
          decoding.
        </p>
      </Card>

      <h2>Where the drafts come from</h2>
      <p>
        vLLM V1 does not support using a separate full LLM as the drafter. Instead it implements
        three faster — but less accurate — proposal schemes. Switch the method knob to read about
        each.
      </p>
      <Card className="my-5 p-4">
        <div className="font-mono text-[0.7rem] text-accent-700">{info.title}</div>
        <p className="mt-1.5 text-[0.82rem] leading-relaxed text-ink-dim">{info.detail}</p>
        <div className="mt-2.5 space-y-1 text-[0.78rem]">
          <div style={{ color: C.good }}>+ {info.good}</div>
          <div style={{ color: C.bad }}>− {info.bad}</div>
        </div>
      </Card>

      <CodeBlock
        caption="n-gram needs no draft weights at all, which makes it the cheapest thing to try first."
        code={`speculative_config = {
    "method": "ngram",
    "prompt_lookup_max": 5,
    "prompt_lookup_min": 3,
    "num_speculative_tokens": 3,
}

llm = LLM(
    model="TinyLlama/TinyLlama-1.1B-Chat-v1.0",
    speculative_config=speculative_config,
)
outputs = llm.generate(prompts, sampling_params)`}
      />

      <h2>How it lands in the engine</h2>
      <p>
        The setup happens in the two worker procedures from <StageRef n={2} />:{' '}
        <strong>init device</strong>{' '}
        creates the drafter (e.g. <Code>NgramProposer</Code>) and a <Code>rejection_sampler</Code>{' '}
        (partly written in Triton), and <strong>load model</strong> loads the draft weights — a
        no-op for n-gram. Then per request:
      </p>
      <ol>
        <li>run a normal prefill with the large model;</li>
        <li>
          after sampling, call <Code>propose_draft_token_ids(k)</Code>;
        </li>
        <li>
          store them in <Code>request.spec_token_ids</Code>;
        </li>
        <li>
          on the next step, add <Code>len(spec_token_ids)</Code> to the request's "new tokens" count,
          so that <Code>allocate_slots</Code> reserves enough KV blocks. This is exactly the "not
          always 1" from <StageRef n={4} />;
        </li>
        <li>
          copy the drafts into <Code>input_batch.token_ids_cpu</Code> to form context + draft;
        </li>
        <li>
          build metadata with <Code>_calc_spec_decode_metadata</Code> and run the target forward
          pass over the draft positions;
        </li>
        <li>
          instead of ordinary sampling, run the <Code>rejection_sampler</Code> to produce{' '}
          <Code>output_token_ids</Code>.
        </li>
      </ol>

      <Callout kind="gotcha" title="It helps latency, and can hurt throughput">
        <p>
          Speculation spends spare compute to shorten one request's wall-clock time. Under heavy
          load, though, that compute is not spare. It is busy batching other people's decodes.
        </p>
        <p>
          At high batch sizes the GPU is already compute-bound, as the roofline in{' '}
          <StageRef n={13} /> shows. Verifying drafts that get thrown away then competes with real
          work, and total throughput can fall. Speculative decoding is a latency optimisation for
          lightly loaded or latency-critical serving, not a free win everywhere.
        </p>
        <p>
          Also note the KV cost: <Code>allocate_slots</Code> must reserve blocks for tokens that may
          be rejected, so speculation slightly reduces how many requests fit in memory.
        </p>
      </Callout>

      <Takeaways
        items={[
          'A cheap draft proposes k tokens; one target pass verifies all of them plus one extra. Accept if p_target ≥ p_draft, else accept with probability p_target/p_draft, stopping at the first rejection.',
          'The rule makes the output distribution provably identical to sampling from the target model — a poor draft costs speed, never quality. Rejections resample from normalize(max(0, p_target − p_draft)); a clean sweep grants a free (k+1)th token.',
          'Acceptance compounds geometrically while draft cost is linear in k, so speedup peaks at a finite k that grows with acceptance rate. Too-large k can be slower than no speculation at all.',
          'vLLM V1 offers n-gram (free, great on repetitive text), EAGLE (trained MLP draft, high acceptance), and Medusa (parallel heads). It is a latency win when compute is spare, and can reduce throughput when it is not.',
        ]}
      />
    </StageLayout>
  )
}
