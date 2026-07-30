import { useEffect } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { source, stages } from '../../content/roadmap'

/*
 * Site chrome. A 60px sticky header over a 38px stage tick strip — 99px of
 * total chrome, which is the offset the sticky simulator pane sticks to.
 *
 * This replaces the old 264px sidebar. What the sidebar gave that the strip
 * doesn't is a permanently visible list of stage *titles*; the strip carries
 * numbers plus a title tooltip, and the map page at `/` is a complete index one
 * click away.
 */

export const CHROME_H = 99

const MICRO = 'font-mono text-[10px] tracking-[0.14em] uppercase'

function Header() {
  const { pathname } = useLocation()
  const onStage = pathname.includes('/stage/')
  const current = stages.findIndex((s) => `/stage/${s.slug}` === pathname)

  const navCell =
    'flex h-[60px] items-center border-l border-edge px-[18px] text-[13px] font-[600] text-ink transition-colors hover:bg-accent-100'

  return (
    <header className="sticky top-0 z-20 bg-surface">
      <div className="flex items-stretch justify-between gap-5 border-b-2 border-edge">
        <Link to="/" className="flex items-baseline gap-[9px] px-[18px] sm:px-8">
          <span className="mt-auto mb-[5px] inline-block h-3 w-3 bg-accent" />
          <span className="self-center text-[15px] font-[800] tracking-[-0.01em]">Inside vLLM</span>
          <span className={`${MICRO} hidden self-center text-neutral-600 sm:inline`}>
            interactive
          </span>
        </Link>
        <nav className="flex items-stretch">
          <NavLink to="/" end className={navCell}>
            The map
          </NavLink>
          <NavLink to={`/stage/${stages[Math.max(0, current)].slug}`} className={navCell}>
            Stages
          </NavLink>
          <a href={source.url} target="_blank" rel="noreferrer" className={navCell}>
            Source post ↗
          </a>
        </nav>
      </div>

      {onStage && (
        <div className="scroll-x flex h-[38px] items-stretch border-b-2 border-edge">
          <div
            className={`${MICRO} flex flex-none items-center border-r border-edge pr-3.5 pl-[18px] text-neutral-600 sm:pl-8`}
          >
            stage
          </div>
          {stages.map((s, i) => (
            <Link
              key={s.slug}
              to={`/stage/${s.slug}`}
              title={s.title}
              className={`flex flex-1 items-center border-r border-edge px-2.5 font-mono text-[11px] font-[600] whitespace-nowrap transition-colors ${
                i === current
                  ? 'bg-accent text-surface'
                  : 'text-neutral-700 hover:bg-accent-100 hover:text-ink'
              }`}
              style={{ flexBasis: 42 }}
            >
              {String(s.n).padStart(2, '0')}
            </Link>
          ))}
        </div>
      )}
    </header>
  )
}

export default function Shell({ children }) {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="min-h-screen bg-surface">
      <Header />
      {children}
    </div>
  )
}
