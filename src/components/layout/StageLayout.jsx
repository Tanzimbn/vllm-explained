import { useState } from 'react'
import { Link } from 'react-router-dom'
import { neighbours } from '../../content/roadmap'
import { SimPanel } from '../ui'

/*
 * The two-pane stage: prose on the left, the stage's primary simulator pinned in
 * a sticky pane on the right so it stays in view for the whole read. "Focus
 * simulator" collapses the prose column to zero and gives the pane the width.
 *
 * `slug` is passed in explicitly rather than read from useParams(), because the
 * render tests mount each page component bare, with no matching route.
 *
 * A stage's *secondary* simulators stay inline in the prose as <SimFrame>.
 */

const MICRO = 'font-mono text-[10px] tracking-[0.14em] uppercase'

const PANES = {
  open: 'lg:grid-cols-[minmax(0,1.06fr)_minmax(0,1fr)]',
  focus: 'lg:grid-cols-[0px_minmax(0,1fr)]',
}

function PrevNext({ slug }) {
  const { prev, next } = neighbours(slug)
  return (
    <div className="mt-10 border-t-2 border-edge pt-5">
      {prev && (
        <div className="mb-5 flex items-baseline justify-between gap-5">
          <span className={`${MICRO} text-neutral-600`}>previous</span>
          <Link
            to={`/stage/${prev.slug}`}
            className="text-[15px] font-[600] text-neutral-700 hover:text-ink"
          >
            ← {prev.title}
          </Link>
        </div>
      )}
      {next && (
        <div className="flex items-baseline justify-between gap-5">
          <span className={`${MICRO} text-neutral-600`}>next</span>
          <Link
            to={`/stage/${next.slug}`}
            className="border-b-2 border-accent text-[19px] font-[800] tracking-[-0.015em] text-ink"
          >
            {next.title} →
          </Link>
        </div>
      )}
    </div>
  )
}

export default function StageLayout({
  slug,
  sim,
  simTitle,
  simSubtitle,
  panel,
  knobs,
  legend,
  simFooter,
  keys = true,
  children,
}) {
  const [focus, setFocus] = useState(false)

  return (
    <main className={`grid ${focus ? PANES.focus : PANES.open}`}>
      {/* Prose. On mobile this follows the simulator, so the instrument sits
          next to the header that introduces it rather than below the whole read. */}
      <article className="prose-stage order-2 min-w-0 overflow-hidden px-[18px] pt-7 pb-11 sm:px-8 lg:order-1 lg:border-r-2 lg:border-edge lg:pt-8 lg:pr-10 lg:pb-14">
        <div className="max-w-[70ch]">
          {children}
          <PrevNext slug={slug} />
        </div>
      </article>

      <aside className="order-1 min-w-0 border-b-2 border-edge lg:order-2 lg:sticky lg:top-[99px] lg:max-h-[calc(100vh-99px)] lg:self-start lg:overflow-auto lg:border-b-0">
        <SimPanel
          sim={sim}
          title={simTitle}
          subtitle={simSubtitle}
          knobs={knobs}
          legend={legend}
          footer={simFooter}
          keys={keys}
          right={
            <button
              onClick={() => setFocus((f) => !f)}
              className="hidden shrink-0 px-2 py-1 font-mono text-[12px] text-accent-700 transition-colors hover:bg-accent-100 lg:inline-flex"
            >
              {focus ? 'Show notes' : 'Focus simulator'}
            </button>
          }
        >
          {panel}
        </SimPanel>
      </aside>
    </main>
  )
}
