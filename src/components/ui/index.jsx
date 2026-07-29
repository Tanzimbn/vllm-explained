import { useEffect } from 'react'

export function Card({ children, className = '' }) {
  return (
    <div
      className={`rounded-xl border border-edge bg-panel/70 backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  )
}

export function Code({ children }) {
  return (
    <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[0.85em] text-accent ring-1 ring-edge">
      {children}
    </code>
  )
}

const CALLOUT_STYLES = {
  note: { ring: 'ring-edge-bright', label: 'Note', tone: 'text-ink-dim' },
  key: { ring: 'ring-accent-dim', label: 'Key idea', tone: 'text-ink' },
  gotcha: { ring: 'ring-[color:var(--color-warn)]/40', label: 'Gotcha', tone: 'text-ink-dim' },
}

export function Callout({ kind = 'note', title, children }) {
  const s = CALLOUT_STYLES[kind] ?? CALLOUT_STYLES.note
  return (
    <div className={`my-5 rounded-lg bg-panel-2/60 p-4 ring-1 ${s.ring}`}>
      <div className="mb-1.5 font-mono text-[0.68rem] tracking-widest text-ink-faint uppercase">
        {title ?? s.label}
      </div>
      <div className={`text-sm leading-relaxed ${s.tone} [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0`}>
        {children}
      </div>
    </div>
  )
}

export function CodeBlock({ code, lang = 'python', caption }) {
  return (
    <figure className="my-5">
      <div className="overflow-hidden rounded-lg border border-edge bg-[#08090d]">
        <div className="flex items-center justify-between border-b border-edge px-3 py-1.5">
          <span className="font-mono text-[0.65rem] tracking-widest text-ink-faint uppercase">
            {lang}
          </span>
        </div>
        <pre className="scroll-x px-4 py-3 text-[0.78rem] leading-relaxed">
          <code className="font-mono text-ink-dim">{code.trim()}</code>
        </pre>
      </div>
      {caption && (
        <figcaption className="mt-2 text-xs text-ink-faint">{caption}</figcaption>
      )}
    </figure>
  )
}

/** A figure from the original blog post, with attribution. */
export function BlogFigure({ src, caption, max = 720 }) {
  return (
    <figure className="my-6">
      <div className="overflow-hidden rounded-lg border border-edge bg-white/95 p-2">
        <img
          src={`/img/${src}`}
          alt={caption}
          loading="lazy"
          className="mx-auto h-auto w-full"
          style={{ maxWidth: max }}
        />
      </div>
      <figcaption className="mt-2 text-xs text-ink-faint">
        {caption} <span className="text-ink-faint/60">— diagram by Aleksa Gordić</span>
      </figcaption>
    </figure>
  )
}

export function Badge({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-panel-2 text-ink-dim ring-edge',
    prefill: 'bg-[color:var(--color-prefill)]/15 text-[color:var(--color-prefill)] ring-[color:var(--color-prefill)]/30',
    decode: 'bg-[color:var(--color-decode)]/15 text-[color:var(--color-decode)] ring-[color:var(--color-decode)]/30',
    good: 'bg-[color:var(--color-good)]/15 text-[color:var(--color-good)] ring-[color:var(--color-good)]/30',
    warn: 'bg-[color:var(--color-warn)]/15 text-[color:var(--color-warn)] ring-[color:var(--color-warn)]/30',
    bad: 'bg-[color:var(--color-bad)]/15 text-[color:var(--color-bad)] ring-[color:var(--color-bad)]/30',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[0.68rem] ring-1 ${tones[tone] ?? tones.neutral}`}
    >
      {children}
    </span>
  )
}

export function StatTile({ label, value, unit, tone = 'neutral', hint }) {
  const colors = {
    neutral: 'text-ink',
    good: 'text-[color:var(--color-good)]',
    warn: 'text-[color:var(--color-warn)]',
    bad: 'text-[color:var(--color-bad)]',
    accent: 'text-accent',
  }
  return (
    <div className="rounded-lg border border-edge bg-panel-2/50 px-3 py-2" title={hint}>
      <div className="font-mono text-[0.62rem] tracking-widest text-ink-faint uppercase">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-lg leading-tight tabular-nums ${colors[tone]}`}>
        {value}
        {unit && <span className="ml-0.5 text-xs text-ink-faint">{unit}</span>}
      </div>
    </div>
  )
}

export function Legend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-[0.7rem] text-ink-dim">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px] ring-1 ring-inset ring-white/15"
            style={{ background: it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  )
}

/** Slider or segmented control, driven by a sim's declared param spec. */
export function Knob({ spec, value, onChange }) {
  if (spec.options) {
    return (
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[0.62rem] tracking-widest text-ink-faint uppercase">
          {spec.label}
        </span>
        <div className="flex overflow-hidden rounded-md border border-edge">
          {spec.options.map((opt) => {
            const v = opt.value ?? opt
            const l = opt.label ?? opt
            const active = v === value
            return (
              <button
                key={String(v)}
                onClick={() => onChange(v)}
                className={`px-2.5 py-1 font-mono text-[0.7rem] transition-colors ${
                  active
                    ? 'bg-accent/20 text-accent'
                    : 'text-ink-faint hover:bg-panel-2 hover:text-ink-dim'
                }`}
              >
                {l}
              </button>
            )
          })}
        </div>
      </label>
    )
  }
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-3 font-mono text-[0.62rem] tracking-widest text-ink-faint uppercase">
        {spec.label}
        <span className="text-[0.72rem] normal-case tracking-normal text-ink tabular-nums">
          {value}
          {spec.unit ?? ''}
        </span>
      </span>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step ?? 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-edge accent-[color:var(--color-accent)] [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
      />
    </label>
  )
}

const btn =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 font-mono text-[0.7rem] text-ink-dim transition-colors hover:border-edge-bright hover:text-ink disabled:cursor-not-allowed disabled:opacity-35'

export function StepControls({ sim, keys = false }) {
  useEffect(() => {
    if (!keys) return
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        sim.toggle()
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        sim.step()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        sim.back()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keys, sim])

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={sim.toggle}
        disabled={sim.done}
        className={`${btn} min-w-[5.2rem] border-accent-dim/60 bg-accent/10 text-accent hover:border-accent hover:text-accent`}
      >
        {sim.playing ? '❚❚ pause' : '▶ play'}
      </button>
      <button onClick={sim.back} disabled={!sim.canBack} className={btn} title="Step back">
        ◀ back
      </button>
      <button onClick={sim.step} disabled={sim.done} className={btn} title="Step forward">
        step ▶
      </button>
      <button onClick={sim.toEnd} disabled={sim.done} className={btn} title="Run to completion">
        ▶▶ end
      </button>
      <button onClick={sim.reset} className={btn}>
        ↺ reset
      </button>
      <div className="ml-1 flex overflow-hidden rounded-md border border-edge">
        {sim.speeds.map((s) => (
          <button
            key={s}
            onClick={() => sim.setSpeed(s)}
            className={`px-1.5 py-1 font-mono text-[0.65rem] transition-colors ${
              sim.speed === s ? 'bg-accent/20 text-accent' : 'text-ink-faint hover:text-ink-dim'
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
      <span className="ml-auto font-mono text-[0.68rem] text-ink-faint tabular-nums">
        step {sim.tick}
        {sim.done && <span className="ml-2 text-[color:var(--color-good)]">done</span>}
      </span>
    </div>
  )
}

/**
 * Standard chrome around every simulator: title, knobs, controls, legend.
 * `children` renders the sim's own visualization.
 */
export function SimFrame({ sim, title, subtitle, legend, knobs, keys = false, children, footer }) {
  const knobKeys = knobs ?? Object.keys(sim.paramSpec)
  return (
    <Card className="my-6 overflow-hidden">
      <div className="border-b border-edge px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[0.62rem] tracking-widest text-accent uppercase">
            simulator
          </span>
          <h4 className="text-sm font-semibold text-ink">{title}</h4>
        </div>
        {subtitle && <p className="mt-1 text-xs leading-relaxed text-ink-faint">{subtitle}</p>}
      </div>

      {knobKeys.length > 0 && (
        <div className="grid gap-4 border-b border-edge bg-panel-2/30 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
          {knobKeys.map((k) => (
            <Knob
              key={k}
              spec={sim.paramSpec[k]}
              value={sim.params[k]}
              onChange={(v) => sim.setParam(k, v)}
            />
          ))}
        </div>
      )}

      <div className="px-4 py-4">{children}</div>

      {legend && (
        <div className="border-t border-edge px-4 py-2.5">
          <Legend items={legend} />
        </div>
      )}

      <div className="border-t border-edge bg-panel-2/30 px-4 py-2.5">
        <StepControls sim={sim} keys={keys} />
      </div>

      {footer && (
        <div className="border-t border-edge px-4 py-3 text-xs leading-relaxed text-ink-faint">
          {footer}
        </div>
      )}
    </Card>
  )
}

export function Takeaways({ items }) {
  return (
    <div className="my-8 rounded-xl border border-accent-dim/30 bg-accent/[0.04] p-5">
      <div className="mb-2.5 font-mono text-[0.65rem] tracking-widest text-accent uppercase">
        Takeaways
      </div>
      <ul className="space-y-2">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink-dim">
            <span className="mt-0.5 font-mono text-[0.7rem] text-accent/60">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
