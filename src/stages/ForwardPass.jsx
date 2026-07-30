import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import forward, { PHASE_INFO, phaseOf, revealed } from '../sim/forward'
import sampling, { processLogits, VOCAB } from '../sim/sampling'
import {
  BlogFigure,
  Callout,
  Code,
  CodeBlock,
  SimFrame,
  StatRow,
  StatTile,
  Takeaways,
} from '../components/ui'
import { C, DistChart, reqColor, reqInk, TokenStrip } from '../components/viz'

/* ------------------------------------------------------- flattening simulator */

function ForwardViz({ sim }) {
  const { state, params } = sim
  const { batch } = state
  const phase = phaseOf(state)
  const info = PHASE_INFO[phase]
  const n = revealed(state)
  const shown = batch.flat.slice(0, n)
  const gathering = phase === 'gather' || phase === 'sample'

  return (
    <div className="space-y-5">
      <div className="border-l-4 border-accent bg-accent-100 px-4 py-3">
        <div className="font-mono text-[10px] tracking-[0.14em] text-accent-700 uppercase">
          {info.label}
        </div>
        <p className="mt-1 text-[0.82rem] leading-relaxed text-ink-dim">{info.detail}</p>
      </div>

      {/* the scheduled requests and their block tables */}
      <div>
        <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
          scheduled requests · block tables
        </div>
        <div className="space-y-1">
          {batch.requests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 font-mono text-[0.68rem]">
              <span className="w-7" style={{ color: reqColor(r.idx) }}>
                {r.id}
              </span>
              <span
                className="w-14 rounded px-1 text-center text-[0.6rem]"
                style={{
                  background: r.kind === 'prefill' ? C.prefill : C.decode,
                  color: C.bg,
                }}
              >
                {r.kind}
              </span>
              <span className="w-28 text-[0.62rem] text-ink-faint tabular-nums">
                ctx {r.ctxLen} · +{r.newTokens} new
              </span>
              <span className="text-ink-dim">
                [{r.blocks.map((b) => b).join(', ')}]
                <span className="ml-1.5 text-[0.6rem] text-ink-faint">
                  ← logical block {'→'} physical
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* the flattened super-sequence */}
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
            flattened batch · one tensor of {batch.totalTokens} tokens
          </span>
          <span className="font-mono text-[0.6rem] text-ink-faint tabular-nums">
            {n}/{batch.flat.length} built
          </span>
        </div>
        <div className="scroll-x border border-edge bg-neutral-100 p-3">
          <div className="min-w-max space-y-1.5">
            {[
              { name: 'input_ids', get: (f) => f.reqId, mono: true },
              { name: 'positions', get: (f) => f.pos },
              { name: 'slot_mapping', get: (f) => f.slot },
            ].map((row) => (
              <div key={row.name} className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-right font-mono text-[0.6rem] text-ink-faint">
                  {row.name}
                </span>
                <div className="flex gap-[3px]">
                  {batch.flat.map((f, i) => {
                    const on = i < n
                    const isGathered = gathering && f.isLast
                    return (
                      <div
                        key={i}
                        title={
                          on
                            ? `${f.reqId} · pos ${f.pos} · logical block ${f.logicalBlock} → physical ${f.physical} · offset ${f.offset} · slot ${f.slot}`
                            : 'not built yet'
                        }
                        className="flex h-6 min-w-8 items-center justify-center font-mono text-[0.58rem] transition-all duration-200"
                        style={{
                          background: on
                            ? reqColor(f.reqIdx, { light: row.name !== 'input_ids' })
                            : C.free,
                          // the light variant is a pale fill and needs ink, not ground
                          color: on
                            ? reqInk(f.reqIdx, { light: row.name !== 'input_ids' })
                            : 'transparent',
                          outline: isGathered ? `1.5px solid var(--color-accent)` : undefined,
                          outlineOffset: 1,
                          opacity: on ? (gathering && !f.isLast ? 0.4 : 1) : 0.35,
                        }}
                      >
                        {on ? row.get(f) : '·'}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            {/* sequence boundaries */}
            <div className="flex items-center gap-2 pt-0.5">
              <span className="w-24 shrink-0 text-right font-mono text-[0.6rem] text-ink-faint">
                cu_seqlens
              </span>
              <div className="flex gap-[3px]">
                {batch.flat.map((f, i) => (
                  <span
                    key={i}
                    className="min-w-8 text-center font-mono text-[0.55rem]"
                    style={{ color: batch.starts.includes(i) ? C.dim : 'transparent' }}
                  >
                    {batch.starts.includes(i) ? '▲' : '·'}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* the slot arithmetic for the token just placed */}
      {phase === 'build' && n > 0 && (
        <div className="rounded-md bg-neutral-200 px-3 py-2.5 font-mono text-[0.7rem] leading-relaxed">
          {(() => {
            const f = batch.flat[n - 1]
            return (
              <>
                <div className="text-ink-faint">
                  just placed: <span style={{ color: reqColor(f.reqIdx) }}>{f.reqId}</span> token at
                  position {f.pos}
                </div>
                <div className="mt-1 text-ink-dim">
                  slot = block_table[{f.pos} // {params.blockSize}] × {params.blockSize} + ({f.pos}{' '}
                  % {params.blockSize})
                </div>
                <div className="text-ink-dim">
                  {'     '}= block_table[{f.logicalBlock}] × {params.blockSize} + {f.offset} ={' '}
                  {f.physical} × {params.blockSize} + {f.offset} ={' '}
                  <span className="text-accent-700">{f.slot}</span>
                </div>
              </>
            )
          })()}
        </div>
      )}

      {gathering && (
        <StatRow>
          <StatTile label="rows in tensor" value={batch.totalTokens} />
          <StatTile label="logits rows gathered" value={batch.gatherRows.length} tone="accent" />
          <StatTile label="tokens sampled" value={batch.requests.length} tone="good" />
          <StatTile
            label="padding rows"
            value={0}
            tone="good"
            hint="There is no padding — that is the entire point of the flat layout"
          />
        </StatRow>
      )}
    </div>
  )
}

/* --------------------------------------------------------- sampling simulator */

function SamplingViz({ sim }) {
  const { state, params } = sim
  const processed = processLogits(params)
  const totalDraws = state.tick || 1
  const survivors = processed.filter((x) => x.kept).length

  return (
    <div className="space-y-5">
      <StatRow>
        <StatTile label="tokens survivable" value={`${survivors}/${VOCAB.length}`} tone="accent" />
        <StatTile
          label="top token mass"
          value={(Math.max(...processed.map((x) => x.prob)) * 100).toFixed(0)}
          unit="%"
        />
        <StatTile label="draws" value={state.tick} />
        <StatTile
          label="last drawn"
          value={state.last === null ? '—' : VOCAB[state.last].tok}
          tone="good"
        />
      </StatRow>

      <div>
        <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
          probability after temperature → top_k → top_p → renormalize
        </div>
        <DistChart
          height={130}
          showValues
          bars={processed.map((x, i) => ({
            label: x.tok,
            value: x.prob,
            color: state.last === i ? C.good : x.kept ? C.decode : C.free,
            muted: !x.kept,
          }))}
        />
      </div>

      <div>
        <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
          what was actually drawn ({state.tick} sample{state.tick === 1 ? '' : 's'})
        </div>
        <DistChart
          height={100}
          bars={processed.map((x, i) => ({
            label: x.tok,
            value: state.counts[i] / totalDraws,
            color: C.alloc,
            muted: !x.kept,
          }))}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {processed
          .filter((x) => !x.kept && x.reason)
          .map((x) => (
            <span
              key={x.tok}
              className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[0.6rem] text-ink-faint border border-edge"
            >
              {x.tok}: {x.reason}
            </span>
          ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the stage */

export default function ForwardPass() {
  const flat = useSimulation(forward)
  const samp = useSimulation(sampling)

  return (
    <StageLayout
      slug="forward-pass"
      sim={flat}
      simTitle="Batch flattening & slot_mapping"
      simSubtitle="Colour identifies the owning request. Set block_size to 4 to make the slot arithmetic easy to follow; ▲ marks a sequence boundary in cu_seqlens."
      panel={<ForwardViz sim={flat} />}
      legend={[
        { label: 'prefill request', color: C.prefill },
        { label: 'decode request', color: C.decode },
        { label: 'not yet built', color: C.free },
      ]}
      simFooter={
        <>
          Watch the <Code>slot_mapping</Code> row: consecutive positions inside one request jump to
          unrelated slot numbers whenever they cross a block boundary, because the next logical
          block lives somewhere else physically. The kernel resolves that indirection itself — which
          is what "paged attention" names.
        </>
      }
    >
      <p>
        The scheduler has decided who runs. Now the model executor's <Code>execute_model</Code>{' '}
        delegates to the <Code>Worker</Code>, which delegates to the model runner — and five things
        happen.
      </p>

      <ol>
        <li>
          <strong>Update states</strong> — prune finished requests from <Code>input_batch</Code>;
          refresh forward-pass metadata, above all each request's KV-cache block list.
        </li>
        <li>
          <strong>Prepare inputs</strong> — copy buffers CPU→GPU, compute positions, build{' '}
          <Code>slot_mapping</Code>, construct the attention metadata.
        </li>
        <li>
          <strong>Forward pass</strong> — run the model with paged-attention kernels over one
          flattened super-sequence.
        </li>
        <li>
          <strong>Gather last-token states</strong> — pull the hidden state at each sequence's final
          position and compute logits.
        </li>
        <li>
          <strong>Sample</strong> — one token per sequence, per its own sampling config.
        </li>
      </ol>

      <h2>One flat tensor, no padding</h2>
      <p>
        This is the mechanical trick that makes continuous batching possible. Rather than stacking
        sequences into a padded rectangle, every scheduled request's new tokens are{' '}
        <strong>concatenated into a single long sequence</strong>. A prefill contributes as many
        rows as its prompt is long; a decode contributes exactly one. Position indices and the
        attention metadata guarantee each sequence attends only to its own tokens.
      </p>
      <p>
        Because there is no rectangle, there is nothing to keep intact between steps — the batch can
        have a completely different composition every step, at zero cost. Step the panel on the
        right to watch the arrays get built one token at a time.
      </p>

      <BlogFigure
        src="fwd_pass.png"
        caption="Continuous batching and paged attention in one forward pass"
      />

      <Callout kind="key" title="One row in, one token out — regardless of size">
        <p>
          Only the last position of a sequence can predict its next token, so however many rows a
          request contributed, exactly one logits row is gathered for it. A 2000-token prefill and a
          1-token decode both yield precisely one new token from the step. That asymmetry is why
          prefill is the expensive part of a request's life and decode is the long part.
        </p>
      </Callout>

      <h2>Eager vs captured</h2>
      <p>
        The forward pass itself runs in one of two modes. <strong>Eager mode</strong> is a standard
        PyTorch forward pass. <strong>Captured mode</strong> replays a <strong>CUDA graph</strong>{' '}
        recorded at startup for a set of warmup batch sizes — the whole sequence of GPU work
        pre-baked into a DAG so it can be launched as one unit.
      </p>
      <p>
        The win is not arithmetic; it's launch overhead. A decode step does very little work per
        kernel, so the CPU-side cost of launching hundreds of kernels can rival the GPU time itself.
        Replaying a graph collapses that. Pass <Code>--enforce-eager</Code> to skip capture: startup
        gets faster and more VRAM stays free, at the cost of per-step latency.
      </p>

      <h2>Sampling</h2>
      <p>
        Finally, logits become a token. The knobs compose in a fixed order — temperature reshapes
        the distribution, then <Code>top_k</Code> and <Code>top_p</Code> delete part of it, then
        what's left is renormalized and drawn from.
      </p>

      <SimFrame
        sim={samp}
        title="Sampling explorer"
        subtitle='A plausible next-token distribution for "The capital of France is". Each tick draws one token; the lower chart is the empirical histogram of those draws.'
        legend={[
          { label: 'survives the filters', color: C.decode },
          { label: 'masked out', color: C.free },
          { label: 'just drawn', color: C.good },
          { label: 'observed frequency', color: C.alloc },
        ]}
        footer={
          <>
            Things worth noticing: <Code>temperature</Code> below ~0.4 makes the distribution nearly
            a point mass, so sampling and greedy converge. <Code>top_p</Code> adapts to the shape of
            the distribution — it keeps one token here and many on a flatter distribution — whereas{' '}
            <Code>top_k</Code> keeps a fixed count regardless. And note that filtering happens{' '}
            <em>after</em> temperature, so raising temperature widens what top_p admits.
          </>
        }
      >
        <SamplingViz sim={samp} />
      </SimFrame>

      <CodeBlock
        lang="text"
        caption="Why the flat layout costs nothing: the kernel is given the boundaries explicitly, so it never needs the batch to be rectangular."
        code={`# a batch of 2 prefills (5 and 3 tokens) + 3 decodes
input_ids     [P0 P0 P0 P0 P0 P1 P1 P1 D0 D1 D2]   # 11 rows, 0 padding
positions     [ 0  1  2  3  4  0  1  2  9 17  6]   # each sequence's own offsets
cu_seqlens    [ 0              5        8  9 10 11]  # where each sequence starts
gather rows   [            4        7     8  9 10]  # one logits row per request`}
      />

      <Takeaways
        items={[
          'The batch is one flat concatenated tensor with no padding. Position indices and attention metadata keep sequences from seeing each other, so batch composition can change freely every step.',
          'slot_mapping = block_table[pos // block_size] * block_size + pos % block_size. That single line connects a logical token position to a physical KV slot, and is the whole of paged attention at the kernel boundary.',
          'Exactly one logits row is gathered per request no matter how many rows it contributed — so a step yields one token per sequence whether it prefilled 2000 tokens or decoded 1.',
          'CUDA graphs cut kernel-launch overhead, which matters most for decode steps where per-kernel work is tiny. --enforce-eager trades that latency back for faster startup and more free VRAM.',
        ]}
      />
    </StageLayout>
  )
}
