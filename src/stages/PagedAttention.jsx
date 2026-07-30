import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import kvcache, { memoryBreakdown } from '../sim/kvcache'
import {
  BlogFigure,
  Callout,
  Code,
  CodeBlock,
  StatRow,
  StatTile,
  Takeaways,
} from '../components/ui'
import { BlockGrid, C, MeterBar, reqColor } from '../components/viz'

function KvViz({ sim }) {
  const { state, params } = sim
  const m = memoryBreakdown(state, params)
  const byId = Object.fromEntries(state.requests.map((r) => [r.id, r]))

  const blocks = state.blocks.map((b, i) => {
    if (b.owner === null) return { state: 'free', title: `block ${i} — free` }
    const r = byId[b.owner]
    const full = b.filled >= params.blockSize
    return {
      state: 'alloc',
      color: reqColor(r?.idx ?? 0, { light: !full }),
      glyph: b.filled > 0 ? String(b.filled) : '·',
      title: `block ${i} — ${b.owner}, ${b.filled}/${params.blockSize} tokens${full ? '' : ' (partially filled)'}`,
    }
  })

  return (
    <div className="space-y-5">
      <StatRow>
        <StatTile
          label="slot efficiency"
          value={m.efficiency.toFixed(0)}
          unit="%"
          tone={m.efficiency > 80 ? 'good' : m.efficiency > 50 ? 'warn' : 'bad'}
          hint="Tokens actually stored ÷ token capacity held by live requests"
        />
        <StatTile label="reserved, unused" value={m.wastedSlots} unit=" tok" tone="bad" />
        <StatTile label="peak concurrent" value={state.peakConcurrent} tone="accent" />
        <StatTile
          label="largest free run"
          value={m.largestFreeRun}
          unit=" blk"
          hint="Only matters to a contiguous allocator — a paged one never needs adjacency"
        />
      </StatRow>

      {/* physical block pool */}
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
            physical KV blocks · {params.blockSize} tokens each
          </span>
          <span className="font-mono text-[10px] text-neutral-600 tabular-nums">
            {m.freeBlocks} free / {state.blocks.length}
          </span>
        </div>
        <BlockGrid blocks={blocks} cols={16} size={26} />
      </div>

      <MeterBar
        label="free_block_queue"
        value={state.freeQueue.length}
        max={params.numBlocks}
        color={C.alloc}
        sublabel={`${state.freeQueue.length} block(s) queued · next out: ${
          state.freeQueue.length ? `#${state.freeQueue[0]}` : '—'
        }`}
      />

      {/* per-request logical → physical block table */}
      <div>
        <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
          req_to_blocks — the block table
        </div>
        <div className="space-y-1">
          {state.requests.map((r) => (
            <div key={r.id} className="flex items-center gap-2 font-mono text-[0.68rem]">
              <span
                className="w-8 shrink-0"
                style={{
                  color:
                    r.status === 'running'
                      ? reqColor(r.idx)
                      : r.status === 'done'
                        ? C.faint
                        : C.dim,
                }}
              >
                {r.id}
              </span>
              <span className="w-24 shrink-0 text-[0.62rem] text-neutral-600 tabular-nums">
                {r.status === 'done'
                  ? `done · ${r.generated} tok`
                  : r.status === 'waiting'
                    ? `waiting · p${r.promptLen}`
                    : `${r.tokens} tok / cap ${r.blocks.length * params.blockSize}`}
              </span>
              <span className="scroll-x flex-1 whitespace-nowrap text-ink-dim">
                {r.blocks.length ? (
                  r.blocks.map((b) => `#${b}`).join(' → ')
                ) : (
                  <span className="text-neutral-500">{r.status === 'done' ? 'released' : '—'}</span>
                )}
              </span>
              {r.stalled && <span style={{ color: C.bad }}>⚠ stalled</span>}
            </div>
          ))}
        </div>
      </div>

      <p className="bg-neutral-200 px-3 py-2 font-mono text-[0.7rem] leading-relaxed text-ink-dim">
        <span className="text-accent-700">tick {state.tick}:</span> {state.note}
        {state.blockedByFragmentation > 0 && (
          <span style={{ color: C.bad }}>
            {' '}
            · {state.blockedByFragmentation} admission(s) blocked by fragmentation
          </span>
        )}
      </p>
    </div>
  )
}

