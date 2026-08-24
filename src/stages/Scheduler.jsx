import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import scheduler, { BLOCK } from '../sim/scheduler'
import { Callout, Code, CodeBlock, StageRef, StatRow, StatTile, Takeaways } from '../components/ui'
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
          with the prompt spread wide: long prompts become unschedulable, and the run stops and says
          so. That is exactly the hole <StageRef n={6} /> fills.
        </>
      }
      tryThis={[
        'Run as-is: 20 steps, nobody preempted.',
        'Drop KV blocks to 8: one preemption, and 55 tokens of prefill work destroyed.',
        'Set Prompt-length spread to 90 and Token budget to 24. The run stops — that prompt can never be scheduled.',
      ]}
      panel={<SchedViz sim={sim} />}
    >
      <p>
        Every engine step opens with one decision: of everything in the system right now, who runs?
        The scheduler answers it against two hard limits.
      </p>
      <p>
        The first is the <strong>token budget</strong> — <Code>max_num_batched_tokens</Code>, the
        most tokens the engine will put through one forward pass. The second is the pool of KV
        blocks from <StageRef n={3} />, which is finite and already spoken for by whoever is
        running.
      </p>

      <h2>Decode first</h2>
      <p>
        The scheduler always looks at the <Code>running</Code> queue before the <Code>waiting</Code>{' '}
        queue. For each request already running it does three things:
      </p>
      <ol>
        <li>
          works out how many new tokens it needs — usually 1, though speculative decoding and async
          scheduling both make it more (<StageRef n={9} />);
        </li>
        <li>
          calls <Code>allocate_slots</Code> to get KV blocks for them;
        </li>
        <li>takes those tokens off the step's budget.</li>
      </ol>
      <p>
        Only then does it turn to <Code>waiting</Code> and try to admit new prompts. For each one it
        checks how many of its blocks are already computed — zero, unless prefix caching is on
        (<StageRef n={7} />). It calls <Code>allocate_slots</Code> for the rest, moves the request
        into <Code>running</Code>, and takes its prompt length off the budget too.
      </p>

      <Callout kind="key" title="Why decode gets to go first">
        <p>
          A decode belongs to somebody who is already watching an answer appear, and it costs one
          token of budget. A prefill costs as many tokens as its prompt is long. Serving decodes
          first keeps everybody's answer flowing at a steady rate, and spends whatever budget is
          left over on admitting new work. Prefills are the part of the step that stretches.
        </p>
      </Callout>

      <h2>When there aren't enough blocks</h2>
      <p>
        <Code>allocate_slots</Code> works out how many new blocks are needed —{' '}
        <Code>ceil(new_tokens / {BLOCK})</Code> — and looks at the pool. If there are not enough,
        what happens next depends on who was asking.
      </p>
      <p>
        A <strong>prefill</strong> is simply not scheduled. It stays in <Code>waiting</Code> and
        tries again on a later step. Nothing is lost, because it had not started.
      </p>
      <p>
        A <strong>decode</strong> is different, because stopping it would strand a half-finished
        answer. So the engine may <strong>preempt</strong> somebody instead: pick a lower-priority
        request, call <Code>kv_cache_manager.free</Code> on it, and hand its blocks to the decode
        that needed them.
      </p>

      <Callout kind="gotcha" title="Preemption is worse than doing nothing">
        <p>
          The preempted request does not pause. It loses its KV cache completely, and when it is
          admitted again its whole prompt has to be prefilled a second time. The work is not
          deferred, it is destroyed.
        </p>
        <p>
          That is why the panel counts recomputed tokens on their own: they are compute you paid for
          twice. A run with steady preemption is not a scheduler being clever. It is a sign that{' '}
          <Code>max_num_seqs</Code> (how many requests may run at once) or{' '}
          <Code>gpu_memory_utilization</Code> (how much VRAM the cache may claim) is set wrong for
          the traffic.
        </p>
        <p>
          The older V0 engine could also <em>swap</em> a preempted request's KV cache out to CPU
          memory rather than discard it. V1 always recomputes.
        </p>
      </Callout>

      <h2>Watch it happen</h2>
      <p>
        The panel starts with 14 KV blocks, a budget of 64 tokens per step, and 7 requests arriving
        over time. Press <Code>▶ Run</Code>: everything is served in 20 steps with no preemptions at
        all, because the pool is never tight.
      </p>
      <p>
        Now drag <Code>KV blocks</Code> down to 8 and run it again. One request gets preempted, and
        the recomputed-tokens counter climbs to 55. Those 55 tokens are prefill work the engine did,
        threw away, and had to do over.
      </p>
      <p>
        Then try starving the other limit. Put <Code>Prompt-length spread</Code> at 90 and{' '}
        <Code>Token budget / step</Code> at 24. The run stops after 12 steps with only one request
        finished, and the panel says why. A prompt of 82 tokens cannot fit in a 24-token budget, and
        there is no way to feed it in pieces. <StageRef n={6} title /> is the feature that closes
        exactly this hole.
      </p>

      <h2>Who goes first: FCFS or priority</h2>
      <p>
        The order of the <Code>waiting</Code> queue is set by the scheduler's policy.{' '}
        <Code>FCFS</Code> means first come, first served: new requests are added to the back, and
        arrival order decides everything.
      </p>
      <p>
        <Code>priority</Code> keeps the queue sorted by an importance number instead, so a request
        that arrives late but matters more can move ahead of ones already queued. Flip the{' '}
        <Code>Policy</Code> knob and watch the admission order change while nothing else does.
      </p>

      <CodeBlock
        lang="text"
        caption="The whole step, compressed. One budget is shared: whatever the decodes leave behind is what the prefills get to spend."
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
          'One shared token budget per step, spent on decodes first and prefills with whatever is left. Mixing both kinds in a single step is a V1 capability that V0 lacked.',
          'allocate_slots is where memory pressure becomes visible. It either finds the blocks, defers a prefill, or preempts a running request to free some.',
          'Preemption destroys work rather than deferring it: the victim loses its KV cache and has to prefill again from scratch. Sustained preemption means your capacity settings are wrong.',
          'A prompt longer than the whole token budget can never be scheduled at all, which is the hole chunked prefill exists to close.',
        ]}
      />
    </StageLayout>
  )
}
