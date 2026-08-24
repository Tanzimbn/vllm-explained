import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import kvcache, { memoryBreakdown } from '../sim/kvcache'
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
        A sequence being decoded needs every key and value it has computed so far. Holding on to
        them is the <strong>KV cache</strong>, and it is the resource that decides how many requests
        a GPU can serve at once. Weights are fixed in size; the KV cache is not, and it grows with
        every token.
      </p>
      <p>
        So the question this stage answers is a storage question. Where in VRAM — the GPU's own
        memory, the HBM from <StageRef n={1} /> — do all those keys and values go?
      </p>

      <h2>The obvious answer, and why it fails</h2>
      <p>
        The natural answer is to give each sequence one solid run of memory, the way you would
        allocate an array. The trouble is that you have to size it before you know how long the
        sequence will be. So you size it for the worst case: <Code>prompt_len + max_tokens</Code>.
      </p>
      <p>
        A request that allows up to 512 tokens and stops after 30 has been sitting on 482 tokens'
        worth of VRAM the entire time. Nobody else could use it. That is the first kind of waste,
        and it is unbounded — it grows with whatever limit the caller happened to set.
      </p>
      <p>
        The second kind is nastier. Because each run has to be <em>adjacent</em>, the free space
        left between sequences ends up in gaps too small to fit anybody, even when the total free
        space is plentiful. Memory that exists and cannot be used is called{' '}
        <strong>external fragmentation</strong>.
      </p>

      <h2>Paging it instead</h2>
      <p>
        PagedAttention borrows the trick operating systems use for RAM. Chop the KV cache into
        fixed-size <strong>blocks</strong> — <Code>block_size</Code> is 16 tokens by default — and
        stop insisting that a sequence's blocks sit next to each other.
      </p>
      <p>
        Each sequence gets a <strong>block table</strong>: a little list saying which physical block
        holds its first 16 tokens, which holds the next 16, and so on. The blocks can be scattered
        anywhere in the pool. <Code>#3 → #17 → #4</Code> is a perfectly ordinary block table.
      </p>
      <p>
        Both kinds of waste go away with that one change. Adjacency no longer matters, so external
        fragmentation cannot happen. Blocks are handed out only when a sequence actually grows into
        them, so nothing is reserved for output that never arrives.
      </p>
      <p>
        One small waste is left. The last block of a sequence is usually only part full, which
        strands up to <Code>block_size - 1</Code> token slots. That is called{' '}
        <strong>internal fragmentation</strong>, and unlike the other two it is bounded: at most 15
        slots per sequence, no matter how the caller sets its limits.
      </p>

      <BlogFigure
        src="kv_cache_blocks.png"
        caption="A request's list of KV-cache blocks"
        max={560}
      />

      <h2>Watch it happen</h2>
      <p>
        The panel on the right hands 32 blocks to 7 requests. Press <Code>▶ Run</Code> with{' '}
        <Code>Allocator</Code> on <Code>paged</Code>. All seven requests are in flight together,
        slot efficiency never drops below 85%, and everyone is finished after 23 steps.
      </p>
      <p>
        Now switch <Code>Allocator</Code> to <Code>contiguous</Code> and run it again. The same
        seven requests take 33 steps, only three are ever in flight at once, and slot efficiency
        falls to 35%. At its worst, 139 tokens' worth of blocks are reserved and holding nothing.
      </p>
      <p>
        That gap is the whole argument for paged attention, and it is not a speed trick. Each step
        does the same work in both modes. Paging simply lets more requests be in the machine at the
        same time.
      </p>
      <Callout kind="note" title="Making external fragmentation show itself">
        <p>
          At these settings the pool never actually splinters. Turn <Code>Requests</Code> up to 10
          in <Code>contiguous</Code> mode and it does. The run reports six admissions blocked by
          fragmentation: six times when enough blocks were free, but not enough of them side by
          side. In <Code>paged</Code> mode that counter cannot move at all, at any setting.
        </p>
      </Callout>

      <h2>How a request actually gets its blocks</h2>
      <p>
        The scheduler calls <Code>allocate_slots</Code>, which does three things.
      </p>
      <ol>
        <li>
          <strong>Work out how many new blocks are needed.</strong> A prefill with 17 new tokens
          needs <Code>ceil(17 / 16) = 2</Code> of them.
        </li>
        <li>
          <strong>Check the pool can cover it.</strong> If it cannot, give up here. Depending on
          whether this is a prefill or a decode, the engine may instead take blocks away from a
          lower-priority request — <strong>preemption</strong>, which is <StageRef n={4} />.
        </li>
        <li>
          <strong>Hand them over.</strong> Take the first <Code>n</Code> blocks off{' '}
          <Code>free_block_queue</Code>, the pool of blocks nobody is using, and record them in{' '}
          <Code>req_to_blocks</Code> — the table from request id to that request's block list.
        </li>
      </ol>

      <Callout kind="key" title="Why the free pool is a queue and not a stack">
        <p>
          <Code>free_block_queue</Code> hands out blocks from the front and takes freed ones back at
          the end. That ordering is not an accident. A freed block keeps its contents and its
          identity while it waits its turn. So if the same text turns up again before that block is
          reused, it can be reclaimed with the data still in it. Free the newest block first and it
          would be overwritten almost immediately. <StageRef n={7} title /> is built entirely on
          this.
        </p>
        <p>
          It is a doubly linked list for the same reason. Reclaiming a block means pulling it out
          of the middle of the queue, and that kind of list can do it without searching for the
          block first.
        </p>
      </Callout>

      <CodeBlock
        lang="text"
        caption="Bigger blocks mean less bookkeeping but a longer wasted tail; smaller blocks pack more tightly but need a longer block table. 16 is the default compromise."
        code={`bytes per block = 2 (key/value)
                * block_size          (default 16)
                * num_kv_heads
                * head_size
                * dtype_num_bytes     (e.g. 2 for bf16)`}
      />

      <Callout kind="gotcha" title="Only full blocks can be shared">
        <p>
          A partly-filled block cannot be cached or shared with another request. More tokens are
          still going to land in it, so what it holds is not settled yet. This is why prefix caching
          only ever reuses whole blocks. A shared prefix that is not a multiple of{' '}
          <Code>block_size</Code> leaves <Code>prefix_len % block_size</Code> tokens to be
          recomputed every time.
        </p>
      </Callout>

      <h2>What happens when the pool runs out</h2>
      <p>
        Paging removes the waste, but it cannot create memory. Set <Code>Requests</Code> to 10 in{' '}
        <Code>paged</Code> mode and watch: nine requests are admitted, the pool empties, and every
        one of them then wants a block to keep decoding.
      </p>
      <p>
        Nothing can finish, so nothing is freed, so nothing can finish. The run stops after 9 steps
        with the note saying so. Deciding who to throw out of the machine to break that tie is not
        the allocator's job — it belongs to <StageRef n={4} />, which is next.
      </p>

      <Takeaways
        items={[
          'Paged attention splits the KV cache into fixed-size blocks and gives each sequence a block table, so its blocks need not be adjacent. That removes external fragmentation and the need to reserve for the worst case.',
          'The only waste left is the partly-filled last block — at most block_size - 1 slots per sequence, instead of unbounded reservation waste.',
          'free_block_queue is FIFO so that a freed block keeps its data long enough to be reclaimed, which is what makes prefix caching possible.',
          'allocate_slots is the choke point: work out how many blocks, check the pool, then either take them or preempt somebody. Every memory-pressure decision in vLLM runs through it.',
        ]}
      />
    </StageLayout>
  )
}