export default function PagedAttention() {
  const sim = useSimulation(kvcache)

  return (
    <StageLayout
      slug="paged-attention"
      sim={sim}
      simTitle="The block allocator"
      simSubtitle="Numbers inside blocks are how many token slots are filled. Colour identifies the owning request; a lighter shade means the block is not yet full. Run it once in each allocator mode."
      panel={<KvViz sim={sim} />}
      legend={[
        { label: 'free', color: C.free },
        { label: 'owned (full)', color: reqColor(0) },
        { label: 'owned (partially filled)', color: reqColor(0, { light: true }) },
      ]}
      simFooter={
        <>
          In <Code>paged</Code> mode watch a request's block table grow non-contiguously —{' '}
          <Code>#3 → #17 → #4</Code> is perfectly normal, and the attention kernel doesn't care. In{' '}
          <Code>contiguous</Code> mode every request grabs one solid run up front and holds it
          regardless of what it ends up using.
        </>
      }
    >
      <p>
        A decoding sequence needs every key and value vector it has computed so far. Keeping them is
        the KV cache, and it is the resource that decides how many requests you can serve at once.
        The question is how to lay it out in VRAM.
      </p>

      <h2>The obvious layout, and why it fails</h2>
      <p>
        The straightforward answer is one contiguous buffer per sequence. But you don't know how
        long a sequence will get, so you must reserve for the worst case —{' '}
        <Code>prompt_len + max_tokens</Code>. A request that asks for up to 512 tokens and stops
        after 30 has been squatting on 482 tokens' worth of VRAM the whole time. Worse, because the
        reservation must be <em>adjacent</em>, you end up with free blocks scattered in gaps too
        small to admit anybody, while the total free memory looks plentiful.
      </p>
      <p>
        Flip the panel on the right to <Code>contiguous</Code> and watch three numbers rot: slot
        efficiency, peak concurrency, and the fragmentation-blocked counter.
      </p>

      <h2>Paging it instead</h2>
      <p>
        PagedAttention borrows the trick operating systems use for RAM. The KV cache is carved into
        fixed-size <strong>blocks</strong> — <Code>block_size</Code> defaults to 16 tokens — and a
        sequence gets a <em>block table</em> mapping its logical positions to whatever physical
        blocks happen to be free. Adjacency stops mattering entirely, so external fragmentation
        disappears. Blocks are handed out on demand as a sequence grows, so reservation waste
        disappears too. The only waste left is the tail of the last, partially-filled block: at most{' '}
        <Code>block_size - 1</Code> token slots per sequence.
      </p>

      <BlogFigure
        src="kv_cache_blocks.png"
        caption="A request's list of KV-cache blocks"
        max={560}
      />

      <h2>How allocation actually happens</h2>
      <p>
        The scheduler calls <Code>allocate_slots</Code>, which does three things:
      </p>
      <ol>
        <li>
          <strong>Compute the number of blocks.</strong> How many new blocks <Code>n</Code> does
          this request need? A prefill with 17 new tokens needs <Code>ceil(17/16) = 2</Code>.
        </li>
        <li>
          <strong>Check availability.</strong> If the pool is short, bail out early — and depending
          on whether this is a decode or a prefill, the engine may attempt{' '}
          <strong>recompute preemption</strong>, evicting a lower-priority request by calling{' '}
          <Code>kv_cache_manager.free</Code> to return its blocks to the pool. Otherwise it just
          skips scheduling this request.
        </li>
        <li>
          <strong>Allocate.</strong> Pull the first <Code>n</Code> blocks off{' '}
          <Code>free_block_queue</Code> (a doubly linked list) and store them in{' '}
          <Code>req_to_blocks</Code>, the dict mapping <Code>request_id</Code> → its block list.
        </li>
      </ol>

      <Callout kind="key" title="Why a queue and not a stack">
        <p>
          <Code>free_block_queue</Code> is FIFO — blocks are popped from the left and freed blocks
          are pushed to the right. That ordering is what makes prefix caching possible: a freed
          block keeps its contents and its hash while it sits in the queue, so it can be{' '}
          <em>reclaimed</em> with its data intact if the same prefix shows up again before it gets
          reused. Stage 07 is built entirely on this.
        </p>
      </Callout>

      <CodeBlock
        lang="text"
        caption="Bigger blocks mean less bookkeeping but a longer wasted tail; smaller blocks mean tighter packing but more block-table indirection. 16 is the default compromise."
        code={`bytes per block = 2 (key/value)
                * block_size          (default 16)
                * num_kv_heads
                * head_size
                * dtype_num_bytes     (e.g. 2 for bf16)`}
      />

      <Callout kind="gotcha" title="Only complete blocks are shareable">
        <p>
          A partially-filled block cannot be cached or shared, because its identity isn't settled
          yet — more tokens are still going to land in it. This is why prefix caching only reuses
          whole blocks, and why a shared prefix that isn't a multiple of <Code>block_size</Code>{' '}
          leaves <Code>prefix_len % block_size</Code> tokens to be recomputed every time.
        </p>
      </Callout>

      <Takeaways
        items={[
          'Paged attention splits the KV cache into fixed-size blocks and gives each sequence a block table, so its KV need not be contiguous. That kills external fragmentation and the need to reserve for the worst case.',
          'The only remaining waste is the partially-filled last block — bounded by block_size - 1 tokens per sequence, instead of unbounded reservation waste.',
          'allocate_slots is the choke point: compute n blocks, check the pool, and either take them off free_block_queue or trigger preemption. Everything about memory pressure in vLLM routes through it.',
        ]}
      />
    </StageLayout>
  )
}
