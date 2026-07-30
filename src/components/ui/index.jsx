import { useEffect } from 'react'

/*
 * Shared chrome, in the Modernist language: square corners, 2px rules between
 * major blocks and 1px between cells, flush-left labels, and mono micro-labels
 * in place of decorative borders. Nothing floats — no shadows, no blur.
 */

/** The mono micro-label used throughout the system for kickers and axis labels. */
const MICRO = 'font-mono text-[10px] tracking-[0.14em] uppercase'

export function Card({ children, className = '' }) {
  return <div className={`border-2 border-edge bg-panel ${className}`}>{children}</div>
}

export function Code({ children }) {
  return (
    <code className="bg-neutral-200 px-1.5 py-0.5 font-mono text-[0.85em] text-accent-700">
      {children}
    </code>
  )
}

const CALLOUT_STYLES = {
  note: { label: 'Note' },
  key: { label: 'Key idea' },
  gotcha: { label: 'Gotcha' },
}

/**
 * `key` gets the accent bar — the system's way of marking the one idea a section
 * turns on. `note` and `gotcha` get the 2px box.
 */
export function Callout({ kind = 'note', title, children }) {
  const s = CALLOUT_STYLES[kind] ?? CALLOUT_STYLES.note
  const bar = kind === 'key'
  return (
    <div
      className={bar ? 'my-7 border-l-4 border-accent pl-[18px]' : 'my-7 border-2 border-edge p-5'}
    >
      <div className={`${MICRO} mb-2 text-accent-700`}>{title ?? s.label}</div>
      <div className="text-[15px] leading-[1.6] text-ink-dim [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
        {children}
      </div>
    </div>
  )
}

export function CodeBlock({ code, lang = 'python', caption }) {
  return (
    <figure className="my-7">
      <div className="border-2 border-ink">
        <div
          className={`${MICRO} flex items-center justify-between gap-4 bg-ink px-3.5 py-2 text-surface`}
        >
          <span>{lang}</span>
        </div>
        <pre className="scroll-x bg-neutral-900 px-4 py-4 text-[13px] leading-[1.7] text-surface">
          <code className="font-mono">{code.trim()}</code>
        </pre>
      </div>
      {caption && (
        <figcaption className="mt-3 text-[13px] leading-[1.55] text-neutral-700">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}

/**
 * A figure from the original blog post, with attribution.
 *
 * Deliberately NOT wrapped in Modernist's `.grayscale` treatment: the system
 * asks for photographs in pure black and white, but these are Aleksa Gordić's
 * diagrams and their colour carries the meaning.
 */
export function BlogFigure({ src, caption, max = 720 }) {
  return (
    <figure className="my-7">
      <div className="border-2 border-edge bg-white p-3">
        <img
          src={`${import.meta.env.BASE_URL}img/${src}`}
          alt={caption}
          loading="lazy"
          className="mx-auto h-auto w-full"
          style={{ maxWidth: max }}
        />
      </div>
      <figcaption className="mt-3 text-[13px] leading-[1.55] text-neutral-700">
        {caption} <span className="text-neutral-600">— diagram by Aleksa Gordić</span>
      </figcaption>
    </figure>
  )
}

/** Outlined label — the system's tag. */
export function Badge({ children, tone = 'neutral' }) {
  const tones = {
    neutral: { border: 'var(--color-divider)', text: 'var(--color-neutral-700)' },
    prefill: { border: 'var(--color-accent)', text: 'var(--color-accent-700)' },
    decode: { border: 'var(--color-neutral-900)', text: 'var(--color-neutral-900)' },
    good: { border: 'var(--color-ink)', text: 'var(--color-ink)' },
    warn: { border: 'var(--color-accent-700)', text: 'var(--color-accent-700)' },
    bad: { border: 'var(--color-accent)', text: 'var(--color-accent-700)' },
  }
  const t = tones[tone] ?? tones.neutral
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-[3px] font-mono text-[11px]"
      style={{ border: `1px solid ${t.border}`, color: t.text }}
    >
      {children}
    </span>
  )
}

/*
 * Metrics. The system shows a number as a large display figure over a mono
 * label, in a row of equal cells divided by rules — not as a set of boxes.
 * StatRow draws the rules; StatTile is one cell.
 */
const STAT_COLS = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-5',
}

export function StatRow({ children, cols = 4, className = '' }) {
  return (
    <div
      className={`grid border-t border-l border-edge ${STAT_COLS[cols] ?? STAT_COLS[4]} ${className}`}
    >
      {children}
    </div>
  )
}

export function StatTile({ label, value, unit, tone = 'neutral', hint }) {
  const colors = {
    neutral: 'text-ink',
    good: 'text-ink',
    warn: 'text-accent-700',
    bad: 'text-accent',
    accent: 'text-accent',
  }
  return (
    <div className="border-r border-b border-edge px-4 py-3.5" title={hint}>
      <div
        className={`text-[26px] leading-none font-[900] tracking-[-0.02em] tabular-nums ${colors[tone]}`}
      >
        {value}
        {unit && <span className="text-[13px] font-[700] text-neutral-600">{unit}</span>}
      </div>
      <div className={`${MICRO} mt-1.5 text-neutral-600`}>{label}</div>
    </div>
  )
}

export function Legend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {items.map((it) => (
        <span
          key={it.label}
          className="flex items-center gap-2 font-mono text-[10px] text-neutral-700"
        >
          <span
            className="inline-block h-2.5 w-2.5 shrink-0"
            style={{ background: it.color, boxShadow: 'inset 0 0 0 1px var(--color-divider)' }}
          />
          {it.label}
        </span>
      ))}
    </div>
  )
}

