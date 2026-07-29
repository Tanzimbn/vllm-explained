import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { chapters, neighbours, source, stages, stagesOf } from '../../content/roadmap'

function Sidebar({ open, onClose }) {
  const { pathname } = useLocation()
  useEffect(() => {
    onClose()
  }, [pathname])

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed top-0 left-0 z-40 h-full w-[264px] overflow-y-auto border-r border-edge bg-panel/95 px-4 py-5 backdrop-blur transition-transform lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Link to="/" className="block">
          <div className="font-mono text-[0.65rem] tracking-[0.2em] text-accent uppercase">
            inside vLLM
          </div>
          <div className="mt-0.5 text-sm font-semibold text-ink">Interactive roadmap</div>
        </Link>

        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `mt-4 block rounded-md px-2.5 py-1.5 font-mono text-[0.7rem] transition-colors ${
              isActive ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:bg-panel-2 hover:text-ink-dim'
            }`
          }
        >
          ◈ the map
        </NavLink>

        <nav className="mt-5 space-y-5">
          {chapters.map((ch, ci) => (
            <div key={ch.id}>
              <div className="mb-1.5 flex items-baseline gap-1.5 px-1">
                <span className="font-mono text-[0.6rem] text-ink-faint/60">
                  {String(ci + 1).padStart(2, '0')}
                </span>
                <span className="font-mono text-[0.62rem] tracking-widest text-ink-faint uppercase">
                  {ch.title}
                </span>
              </div>
              <ul className="space-y-0.5">
                {stagesOf(ch.id).map((s) => (
                  <li key={s.slug}>
                    <NavLink
                      to={`/stage/${s.slug}`}
                      className={({ isActive }) =>
                        `flex items-baseline gap-2 rounded-md px-2.5 py-1.5 text-[0.78rem] leading-snug transition-colors ${
                          isActive
                            ? 'bg-accent/12 text-accent'
                            : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
                        }`
                      }
                    >
                      <span className="font-mono text-[0.6rem] text-ink-faint tabular-nums">
                        {String(s.n).padStart(2, '0')}
                      </span>
                      <span>{s.title}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="mt-8 border-t border-edge pt-4 text-[0.68rem] leading-relaxed text-ink-faint">
          A companion to{' '}
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline decoration-accent-dim underline-offset-2"
          >
            {source.title}
          </a>{' '}
          by {source.author}. Diagrams are from that post. Analysis tracks vLLM V1 at commit{' '}
          <span className="font-mono">{source.commit}</span>.
        </div>
      </aside>
    </>
  )
}

export function PrevNext({ slug }) {
  const { prev, next } = neighbours(slug)
  return (
    <div className="mt-12 grid gap-3 border-t border-edge pt-6 sm:grid-cols-2">
      {prev ? (
        <Link
          to={`/stage/${prev.slug}`}
          className="group rounded-lg border border-edge px-4 py-3 transition-colors hover:border-edge-bright"
        >
          <div className="font-mono text-[0.6rem] tracking-widest text-ink-faint uppercase">
            ← previous
          </div>
          <div className="mt-0.5 text-sm text-ink-dim group-hover:text-ink">{prev.title}</div>
        </Link>
      ) : (
        <div />
      )}
      {next && (
        <Link
          to={`/stage/${next.slug}`}
          className="group rounded-lg border border-edge px-4 py-3 text-right transition-colors hover:border-accent-dim"
        >
          <div className="font-mono text-[0.6rem] tracking-widest text-accent/70 uppercase">
            next →
          </div>
          <div className="mt-0.5 text-sm text-ink-dim group-hover:text-ink">{next.title}</div>
        </Link>
      )}
    </div>
  )
}

export function StageHeader({ stage }) {
  const ch = chapters.find((c) => c.id === stage.chapter)
  return (
    <header className="mb-8 border-b border-edge pb-6">
      <div className="flex items-center gap-2 font-mono text-[0.62rem] tracking-widest uppercase">
        <span className="text-accent">stage {String(stage.n).padStart(2, '0')}</span>
        <span className="text-ink-faint/50">/</span>
        <span className="text-ink-faint">{ch?.title}</span>
      </div>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{stage.title}</h1>
      <p className="mt-2 max-w-2xl text-[0.95rem] leading-relaxed text-ink-dim">{stage.hook}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {stage.concepts.map((c) => (
          <span
            key={c}
            className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[0.65rem] text-ink-faint ring-1 ring-edge"
          >
            {c}
          </span>
        ))}
      </div>
    </header>
  )
}

export default function Shell({ children }) {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  const idx = stages.findIndex((s) => `/stage/${s.slug}` === pathname)
  const progress = idx >= 0 ? ((idx + 1) / stages.length) * 100 : 0

  return (
    <div className="relative min-h-screen">
      <div
        className="fixed top-0 left-0 z-50 h-[2px] bg-accent transition-all duration-500"
        style={{ width: `${progress}%` }}
      />
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed top-3 left-3 z-50 rounded-md border border-edge bg-panel px-2.5 py-1.5 font-mono text-xs text-ink-dim lg:hidden"
      >
        ☰ menu
      </button>
      <main className="relative z-10 lg:pl-[264px]">
        <div className="mx-auto max-w-3xl px-5 py-14 sm:px-8 lg:py-16">{children}</div>
      </main>
    </div>
  )
}
