import { chapters } from '../../content/roadmap'

/*
 * The stage's title band, above the two-pane grid.
 *
 * Rendered eagerly by App.jsx rather than from inside the lazily-loaded stage
 * module, for two reasons: the title and dek paint immediately while the
 * simulator chunk is still loading, and a statically-rendered deep link still
 * identifies its own stage (which src/deploy.test.jsx checks).
 */

const MICRO = 'font-mono text-[10px] tracking-[0.14em] uppercase'

export default function StageHeader({ stage }) {
  const ci = chapters.findIndex((c) => c.id === stage.chapter)
  const ch = chapters[ci]
  return (
    <div className="border-b-2 border-edge px-[18px] pt-8 pb-6 sm:px-8 lg:pt-11 lg:pr-10 lg:pb-7">
      <div className={`${MICRO} mb-4 text-accent-700`}>
        Act {String(ci + 1).padStart(2, '0')} {ch?.title} · stage {String(stage.n).padStart(2, '0')}
      </div>
      <h1 className="mb-3.5 text-[clamp(32px,3.6vw,52px)] leading-[0.98] font-[900] tracking-[-0.03em]">
        {stage.title}
      </h1>
      <p className="m-0 max-w-[52ch] text-[17px] leading-[1.45] font-[500] text-ink-dim text-pretty">
        {stage.hook}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {stage.concepts.map((c) => (
          <span
            key={c}
            className="border border-accent px-2 py-[3px] font-mono text-[11px] text-accent-700"
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  )
}