/**
 * Slider or segmented control, driven by a sim's declared param spec.
 * Segmented options fill their row and label flush left, per the system.
 */
export function Knob({ spec, value, onChange }) {
  if (spec.options) {
    return (
      <label className="flex flex-col gap-2">
        <span className={`${MICRO} text-neutral-600`}>{spec.label}</span>
        <div className="flex border border-edge">
          {spec.options.map((opt) => {
            const v = opt.value ?? opt
            const l = opt.label ?? opt
            const active = v === value
            return (
              <button
                key={String(v)}
                onClick={() => onChange(v)}
                className={`flex-1 px-3 py-1.5 text-left font-mono text-[12px] font-bold transition-colors ${
                  active
                    ? 'bg-ink text-surface'
                    : 'text-neutral-700 hover:bg-accent-100 hover:text-ink'
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
    <label className="flex flex-col gap-2">
      <span className={`${MICRO} flex items-baseline justify-between gap-3 text-neutral-600`}>
        {spec.label}
        <span className="font-mono text-[13px] font-bold tracking-normal text-ink normal-case tabular-nums">
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
        className="h-1.5 w-full cursor-pointer bg-neutral-300 accent-[color:var(--color-accent)]"
      />
    </label>
  )
}

/**
 * The transport. A divided row of flush-left buttons filling the full width,
 * with the primary action carrying the accent as a field.
 */
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

  const cell =
    'border-r border-edge px-4 py-3 text-left font-[700] text-[13.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div className="flex flex-wrap items-stretch">
      <button
        onClick={sim.step}
        disabled={sim.done}
        className={`${cell} flex-1 bg-accent text-surface hover:bg-accent-600 active:bg-accent-700`}
      >
        ▶ Step
      </button>
      <button
        onClick={sim.toggle}
        disabled={sim.done}
        className={`${cell} flex-1 text-ink hover:bg-accent-100`}
      >
        {sim.playing ? '❚❚ Pause' : '▶ Run'}
      </button>
      <button
        onClick={sim.back}
        disabled={!sim.canBack}
        title="Step back"
        className={`${cell} text-ink hover:bg-accent-100`}
      >
        ◀
      </button>
      <button
        onClick={sim.toEnd}
        disabled={sim.done}
        title="Run to completion"
        className={`${cell} text-ink hover:bg-accent-100`}
      >
        ▶▶
      </button>
      <button
        onClick={sim.reset}
        className={`${cell} text-neutral-700 hover:bg-accent-100 hover:text-ink`}
      >
        ↺ Reset
      </button>
      <div className="flex items-stretch border-r border-edge">
        {sim.speeds.map((s) => (
          <button
            key={s}
            onClick={() => sim.setSpeed(s)}
            className={`px-2.5 font-mono text-[11px] transition-colors ${
              sim.speed === s
                ? 'bg-ink text-surface'
                : 'text-neutral-600 hover:bg-accent-100 hover:text-ink'
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
      <span className="flex items-center px-4 font-mono text-[11px] text-neutral-600 tabular-nums">
        step {String(sim.tick).padStart(2, '0')}
        {sim.done && <span className="ml-2 text-accent-700">done</span>}
      </span>
    </div>
  )
}

/** The knobs block shared by SimFrame and SimPanel. */
function KnobBank({ sim, knobs }) {
  const knobKeys = knobs ?? Object.keys(sim.paramSpec)
  if (knobKeys.length === 0) return null
  return (
    <div className="grid gap-5 border-b-2 border-edge px-5 py-4 sm:grid-cols-2">
      {knobKeys.map((k) => (
        <Knob
          key={k}
          spec={sim.paramSpec[k]}
          value={sim.params[k]}
          onChange={(v) => sim.setParam(k, v)}
        />
      ))}
    </div>
  )
}

/**
 * A simulator sitting inline in the prose — used for a stage's *secondary*
 * simulators. The stage's primary one goes in the sticky pane instead, via
 * SimPanel.
 */
export function SimFrame({ sim, title, subtitle, legend, knobs, keys = false, children, footer }) {
  return (
    <div className="my-8 border-2 border-edge bg-surface">
      <div className="border-b-2 border-edge px-5 py-4">
        <div className="flex items-baseline gap-2.5">
          <span className={`${MICRO} text-accent-700`}>simulator</span>
          <h4 className="text-[15px] font-[800] tracking-[-0.01em]">{title}</h4>
        </div>
        {subtitle && <p className="mt-2 text-[13px] leading-[1.55] text-neutral-700">{subtitle}</p>}
      </div>

      <KnobBank sim={sim} knobs={knobs} />

      <div className="px-5 py-5">{children}</div>

      {legend && (
        <div className="border-t border-edge px-5 py-3">
          <Legend items={legend} />
        </div>
      )}

      <div className="border-t-2 border-edge">
        <StepControls sim={sim} keys={keys} />
      </div>

      {footer && (
        <div className="border-t border-edge px-5 py-4 text-[13px] leading-[1.6] text-neutral-700">
          {footer}
        </div>
      )}
    </div>
  )
}

/**
 * A stage's primary simulator, as it appears in the sticky right-hand pane.
 * Full-bleed: the pane's own rules bound it, so it carries no outer border.
 * `right` is where StageLayout injects the focus toggle.
 */
export function SimPanel({
  sim,
  title,
  subtitle,
  legend,
  knobs,
  keys = false,
  children,
  footer,
  right,
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b-2 border-edge px-6 py-3.5">
        <div className="min-w-0">
          <div className={`${MICRO} text-neutral-600`}>simulator</div>
          <div className="truncate text-[15px] font-[800] tracking-[-0.01em]">{title}</div>
        </div>
        {right}
      </div>

      {subtitle && (
        <div className="border-b border-edge px-6 py-3.5">
          <p className="text-[13px] leading-[1.55] text-neutral-700">{subtitle}</p>
        </div>
      )}

      <KnobBank sim={sim} knobs={knobs} />

      <div className="px-6 py-5">{children}</div>

      {legend && (
        <div className="border-t border-edge px-6 py-3">
          <Legend items={legend} />
        </div>
      )}

      <div className="border-y-2 border-edge">
        <StepControls sim={sim} keys={keys} />
      </div>

      {footer && (
        <div className="px-6 py-4 text-[13px] leading-[1.6] text-neutral-700">{footer}</div>
      )}
    </div>
  )
}

export function Takeaways({ items }) {
  return (
    <div className="my-9 border-t-2 border-edge pt-6">
      <div className={`${MICRO} mb-4 text-accent-700`}>Takeaways</div>
      <div className="grid gap-4">
        {items.map((t, i) => (
          <div key={i} className="grid grid-cols-[30px_1fr] gap-3">
            <span className="font-mono text-[12px] text-neutral-600">
              {String(i + 1).padStart(2, '0')}
            </span>
            <p className="m-0 text-[15px] leading-[1.55]">{t}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
