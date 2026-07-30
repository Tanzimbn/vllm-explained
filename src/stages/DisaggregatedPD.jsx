import { useSimulation } from '../hooks/useSimulation'
import StageLayout from '../components/layout/StageLayout'
import disaggPD, { CONNECTOR_STEPS, pdStats } from '../sim/disaggPD'
import {
  BlogFigure,
  Callout,
  Card,
  Code,
  CodeBlock,
  SimFrame,
  StatRow,
  StatTile,
  Takeaways,
} from '../components/ui'
import { C, reqColor } from '../components/viz'

const STATUS_COLOR = {
  unborn: C.faint,
  queued: C.free,
  prefilling: C.prefill,
  transferring: C.warn,
  decoding: C.decode,
  done: C.good,
}

function PdViz({ sim }) {
  const { state, params } = sim
  const stats = pdStats(state)
  const disagg = params.mode === 'disagg'
  const maxMs = Math.max(...state.steps.map((x) => x.ms), 20)

  return (
    <div className="space-y-5">
      <StatRow>
        <StatTile
          label="p95 ITL"
          value={stats.p95Itl.toFixed(0)}
          unit="ms"
          tone={stats.p95Itl > 60 ? 'bad' : stats.p95Itl > 30 ? 'warn' : 'good'}
        />
        <StatTile label="median ITL" value={stats.p50Itl.toFixed(0)} unit="ms" />
        <StatTile
          label="mean TTFT"
          value={stats.meanTtft.toFixed(0)}
          unit="ms"
          tone="accent"
          hint="Disaggregation adds a KV transfer before decode can start"
        />
        <StatTile label="wall clock" value={state.elapsedMs.toFixed(0)} unit="ms" />
      </StatRow>

      {/* the two instances */}
      <div className="grid gap-3 sm:grid-cols-2">
        {(disagg ? ['prefill', 'decode'] : ['single engine']).map((role) => {
          const members = state.requests.filter((r) => {
            if (!disagg) return ['queued', 'decoding'].includes(r.status)
            return role === 'prefill'
              ? ['queued', 'prefilling'].includes(r.status)
              : ['decoding'].includes(r.status)
          })
          const accent = role === 'prefill' ? C.prefill : C.decode
          return (
            <div
              key={role}
              className="rounded-lg border px-3 py-2.5"
              style={{ borderColor: accent + '55' }}
            >
              <div className="flex items-baseline justify-between">
                <span
                  className="font-mono text-[0.62rem] tracking-widest uppercase"
                  style={{ color: accent }}
                >
                  {role === 'single engine' ? 'one engine · GPU 0' : `${role} instance`}
                </span>
                <span className="font-mono text-[0.58rem] text-ink-faint">
                  {disagg ? (role === 'prefill' ? 'GPU 0' : 'GPU 1') : 'both workloads'}
                </span>
              </div>
              <div className="mt-2 flex min-h-7 flex-wrap gap-1.5">
                {members.length === 0 ? (
                  <span className="font-mono text-[0.62rem] text-neutral-500">idle</span>
                ) : (
                  members.map((r) => (
                    <span
                      key={r.id}
                      className="rounded px-1.5 py-0.5 font-mono text-[0.62rem]"
                      style={{ background: reqColor(r.idx), color: C.bg }}
                      title={`${r.id} · ${r.status} · prompt ${r.promptLen}`}
                    >
                      {r.id}
                    </span>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* the external KV store */}
      {disagg && (
        <div
          className="rounded-lg border border-dashed px-3 py-2.5"
          style={{ borderColor: C.warn + '66' }}
        >
          <div className="flex items-baseline justify-between">
            <span
              className="font-mono text-[0.62rem] tracking-widest uppercase"
              style={{ color: C.warn }}
            >
              external KV service
            </span>
            <span className="font-mono text-[0.58rem] text-ink-faint">SharedStorageConnector</span>
          </div>
          <div className="mt-2 flex min-h-7 flex-wrap items-center gap-1.5">
            {state.store.length === 0 ? (
              <span className="font-mono text-[0.62rem] text-neutral-500">empty</span>
            ) : (
              state.store.map((id) => {
                const r = state.requests.find((x) => x.id === id)
                return (
                  <span
                    key={id}
                    className="rounded px-1.5 py-0.5 font-mono text-[0.62rem]"
                    style={{ background: C.warn, color: C.bg }}
                    title={`${id}'s KV in flight — ${r?.transferLeft} tick(s) left`}
                  >
                    {id} ↔ {r?.transferLeft}
                  </span>
                )
              })
            )}
            {state.connectorPhase && (
              <span className="ml-auto font-mono text-[0.6rem]" style={{ color: C.warn }}>
                {state.connectorPhase === 'save' ? 'wait_for_save →' : '← start_load_kv'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* step duration */}
      <div>
        <div className="mb-2 font-mono text-[10px] tracking-[0.14em] text-neutral-600 uppercase">
          step duration{disagg ? ' — prefill and decode engines in parallel' : ''}
        </div>
        <div className="scroll-x border border-edge bg-neutral-100 p-3">
          <div className="flex min-w-max items-end gap-[3px]" style={{ height: 110 }}>
            {state.steps.map((x, i) => (
              <div
                key={i}
                className="flex w-4 flex-col justify-end gap-[2px]"
                style={{ height: '100%' }}
              >
                {x.prefillTokens > 0 && (
                  <div
                    className="w-full rounded-t-[2px]"
                    style={{
                      height: `${((disagg ? x.prefillMs : x.ms * (x.prefillTokens / (x.prefillTokens + x.decodeTokens))) / maxMs) * 100}%`,
                      background: C.prefill,
                    }}
                    title={`${x.prefillTokens} prefill tokens`}
                  />
                )}
                {x.decodeTokens > 0 && (
                  <div
                    className="w-full"
                    style={{
                      height: `${((disagg ? x.decodeMs : x.ms * (x.decodeTokens / (x.prefillTokens + x.decodeTokens))) / maxMs) * 100}%`,
                      background: C.decode,
                    }}
                    title={`${x.decodeTokens} decode tokens`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* per-request lifecycle */}
      <div className="space-y-1">
        {state.requests.map((r) => (
          <div key={r.id} className="flex items-center gap-2 font-mono text-[0.65rem]">
            <span className="w-7" style={{ color: reqColor(r.idx) }}>
              {r.id}
            </span>
            <span
              className="w-24 rounded px-1 text-center text-[0.58rem]"
              style={{ background: STATUS_COLOR[r.status] + '33', color: STATUS_COLOR[r.status] }}
            >
              {r.status}
            </span>
            <span className="w-20 text-[0.58rem] text-ink-faint tabular-nums">p{r.promptLen}</span>
            <div className="scroll-x flex flex-1 items-end gap-[2px]" style={{ height: 20 }}>
              {r.itls.map((ms, i) => (
                <div
                  key={i}
                  title={`token ${i + 1}: ${ms.toFixed(1)} ms`}
                  className="w-2 shrink-0 rounded-t-[1px]"
                  style={{
                    height: `${Math.max(10, (ms / maxMs) * 100)}%`,
                    background: ms > stats.p50Itl * 2.5 ? C.bad : C.decode,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="rounded-md bg-neutral-200 px-3 py-2 font-mono text-[0.7rem] leading-relaxed text-ink-dim">
        <span className="text-accent-700">tick {state.tick}:</span> {state.note}
      </p>
    </div>
  )
}

export default function DisaggregatedPD() {
  const sim = useSimulation(disaggPD)

  return (
    <StageLayout
      slug="disaggregated-pd"
      sim={sim}
      simTitle="KV handoff between instances"
      simSubtitle="Requests arrive in bursts. Colocated, prefills and decodes share every step; disaggregated, they run on separate GPUs in parallel and KV moves over the wire in between."
      legend={[
        { label: 'prefill work', color: C.prefill },
        { label: 'decode work', color: C.decode },
        { label: 'KV in transit', color: C.warn },
        { label: 'ITL far above median', color: C.bad },
      ]}
      simFooter={
        <>
          The trade is visible in two numbers. <strong>p95 ITL</strong> drops sharply when you
          disaggregate — decode steps are now uniformly small. <strong>Mean TTFT</strong> gets
          worse, because a request must ship its whole KV cache to another machine before its first
          token can be produced. Turn up the transfer cost and watch disaggregation stop being worth
          it: this is why the connector implementation matters so much in practice.
        </>
      }
      panel={<PdViz sim={sim} />}
    >
      <p>
        Stage 06 fixed the case where <em>one</em> long prompt disrupts a step. But if long prompts
        keep arriving, every step keeps containing one, and chunking only makes the disruption
        smaller and more frequent. At some point the right answer is to stop making these two
        workloads share a GPU at all.
      </p>

      <h2>Split the fleet</h2>
      <p>
        Prefill and decode have opposite performance profiles, so run <Code>N</Code> prefill
        instances and <Code>M</Code> decode instances, autoscaling each on the live request mix.
        Prefill workers write KV to a dedicated KV-cache service; decode workers read from it. Long,
        bursty prefill is isolated from steady, latency-sensitive decode, which gives much tighter
        control over TTFT and ITL independently.
      </p>

      <BlogFigure
        src="pd.png"
        caption="Disaggregated prefill/decode with a KV-cache service between"
      />

      <h2>Connectors</h2>
      <p>
        A <strong>connector</strong> is vLLM's abstraction for moving KV between instances. The
        example below uses <Code>SharedStorageConnector</Code> — a debugging implementation whose
        "external server" is just the local filesystem, which makes the mechanics easy to follow.
        Its lifecycle has five points:
      </p>

      <div className="my-5 space-y-2">
        {CONNECTOR_STEPS.map((s, i) => (
          <Card key={s.key} className="p-3.5">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[0.6rem] text-accent-700">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="font-mono text-[0.75rem] text-ink">{s.title}</span>
            </div>
            <p className="mt-1 text-[0.78rem] leading-relaxed text-ink-faint">{s.detail}</p>
          </Card>
        ))}
      </div>

      <Callout kind="key" title="The same seam as prefix caching">
        <p>
          Look at where <Code>get_num_new_matched_tokens</Code> is called: right after the{' '}
          <em>local</em> prefix-cache check, and its result is added to the local computed-token
          count before <Code>allocate_slots</Code>. Disaggregated P/D is, structurally, prefix
          caching with the cache living on another machine. Stage 07's machinery is doing the work;
          the connector just widens where a "hit" can come from.
        </p>
      </Callout>

      <CodeBlock
        caption="Two processes, GPU 0 prefilling with max_tokens=1 and GPU 1 doing the decoding. The decode instance fetches KV before its loop starts."
        code={`ktc = KVTransferConfig(
    kv_connector="SharedStorageConnector",
    kv_role="kv_both",
    kv_connector_extra_config={"shared_storage_path": "local_storage"},
)

def run_prefill(prefill_done):
    os.environ["CUDA_VISIBLE_DEVICES"] = "0"
    sampling_params = SamplingParams(temperature=0, top_p=0.95, max_tokens=1)
    llm = LLM(model="TinyLlama/TinyLlama-1.1B-Chat-v1.0", kv_transfer_config=ktc)
    llm.generate(prompts, sampling_params)
    prefill_done.set()          # KV is now in the store

def run_decode(prefill_done):
    os.environ["CUDA_VISIBLE_DEVICES"] = "1"
    llm = LLM(model="TinyLlama/TinyLlama-1.1B-Chat-v1.0", kv_transfer_config=ktc)
    prefill_done.wait()
    outputs = llm.generate(prompts, sampling_params)   # fetches KV first`}
      />

      <Callout kind="note" title="Details that matter in production">
        <ul>
          <li>
            KV transfers can be done <strong>layer by layer</strong>, before/after each attention
            layer, which overlaps transfer with compute instead of paying it as one lump.
          </li>
          <li>
            A decode instance loads external KV <strong>only once</strong>, on its request's first
            step; everything after that is computed and stored locally.
          </li>
          <li>
            The connector interface is <strong>not yet stable</strong> — near-term improvements are
            planned, some potentially breaking.
          </li>
          <li>
            <Code>LMCache</Code> (backed by NVIDIA's NIXL) is the fastest production-ready
            connector, though it lives at the bleeding edge.
          </li>
        </ul>
      </Callout>

      <Takeaways
        items={[
          'Disaggregation puts prefill and decode on separate instances so bursty prefill cannot inflate decode steps. That buys independent control of TTFT and ITL.',
          "The cost is shipping each request's KV cache between machines before decode can start — which raises TTFT and makes connector performance the deciding factor in whether it pays off.",
          'The connector lifecycle is: instantiate (worker + scheduler roles) → get_num_new_matched_tokens → update_state_after_alloc → build_connector_meta → start_load_kv / wait_for_save around the forward pass.',
          "Architecturally this is prefix caching with a remote cache: the external hit count is added to the local computed-token count before allocate_slots, reusing stage 07's machinery.",
        ]}
      />
    </StageLayout>
  )
}
