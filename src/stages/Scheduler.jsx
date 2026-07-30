import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import scheduler, { BLOCK } from '../sim/scheduler'
import { Callout, Code, CodeBlock, StatRow, StatTile, Takeaways } from '../components/ui'
import { C, MeterBar, QueueLane, StackedBar, Timeline } from '../components/viz'

function SchedViz({ sim }) {
  const { state, params } = sim
  const R = (i) => state.requests[i]
  const step = state.lastStep

  const decodeTokens = step.decodes.length
  const prefillTokens = step.budgetUsed - decodeTokens

  return (
    <div className="space-y-5">
      <StatRow>
        <StatTile
          label="free KV blocks"
          value={state.freeBlocks}
          unit={`/${params.numBlocks}`}
          tone={state.freeBlocks === 0 ? 'bad' : state.freeBlocks < 3 ? 'warn' : 'good'}
        />
        <StatTile
          label="preemptions"
          value={state.totalPreemptions}
          tone={state.totalPreemptions ? 'bad' : 'neutral'}
        />
        <StatTile
          label="recomputed tokens"
          value={state.wastedRecompute}
          tone={state.wastedRecompute ? 'warn' : 'neutral'}
          hint="Prefill work thrown away by preemption and paid for a second time"
        />
        <StatTile
          label="finished"
          value={`${state.requests.filter((r) => r.status === 'done').length}/${state.requests.length}`}
        />
      </StatRow>

      <StackedBar
        label="token budget this step"
        max={params.tokenBudget}
        sublabel={`${step.budgetUsed} / ${params.tokenBudget} used`}
        segments={[
          { label: 'decode', value: decodeTokens, color: C.decode },
          { label: 'prefill', value: prefillTokens, color: C.prefill },
        ]}
      />

      <MeterBar
        label="free_block_queue"
        value={state.freeBlocks}
        max={params.numBlocks}
        color={state.freeBlocks === 0 ? C.bad : C.alloc}
      />

      <div className="space-y-2">
        <QueueLane
          label="running"
          accent={C.decode}
          empty="nothing decoding"
          items={state.running.map((i) => ({
            id: R(i).id,
            sub: `${R(i).generated}/${R(i).outLen}`,
            tone: 'decode',
            glyph: step.decodes.includes(R(i).id) ? '▸' : undefined,
            dim: !step.decodes.includes(R(i).id),
          }))}
        />
        <QueueLane
          label="waiting"
          accent={C.prefill}
          empty="nothing queued"
          items={state.waiting.map((i) => ({
            id: R(i).id,
            sub: `p${R(i).promptLen}${params.policy === 'priority' ? ` ·pri${R(i).priority}` : ''}`,
            tone: 'prefill',
            glyph: R(i).preemptions > 0 ? '↻' : undefined,
            dim: !step.prefills.includes(R(i).id),
          }))}
        />
      </div>

      <div>
        <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
          engine steps →
        </div>
        <Timeline
          rows={state.requests.map((r, i) => ({
            label: `${r.id} p${r.promptLen}`,
            cells: state.rows[i].length ? state.rows[i] : [{ kind: 'idle' }],
          }))}
          cursor={state.tick - 1}
        />
      </div>

      <p className="rounded-md bg-neutral-200 px-3 py-2 font-mono text-[0.7rem] leading-relaxed text-ink-dim">
        <span className="text-accent-700">tick {state.tick}:</span> {state.note}
        {step.preempted.length > 0 && (
          <span style={{ color: C.bad }}> · preempted {step.preempted.join(', ')}</span>
        )}
      </p>

      {state.stuck && (
        <p
          className="rounded-md px-3 py-2 text-[0.78rem] leading-relaxed"
          style={{ background: 'rgba(239,122,133,0.10)', color: C.bad }}
        >
          <strong>Deadlocked.</strong> {state.stuck}
        </p>
      )}
    </div>
  )
}

