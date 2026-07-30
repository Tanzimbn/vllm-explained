import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import Shell from './components/layout/Shell'
import StageHeader from './components/layout/StageHeader'
import { stageBySlug } from './content/roadmap'
import RoadmapMap from './stages/RoadmapMap'

/* One module per stage, lazily loaded so the initial page stays light. */
const PAGES = {
  'prefill-vs-decode': lazy(() => import('./stages/PrefillVsDecode')),
  'engine-anatomy': lazy(() => import('./stages/EngineAnatomy')),
  'paged-attention': lazy(() => import('./stages/PagedAttention')),
  scheduler: lazy(() => import('./stages/Scheduler')),
  'forward-pass': lazy(() => import('./stages/ForwardPass')),
  'chunked-prefill': lazy(() => import('./stages/ChunkedPrefill')),
  'prefix-caching': lazy(() => import('./stages/PrefixCaching')),
  'guided-decoding': lazy(() => import('./stages/GuidedDecoding')),
  'speculative-decoding': lazy(() => import('./stages/SpeculativeDecoding')),
  'disaggregated-pd': lazy(() => import('./stages/DisaggregatedPD')),
  'multiproc-executor': lazy(() => import('./stages/MultiProcExecutor')),
  'distributed-serving': lazy(() => import('./stages/DistributedServing')),
  benchmarking: lazy(() => import('./stages/Benchmarking')),
}

function StagePage() {
  const { slug } = useParams()
  const stage = stageBySlug[slug]
  const Page = PAGES[slug]
  if (!stage || !Page) return <Navigate to="/" replace />
  // The header renders eagerly so the title paints before the simulator chunk
  // arrives; the page itself renders its own <StageLayout> two-pane grid.
  return (
    <>
      <StageHeader stage={stage} />
      <Suspense
        fallback={
          <div className="py-20 text-center font-mono text-xs text-ink-faint">loading…</div>
        }
      >
        <Page />
      </Suspense>
    </>
  )
}

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<RoadmapMap />} />
        <Route path="/stage/:slug" element={<StagePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}
