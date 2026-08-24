import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import prefixCache, { BLOCK, PHASE_TEXT } from '../sim/prefixCache'
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
import { BlockGrid, C, reqColor } from '../components/viz'

function PrefixViz({ sim }) {
  const { state, params } = sim
  const r = state.requests[state.ri]
  const saveRate =
    state.totalComputed + state.totalSaved > 0
      ? (state.totalSaved / (state.totalComputed + state.totalSaved)) * 100
      : 0

  const poolBlocks = Object.entries(state.blocks).map(([id, b]) => ({
    state: b.hash ? (b.live ? 'cached' : 'partial') : 'alloc',
    glyph: id,
    refs: b.refs,
    title: `block ${id} — ${b.hash ? `hash ${b.hash}` : 'no hash yet'}, refcount ${b.refs}, ${
      b.live ? 'in use' : 'in free_block_queue (still reclaimable)'
    }`,
  }))

  return (
    <div className="space-y-5">
      <StatRow>
        <StatTile
          label="prefill tokens saved"
          value={state.totalSaved}
          tone={state.totalSaved ? 'good' : 'neutral'}
        />
        <StatTile label="tokens computed" value={state.totalComputed} tone="warn" />
        <StatTile
          label="prefill avoided"
          value={saveRate.toFixed(0)}
          unit="%"
          tone={saveRate > 50 ? 'good' : saveRate > 20 ? 'warn' : 'neutral'}
        />
        <StatTile
          label="blocks in cache map"
          value={Object.keys(state.cache).length}
          tone="accent"
        />
      </StatRow>

      {/* current phase */}
      <div className="rounded-lg border border-accent bg-accent/[0.06] px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[0.62rem] tracking-widest text-accent-700 uppercase">
            {state.phase === 'finished' ? 'done' : state.phase}
          </span>
          {r && (
            <span className="font-mono text-[0.75rem]" style={{ color: reqColor(r.idx) }}>
              {r.id}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[0.82rem] leading-relaxed text-ink-dim">
          {PHASE_TEXT[state.phase] ?? 'All requests have been served.'}
        </p>
      </div>

      {/* the current request's block hashes */}
      {r && r.blockHashes.length > 0 && (
        <div>
          <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
            {r.id} · block hashes (chained)
          </div>
          <div className="scroll-x flex gap-1.5">
            {r.blockHashes.map((bh, i) => {
              const isHit = i < r.hits
              const inCache = bh.hash && bh.hash in state.cache
              return (
                <div
                  key={i}
                  className="flex min-w-20 flex-col items-center rounded-md border px-2 py-1.5"
                  style={{
                    borderColor: isHit ? C.cached : bh.partial ? C.partial : C.edge,
                    background: isHit ? 'rgba(93,219,164,0.12)' : 'transparent',
                  }}
                  title={
                    bh.partial
                      ? `partial block — only ${bh.tokens.length}/${BLOCK} tokens, cannot be hashed or cached`
                      : `block ${i} · hash ${bh.hash} · ${inCache ? 'present in cache map' : 'not in cache map'}`
                  }
                >
                  <span className="font-mono text-[0.55rem] text-ink-faint">
                    blk {i} · {bh.tokens.length}tok
                  </span>
                  <span
                    className="font-mono text-[0.68rem]"
                    style={{ color: bh.partial ? C.partial : isHit ? C.cached : C.dim }}
                  >
                    {bh.partial ? 'no hash' : bh.hash}
                  </span>
                  <span
                    className="font-mono text-[0.55rem]"
                    style={{ color: isHit ? C.cached : C.faint }}
                  >
                    {bh.partial ? 'uncacheable' : isHit ? '✓ HIT' : 'miss'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* physical pool */}
      {poolBlocks.length > 0 && (
        <div>
          <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
            physical blocks · badge = refcount
          </div>
          <BlockGrid blocks={poolBlocks} cols={12} size={28} />
        </div>
      )}

      {/* per-request ledger */}
      <div>
        <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
          per-request prefill cost
        </div>
        <div className="space-y-1">
          {state.requests.map((q) => {
            const total = params.prefixTokens + params.suffixTokens
            const pctSaved = (q.savedTokens / total) * 100
            return (
              <div key={q.id} className="flex items-center gap-2 font-mono text-[0.65rem]">
                <span className="w-7" style={{ color: reqColor(q.idx) }}>
                  {q.id}
                </span>
                <div className="flex h-4 flex-1 overflow-hidden rounded-sm bg-edge">
                  <div
                    style={{ width: `${pctSaved}%`, background: C.cached }}
                    title={`${q.savedTokens} tokens reused from cache`}
                  />
                  <div
                    style={{
                      width: `${(q.computedTokens / total) * 100}%`,
                      background: C.prefill,
                    }}
                    title={`${q.computedTokens} tokens computed`}
                  />
                </div>
                <span className="w-28 text-right text-[0.6rem] text-ink-faint tabular-nums">
                  {q.status === 'pending'
                    ? 'not started'
                    : `${q.computedTokens} computed · ${q.savedTokens} reused`}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <p className="rounded-md bg-neutral-200 px-3 py-2 font-mono text-[0.7rem] leading-relaxed text-ink-dim">
        <span className="text-accent-700">tick {state.tick}:</span> {state.note}
      </p>
    </div>
  )
}

export default function PrefixCaching() {
  const sim = useSimulation(prefixCache)

  return (
    <StageLayout
      slug="prefix-caching"
      sim={sim}
      simTitle="Two requests sharing a prefix"
      simSubtitle="Each request walks the full lifecycle one phase per tick. Requests share the leading prefix and differ afterwards — exactly the blog's long_prefix example."
      legend={[
        { label: 'cache hit / reclaimed', color: C.cached },
        { label: 'computed this request', color: C.prefill },
        { label: 'freed but still reclaimable', color: C.partial },
        { label: 'allocated, no hash yet', color: C.alloc },
      ]}
      simFooter={
        <>
          Watch <Code>R0</Code> get zero hits and pay full price, then <Code>R1</Code> and{' '}
          <Code>R2</Code> reclaim its blocks for free. Then nudge the shared prefix off a
          multiple of {BLOCK} — say 64 to 72. The trailing partial block turns yellow and stays
          uncacheable forever, so those tokens get recomputed on every single request.
        </>
      }
      panel={<PrefixViz sim={sim} />}
    >
      <p>
        Real traffic repeats itself. A system prompt, a few-shot preamble, a document that every
        question is asked about — the same leading tokens keep arriving. Computing their KV again
        every time is pure waste.
      </p>
      <p>
        And the machinery to avoid it already exists. <StageRef n={3} title /> gave every sequence
        a list of fixed-size blocks. A block filled with the same tokens holds the same KV, so the
        only missing piece is a way to recognise one.
      </p>

      <h2>Blocks get identities</h2>
      <p>
        Every <em>complete</em> block of {BLOCK} tokens gets a hash. Three things go into it: the
        previous block's hash, this block's token ids, and some optional metadata.
      </p>
      <p>
        Including the previous hash is the trick that makes this a <em>prefix</em> cache. A block's
        identity depends on everything before it, so matching block 3 is only possible if blocks 0,
        1 and 2 matched too. You can never accidentally reuse a block whose history was different.
      </p>
      <p>
        Each result is stored as a <Code>BlockHash</Code>, holding the hash and its token ids, and
        the list is kept in <Code>req_to_block_hashes[request_id]</Code>.
      </p>

      <Callout kind="note" title="What else goes into the hash">
        <p>
          The optional metadata includes the multimodal hash, the LoRA id, and a{' '}
          <strong>cache salt</strong>. The salt is mixed into the first block's hash, so only
          requests carrying the same salt can match those blocks. That is how one shared cache gives
          separate tenants isolation from each other.
        </p>
      </Callout>

      <h2>The lookup</h2>
      <p>
        While scheduling a request, <Code>kv_cache_manager.get_computed_blocks</Code> hashes the
        prompt with <Code>hash_request_tokens</Code>, then hands the hashes to{' '}
        <Code>find_longest_cache_hit</Code>.
      </p>
      <p>
        That walks the list against <Code>cached_block_hash_to_block</Code> — the map from hash to
        physical block — and stops at the first miss. Everything up to that point is already
        computed, so <Code>allocate_slots</Code> never has to find fresh blocks for it.
      </p>

      <BlogFigure src="prefix_pt1.png" caption="First request: hashes computed, no hits found" />
      <BlogFigure src="prefix_pt2.png" caption="Blocks allocated and registered in the cache map" />
      <BlogFigure src="prefix_pt3.png" caption="Second request: all prefix blocks hit and reused" />

      <h2>Watch it happen</h2>
      <p>
        The panel sends three requests that share a 64-token prefix and differ in the last 12
        tokens. Run it with <Code>Prefix caching</Code> on <Code>on</Code>.
      </p>
      <p>
        <Code>R0</Code> arrives cold. It gets no hits and computes all 76 of its tokens.{' '}
        <Code>R1</Code> and <Code>R2</Code> each hit 4 blocks and compute only 12 tokens — their own
        suffix. Across the three requests, 100 tokens are computed and 128 are skipped.
      </p>
      <p>
        Switch <Code>Prefix caching</Code> to <Code>off</Code> and the total computed goes to 228,
        with nothing saved. Same answers, more than twice the prefill work.
      </p>

      <h2>Why freed blocks are still useful</h2>
      <p>
        This is the subtle part, and it is where the FIFO free queue pays off. When a request
        finishes, its blocks go back to <Code>free_block_queue</Code> and their{' '}
        <strong>refcount</strong> — the number of requests currently using that block — drops to
        zero.
      </p>
      <p>
        But they keep their hash, they keep their entry in the cache map, and they still physically
        contain the KV. So when a later request's hashes match, the engine pulls those same blocks
        back out of the free queue. A refcount of zero means reusable, not invalid.
      </p>
      <p>
        Had the first request still been running, the refcount would have gone up to 2 instead. Then
        neither request could free the blocks out from under the other.
      </p>

      <Callout kind="key" title="When a cached block actually dies">
        <p>
          A block is only invalidated at the moment it is about to be handed to somebody else. The
          free queue takes blocks from the front and pushes freed ones to the back, so the block
          reused next is always the one freed longest ago.
        </p>
        <p>
          That is least-recently-used eviction — the oldest thing goes first — and nobody had to
          write it. It falls out of the queue's ordering.
        </p>
        <p>
          The invalidation itself happens on the way out. If a popped block still carries a hash in{' '}
          <Code>cached_block_hash_to_block</Code>, the engine clears the hash and deletes the map
          entry right then. It can never be handed out for the old prefix again.
        </p>
      </Callout>

      <CodeBlock
        caption="The blog's example: the same long_prefix on two separate generate calls. The second one pays only for its own suffix."
        code={`long_prefix = "<a piece of text longer than block_size tokens>"

prompts = [
    "Hello, my name is",
    "The president of the United States is",
]

llm = LLM(model="TinyLlama/TinyLlama-1.1B-Chat-v1.0")

outputs = llm.generate(long_prefix + prompts[0], sampling_params)  # cold
outputs = llm.generate(long_prefix + prompts[1], sampling_params)  # warm`}
      />

      <h2>Two real limits</h2>
      <p>
        <strong>It only helps prefill.</strong> Decode still has to run one token at a time. Prefix
        caching removes recomputation, never generation.
      </p>
      <p>
        <strong>Alignment matters, and the panel will show you.</strong> Only whole blocks can be
        cached, so a shared prefix of length <Code>L</Code> leaves <Code>L % {BLOCK}</Code> tokens
        stranded in a partial block that has to be recomputed every single time.
      </p>
      <p>
        Try it. Move <Code>Shared prefix</Code> from 64 up to 72. The 8 extra shared tokens buy
        nothing: the hits stay at 4 blocks, and every later request now computes 20 tokens instead
        of 12. Total work rises from 100 tokens to 124.
      </p>
      <p>
        For a long document that rounding is noise. For a 20-token system prompt it is most of the
        prompt. Prefix caching is on by default; turn it off with{' '}
        <Code>enable_prefix_caching=False</Code>.
      </p>

      <Takeaways
        items={[
          'Complete blocks get a chained hash: previous hash, token ids, metadata. A hit on block n therefore guarantees every earlier block matched, which is what makes it a prefix cache.',
          'Freed blocks keep their hash, their cache-map entry and their contents. A refcount of 0 means reclaimable, not invalid; invalidation happens only when a block is popped to be reused.',
          'Cache eviction is least-recently-used for free, because free_block_queue takes from the front and returns freed blocks to the back.',
          'It speeds up prefill only, and only for whole blocks. A prefix that is not a multiple of block_size leaves a remainder that is recomputed on every request.',
        ]}
      />
    </StageLayout>
  )
}