export default function Scheduler() {
  const sim = useSimulation(scheduler)

  return (
    <StageLayout
      slug="scheduler"
      sim={sim}
      simTitle="The scheduler, tick by tick"
      simSubtitle="Requests arrive over time. Watch the budget bar split between decode and prefill, and shrink the KV block pool until preemptions start."
      legend={[
        { label: 'prefill', color: C.prefill },
        { label: 'decode', color: C.decode },
        { label: 'in waiting queue', color: C.free },
        { label: 'preempted (KV thrown away)', color: C.bad },
        { label: 'finished', color: C.good },
      ]}
      simFooter={
        <>
          Two experiments worth running. <strong>Drop “KV blocks” to 6–8:</strong> the pool runs dry
          mid-decode and you'll see requests get preempted and re-prefilled — watch the
          recomputed-tokens counter, that's pure waste. <strong>Drop “token budget” to 24</strong>{' '}
          with a wide prompt spread: long prompts become unschedulable and the sim deadlocks, which
          is exactly the hole stage 06 fills.
        </>
      }
      panel={<SchedViz sim={sim} />}
    >
      <p>
        Every engine step begins with one decision: of everything currently in the system, who runs
        now? That decision is made against two hard limits — a per-step{' '}
        <strong>token budget</strong>, and the finite pool of KV blocks from stage 03.
      </p>

      <h2>Decode first</h2>
      <p>
        The scheduler considers the <Code>running</Code> queue before the <Code>waiting</Code>{' '}
        queue. For each running request it:
      </p>
      <ol>
        <li>
          computes how many new tokens it needs — usually 1, but not always: speculative decoding
          and async scheduling both make it more (stage 09);
        </li>
        <li>
          calls <Code>allocate_slots</Code>;
        </li>
        <li>subtracts those tokens from the step's token budget.</li>
      </ol>
      <p>
        Only then does it turn to <Code>waiting</Code> and pull in prefills: fetch the number of
        already-computed blocks (zero unless prefix caching is on, stage 07), call{' '}
        <Code>allocate_slots</Code>, pop the request out of <Code>waiting</Code> into{' '}
        <Code>running</Code> with status <Code>RUNNING</Code>, and subtract from the budget again.
      </p>

      <Callout kind="key" title="Why decode gets priority">
        <p>
          A decode is a request a user is already waiting on, mid-answer, and it costs exactly one
          token of budget. A prefill costs as many tokens as the prompt is long. Serving decodes
          first keeps inter-token latency smooth for everyone already streaming, and spends whatever
          budget is left admitting new work. Prefills are the elastic part of the step.
        </p>
      </Callout>

      <h2>allocate_slots, and what happens when it fails</h2>
      <p>
        <Code>allocate_slots</Code> computes how many new blocks are needed —{' '}
        <Code>ceil(new_tokens / {BLOCK})</Code> — and checks the pool. If there isn't enough, the
        engine has two options, and which one it takes depends on whether the request is a decode or
        a prefill.
      </p>
      <p>
        For a prefill, it simply doesn't get scheduled; it waits for a later step. For a decode, the
        engine may attempt <strong>recompute preemption</strong>: evict a lower-priority request by
        calling <Code>kv_cache_manager.free</Code>, returning its blocks to the pool so the decode
        can continue.
      </p>

      <Callout kind="gotcha" title="Preemption is not free — it is negative work">
        <p>
          A preempted request loses its KV cache entirely. When it is eventually rescheduled, its
          whole prefill has to run <em>again</em> from scratch. That's why the simulator counts
          recomputed tokens separately: they're compute you paid for twice. Heavy preemption is a
          signal that <Code>max_num_seqs</Code> or <Code>gpu_memory_utilization</Code> is set wrong
          for the workload, not that the scheduler is doing something clever.
        </p>
        <p>
          V0 also supported <em>swap</em> preemption, moving KV to CPU memory instead of discarding
          it. V1 uses recomputation.
        </p>
      </Callout>

      <h2>Policy: FCFS or priority</h2>
      <p>
        The waiting queue is ordered by the scheduler's policy setting. Under <Code>FCFS</Code> it's
        a plain append — arrival order wins. Under <Code>priority</Code> it's a heap push, and a
        late-arriving important request can jump the queue. Flip the policy knob and watch the
        admission order change while everything else stays the same.
      </p>

      <CodeBlock
        lang="text"
        caption="The whole step, compressed. Note that the same budget is shared: whatever decode leaves behind is what prefill gets to spend."
        code={`budget = max_num_batched_tokens

for req in running:                  # decodes first
    n = num_new_tokens(req)          # 1, or more with specdec
    if not allocate_slots(req, n):
        preempt_lowest_priority()    # frees KV blocks — costs a re-prefill later
    budget -= n

for req in waiting:                  # then prefills, with what's left
    computed = get_computed_blocks(req)   # 0 unless prefix caching
    if not allocate_slots(req, req.num_prompt_tokens - computed):
        continue
    req.status = RUNNING
    budget -= req.num_prompt_tokens`}
      />

      <Takeaways
        items={[
          'One shared token budget per step, spent on decodes first and prefills second. Mixing both kinds in a single step is a V1 capability that V0 lacked.',
          'allocate_slots is where memory pressure becomes visible: it either finds blocks, defers a prefill, or preempts a running request to free some.',
          'Recompute preemption trades thrown-away prefill work for forward progress on decodes. It keeps the engine alive under pressure, but sustained preemption means your capacity settings are wrong.',
        ]}
      />
    </StageLayout>
  )
}
