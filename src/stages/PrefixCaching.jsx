import { useSimulation } from '../hooks/useSimulation'
import prefixCache, { BLOCK, PHASE_TEXT } from '../sim/prefixCache'
import {
  BlogFigure,
  Callout,
  Code,
  CodeBlock,
  SimFrame,
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
        <StatTile label="blocks in cache map" value={Object.keys(state.cache).length} tone="accent" />
      </div>

      {/* current phase */}
      <div className="rounded-lg border border-accent-dim/40 bg-accent/[0.06] px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[0.62rem] tracking-widest text-accent uppercase">
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
          <div className="mb-2 font-mono text-[0.62rem] tracking-widest text-ink-faint uppercase">
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
                  <span className="font-mono text-[0.55rem]" style={{ color: isHit ? C.cached : C.faint }}>
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
          <div className="mb-2 font-mono text-[0.62rem] tracking-widest text-ink-faint uppercase">
            physical blocks · badge = refcount
          </div>
          <BlockGrid blocks={poolBlocks} cols={12} size={28} />
        </div>
      )}

      {/* per-request ledger */}
      <div>
        <div className="mb-2 font-mono text-[0.62rem] tracking-widest text-ink-faint uppercase">
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

      <p className="rounded-md bg-panel-2/50 px-3 py-2 font-mono text-[0.7rem] leading-relaxed text-ink-dim">
        <span className="text-accent">tick {state.tick}:</span> {state.note}
      </p>
    </div>
  )
}

export default function PrefixCaching() {
  const sim = useSimulation(prefixCache)

  return (
    <>
      <p>
        Real traffic repeats itself. A system prompt, a few-shot preamble, a document every question
        is asked about — the same leading tokens arrive over and over. Recomputing their KV every
        time is pure waste, and the block structure from stage 03 already gives us everything needed
        to avoid it.
      </p>

      <h3>Blocks get identities</h3>
      <p>
        Every <em>complete</em> block of {BLOCK} tokens is given a hash combining{' '}
        <strong>the previous block's hash</strong>, the current block's token ids, and optional
        metadata. Because the hash is chained, matching block 3 is only meaningful if blocks 0–2
        matched as well — which is precisely what "shared <em>prefix</em>" means. Each result is
        stored as a <Code>BlockHash</Code> holding both the hash and its token ids, and the list
        lands in <Code>req_to_block_hashes[request_id]</Code>.
      </p>

      <Callout kind="note" title="What else goes into the hash">
        <p>
          Optional metadata folded into the hash includes the multimodal hash, the LoRA id, and a{' '}
          <strong>cache salt</strong> — injected into the first block's hash so that only requests
          carrying the same salt can reuse those blocks. That is how you get tenant isolation out of
          a shared cache.
        </p>
      </Callout>

      <h3>The lookup</h3>
      <p>
        During scheduling, <Code>kv_cache_manager.get_computed_blocks</Code> calls{' '}
        <Code>hash_request_tokens</Code> and then <Code>find_longest_cache_hit</Code>, which checks
        those hashes against <Code>cached_block_hash_to_block</Code> and stops at the first miss.
        Whatever was hit doesn't need <Code>allocate_slots</Code> to find fresh blocks — those blocks
        already hold valid KV.
      </p>

      <SimFrame
        sim={sim}
        keys
        title="Two requests sharing a prefix"
        subtitle="Each request walks the full lifecycle one phase per tick. Requests share the leading prefix and differ afterwards — exactly the blog's long_prefix example."
        legend={[
          { label: 'cache hit / reclaimed', color: C.cached },
          { label: 'computed this request', color: C.prefill },
          { label: 'freed but still reclaimable', color: C.partial },
          { label: 'allocated, no hash yet', color: C.alloc },
        ]}
        footer={
          <>
            Watch <Code>R0</Code> get zero hits and pay full price, then <Code>R1</Code> and{' '}
            <Code>R2</Code> reclaim its blocks for free. Then set the shared prefix to a value that
            isn't a multiple of {BLOCK} — the trailing partial block turns yellow and stays
            uncacheable forever, so those tokens are recomputed on every single request.
          </>
        }
      >
        <PrefixViz sim={sim} />
      </SimFrame>

      <BlogFigure src="prefix_pt1.png" caption="First request: hashes computed, no hits found" />
      <BlogFigure src="prefix_pt2.png" caption="Blocks allocated and registered in the cache map" />
      <BlogFigure src="prefix_pt3.png" caption="Second request: all prefix blocks hit and reused" />

      <h3>Why freed blocks are still useful</h3>
      <p>
        This is the subtle and clever part. When the first request finishes, its blocks go back to{' '}
        <Code>free_block_queue</Code> and their refcount drops to zero — but they{' '}
        <strong>keep their hash and their entry in the cache map</strong>, and they still physically
        contain the KV. So when the second request's hashes match, the engine simply pulls them out
        of the free queue again. Refcount zero means "reusable", not "invalid".
      </p>
      <p>
        If the first request were still alive, the refcount would increment instead (to 2), and
        neither request could free the blocks out from under the other.
      </p>

      <Callout kind="key" title="When a cached block actually dies">
        <p>
          A block is only invalidated at the moment it is about to be <em>reallocated</em>. Because{' '}
          <Code>free_block_queue</Code> pops from the left and pushes freed blocks to the right,
          blocks are reused in roughly least-recently-freed order — an LRU eviction policy that
          nobody had to write. When a popped block turns out to still carry a hash present in{' '}
          <Code>cached_block_hash_to_block</Code>, the engine clears the hash and removes the map
          entry at that point, so it can never be handed out for the old prefix again.
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

      <Callout kind="gotcha" title="Two real limits">
        <p>
          <strong>It only helps prefill.</strong> Decode still has to run token by token; prefix
          caching removes recomputation, not generation.
        </p>
        <p>
          <strong>Alignment matters.</strong> Only complete blocks are cacheable, so a shared prefix
          of length <Code>L</Code> leaves <Code>L % {BLOCK}</Code> tokens to be recomputed every
          time. For a long prefix that rounding is negligible; for a 20-token system prompt it is
          most of it.
        </p>
        <p>
          Prefix caching is enabled by default; disable it with{' '}
          <Code>enable_prefix_caching=False</Code>.
        </p>
      </Callout>

      <Takeaways
        items={[
          'Complete blocks get a chained hash (previous hash + token ids + metadata), so a hit on block n implies every earlier block matched too. find_longest_cache_hit walks that chain and stops at the first miss.',
          'Freed blocks retain their hash, their cache-map entry, and their KV contents — refcount 0 means reclaimable, not invalid. Invalidation happens only when a block is popped for reallocation.',
          'Because free_block_queue pops from the left and pushes freed blocks to the right, cache eviction is LRU as a side effect of the data structure.',
          'It accelerates prefill only, and only for whole blocks — a prefix that is not a multiple of block_size always leaves a remainder to recompute.',
        ]}
      />
    </>
  )
}
