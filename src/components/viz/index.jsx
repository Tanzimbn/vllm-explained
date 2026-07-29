/**
 * Reusable visualization primitives.
 * Every stage composes these rather than inventing its own markup, so the
 * meaning of a colour or a shape stays constant across the whole site.
 */

export const C = {
  accent: 'var(--color-accent)',
  free: 'var(--color-free)',
  alloc: 'var(--color-alloc)',
  cached: 'var(--color-cached)',
  partial: 'var(--color-partial)',
  prefill: 'var(--color-prefill)',
  decode: 'var(--color-decode)',
  good: 'var(--color-good)',
  warn: 'var(--color-warn)',
  bad: 'var(--color-bad)',
  edge: 'var(--color-edge)',
  ink: 'var(--color-ink)',
  dim: 'var(--color-ink-dim)',
  faint: 'var(--color-ink-faint)',
}

/** Stable per-request colour, so request #2 looks the same in every sim. */
const REQ_HUES = [200, 28, 150, 280, 340, 95, 250, 15, 175, 315]
export function reqColor(i, { light = false } = {}) {
  const h = REQ_HUES[i % REQ_HUES.length]
  return light ? `hsl(${h} 70% 72%)` : `hsl(${h} 62% 58%)`
}

/* ------------------------------------------------------------------ BlockGrid */

/**
 * A grid of physical KV-cache blocks.
 * blocks: [{ state: 'free'|'alloc'|'cached'|'partial', owner?, label?, refs?, glyph? }]
 */
export function BlockGrid({ blocks, cols = 16, size = 26, showIndex = false, onHover }) {
  return (
    <div
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, ${size}px))` }}
    >
      {blocks.map((b, i) => {
        const bg =
          b.state === 'free'
            ? C.free
            : b.state === 'cached'
              ? C.cached
              : b.state === 'partial'
                ? C.partial
                : (b.color ?? C.alloc)
        const dark = b.state === 'cached' || b.state === 'partial'
        return (
          <div
            key={i}
            onMouseEnter={onHover ? () => onHover(i) : undefined}
            title={b.title ?? `block ${i} — ${b.state}`}
            className="relative flex items-center justify-center rounded-[4px] font-mono text-[0.58rem] ring-1 ring-inset ring-black/25 transition-colors duration-200"
            style={{
              height: size,
              background: bg,
              color: b.state === 'free' ? C.faint : dark ? '#08090d' : '#0b0d12',
            }}
          >
            {b.glyph ?? (showIndex ? i : '')}
            {b.refs > 1 && (
              <span
                className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-[color:var(--color-warn)] text-[0.5rem] font-bold text-black"
                title={`refcount ${b.refs}`}
              >
                {b.refs}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ QueueLane */

/** A horizontal lane of request chips — used for waiting/running queues. */
export function QueueLane({ label, items, empty = 'empty', accent, right }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-20 shrink-0 pt-1 text-right">
        <div className="font-mono text-[0.62rem] tracking-wider uppercase" style={{ color: accent ?? C.faint }}>
          {label}
        </div>
        <div className="font-mono text-[0.6rem] text-ink-faint/70 tabular-nums">
          {items.length}
        </div>
      </div>
      <div className="scroll-x flex min-h-8 flex-1 flex-wrap items-center gap-1.5 rounded-md border border-dashed border-edge px-2 py-1.5">
        {items.length === 0 ? (
          <span className="font-mono text-[0.65rem] text-ink-faint/60">{empty}</span>
        ) : (
          items.map((it) => <Chip key={it.key ?? it.id} {...it} />)
        )}
      </div>
      {right}
    </div>
  )
}

export function Chip({ id, sub, color, tone, dim, glyph }) {
  const bg = color ?? (tone === 'prefill' ? C.prefill : C.decode)
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-1 font-mono text-[0.65rem] ring-1 ring-inset ring-black/30 transition-all duration-200"
      style={{
        background: dim ? 'transparent' : bg,
        color: dim ? bg : '#08090d',
        borderColor: bg,
        opacity: dim ? 0.65 : 1,
        boxShadow: dim ? `inset 0 0 0 1px ${bg}` : 'none',
      }}
      title={sub}
    >
      {glyph && <span>{glyph}</span>}
      {id}
      {sub && <span className="opacity-70">{sub}</span>}
    </span>
  )
}

/* ------------------------------------------------------------------- MeterBar */

export function MeterBar({ label, value, max, color = C.decode, sublabel, height = 8 }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[0.62rem] tracking-wider text-ink-faint uppercase">
          {label}
        </span>
        <span className="font-mono text-[0.68rem] text-ink-dim tabular-nums">
          {sublabel ?? `${value} / ${max}`}
        </span>
      </div>
      <div className="overflow-hidden rounded-full bg-edge" style={{ height }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  )
}

/** Stacked segments in one bar — e.g. prefill vs decode share of a token budget. */
export function StackedBar({ label, segments, max, height = 10, sublabel }) {
  const total = segments.reduce((a, s) => a + s.value, 0)
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[0.62rem] tracking-wider text-ink-faint uppercase">
          {label}
        </span>
        <span className="font-mono text-[0.68rem] text-ink-dim tabular-nums">
          {sublabel ?? `${total} / ${max}`}
        </span>
      </div>
      <div className="flex overflow-hidden rounded-full bg-edge" style={{ height }}>
        {segments.map((s, i) => (
          <div
            key={i}
            className="h-full transition-all duration-300"
            style={{ width: `${max > 0 ? (s.value / max) * 100 : 0}%`, background: s.color }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ TokenStrip */

/**
 * A run of tokens. Used for prompts, flattened batches, draft tokens, and
 * anything else where individual token cells carry state.
 * tokens: [{ text?, color?, state?, sub?, dim?, mark? }]
 */
export function TokenStrip({ tokens, size = 24, gap = 2, wrap = true, mono = true }) {
  return (
    <div
      className={`flex ${wrap ? 'flex-wrap' : 'scroll-x'} items-end`}
      style={{ gap }}
    >
      {tokens.map((t, i) => (
        <div key={i} className="flex flex-col items-center" style={{ minWidth: size }}>
          <div
            className={`flex items-center justify-center rounded-[3px] px-1 ring-1 ring-inset ring-black/25 transition-colors duration-200 ${mono ? 'font-mono' : ''}`}
            style={{
              height: size,
              minWidth: size,
              background: t.dim ? 'transparent' : (t.color ?? C.free),
              boxShadow: t.dim ? `inset 0 0 0 1px ${t.color ?? C.edge}` : undefined,
              color: t.dim ? (t.color ?? C.faint) : '#08090d',
              fontSize: size > 20 ? '0.62rem' : '0.55rem',
            }}
            title={t.title}
          >
            {t.text ?? ''}
          </div>
          {t.sub != null && (
            <span className="mt-0.5 font-mono text-[0.5rem] text-ink-faint tabular-nums">
              {t.sub}
            </span>
          )}
          {t.mark && (
            <span className="font-mono text-[0.6rem]" style={{ color: t.markColor ?? C.faint }}>
              {t.mark}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------- Timeline */

/**
 * Per-request horizontal timeline of engine steps.
 * rows: [{ label, cells: [{ kind: 'idle'|'prefill'|'decode'|'preempt'|'wait'|'done', title? }] }]
 */
const CELL_COLOR = {
  idle: 'transparent',
  wait: 'var(--color-edge)',
  prefill: C.prefill,
  decode: C.decode,
  preempt: C.bad,
  hit: C.cached,
  done: 'var(--color-good)',
}

export function Timeline({ rows, cell = 14, gap = 2, cursor, labelWidth = 76, axis }) {
  return (
    <div className="scroll-x">
      <div className="inline-block min-w-full">
        {axis && (
          <div className="flex items-end" style={{ gap, marginLeft: labelWidth }}>
            {axis.map((a, i) => (
              <span
                key={i}
                className="text-center font-mono text-[0.5rem] text-ink-faint tabular-nums"
                style={{ width: cell }}
              >
                {a}
              </span>
            ))}
          </div>
        )}
        {rows.map((r) => (
          <div key={r.label} className="flex items-center py-[2px]">
            <span
              className="shrink-0 pr-2 text-right font-mono text-[0.62rem] text-ink-dim"
              style={{ width: labelWidth }}
            >
              {r.label}
            </span>
            <div className="flex items-center" style={{ gap }}>
              {r.cells.map((c, i) => (
                <div
                  key={i}
                  title={c.title}
                  className="rounded-[2px] transition-colors duration-200"
                  style={{
                    width: cell,
                    height: cell,
                    background: c.color ?? CELL_COLOR[c.kind] ?? 'transparent',
                    boxShadow:
                      c.kind === 'idle' ? `inset 0 0 0 1px var(--color-edge)` : undefined,
                    outline: cursor === i ? `1px solid var(--color-accent)` : undefined,
                    outlineOffset: 1,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- DistChart */

/** Vertical bars for a probability / logit distribution. */
export function DistChart({ bars, height = 120, showValues = false }) {
  const max = Math.max(...bars.map((b) => b.value), 1e-9)
  return (
    <div className="scroll-x">
      <div className="flex items-end gap-1.5" style={{ height }}>
        {bars.map((b, i) => {
          const h = Math.max(1, (b.value / max) * (height - 22))
          return (
            <div key={i} className="flex min-w-6 flex-1 flex-col items-center justify-end gap-1">
              {showValues && (
                <span className="font-mono text-[0.5rem] text-ink-faint tabular-nums">
                  {b.value < 0.005 ? '' : b.value.toFixed(2)}
                </span>
              )}
              <div
                className="w-full rounded-t-[3px] transition-all duration-300"
                style={{
                  height: h,
                  background: b.color ?? C.decode,
                  opacity: b.muted ? 0.22 : 1,
                }}
                title={`${b.label}: ${b.value.toFixed(4)}`}
              />
              <span
                className="truncate font-mono text-[0.55rem]"
                style={{ color: b.muted ? C.faint : C.dim }}
              >
                {b.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- LineChart */

/** Minimal multi-series line chart on an SVG viewBox. */
export function LineChart({
  series,
  width = 560,
  height = 200,
  xLabel,
  yLabel,
  xTicks = [],
  yTicks = [],
  markers = [],
  pad = { l: 44, r: 12, t: 12, b: 30 },
}) {
  const xs = series.flatMap((s) => s.points.map((p) => p[0]))
  const ys = series.flatMap((s) => s.points.map((p) => p[1]))
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = 0
  const y1 = Math.max(...ys) * 1.08 || 1
  const px = (x) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (width - pad.l - pad.r)
  const py = (y) => height - pad.b - ((y - y0) / (y1 - y0 || 1)) * (height - pad.t - pad.b)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: height * 1.4 }}>
      {/* frame */}
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={height - pad.b} stroke={C.edge} />
      <line
        x1={pad.l}
        y1={height - pad.b}
        x2={width - pad.r}
        y2={height - pad.b}
        stroke={C.edge}
      />
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={pad.l} y1={py(t)} x2={width - pad.r} y2={py(t)} stroke={C.edge} strokeDasharray="2 4" />
          <text x={pad.l - 6} y={py(t) + 3} textAnchor="end" fontSize="8" fill={C.faint} fontFamily="ui-monospace">
            {t}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text
          key={`x${t}`}
          x={px(t)}
          y={height - pad.b + 12}
          textAnchor="middle"
          fontSize="8"
          fill={C.faint}
          fontFamily="ui-monospace"
        >
          {t}
        </text>
      ))}
      {markers.map((m, i) => (
        <g key={i}>
          <line x1={px(m.x)} y1={pad.t} x2={px(m.x)} y2={height - pad.b} stroke={m.color ?? C.warn} strokeDasharray="4 3" />
          <text x={px(m.x) + 4} y={pad.t + 9} fontSize="8" fill={m.color ?? C.warn} fontFamily="ui-monospace">
            {m.label}
          </text>
        </g>
      ))}
      {series.map((s) => (
        <g key={s.label}>
          <polyline
            points={s.points.map(([x, y]) => `${px(x)},${py(y)}`).join(' ')}
            fill="none"
            stroke={s.color ?? C.decode}
            strokeWidth="1.8"
            strokeDasharray={s.dashed ? '5 4' : undefined}
          />
          {s.dot != null && (
            <circle cx={px(s.dot[0])} cy={py(s.dot[1])} r="4" fill={s.color ?? C.decode} />
          )}
        </g>
      ))}
      {xLabel && (
        <text x={(width + pad.l) / 2} y={height - 4} textAnchor="middle" fontSize="8.5" fill={C.faint} fontFamily="ui-monospace">
          {xLabel}
        </text>
      )}
      {yLabel && (
        <text x={11} y={height / 2} textAnchor="middle" fontSize="8.5" fill={C.faint} fontFamily="ui-monospace" transform={`rotate(-90 11 ${height / 2})`}>
          {yLabel}
        </text>
      )}
    </svg>
  )
}

/* -------------------------------------------------------------------- NodeGraph */

/**
 * Boxes-and-arrows diagram with an active-node highlight.
 * nodes: [{ id, label, sub?, x, y, w?, h?, group? }]
 * edges: [{ from, to, label?, dashed?, bend? }]
 */
export function NodeGraph({
  nodes,
  edges,
  width = 620,
  height = 340,
  active,
  activeEdge,
  onPick,
  groups = [],
}) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const anchor = (n) => ({ cx: n.x + (n.w ?? 120) / 2, cy: n.y + (n.h ?? 40) / 2 })

  const path = (e) => {
    const a = byId[e.from]
    const b = byId[e.to]
    if (!a || !b) return ''
    const A = anchor(a)
    const B = anchor(b)
    const aw = (a.w ?? 120) / 2
    const bw = (b.w ?? 120) / 2
    const ah = (a.h ?? 40) / 2
    const bh = (b.h ?? 40) / 2
    // pick side based on dominant axis
    if (Math.abs(B.cx - A.cx) > Math.abs(B.cy - A.cy)) {
      const sx = A.cx + Math.sign(B.cx - A.cx) * aw
      const ex = B.cx - Math.sign(B.cx - A.cx) * bw
      const mx = (sx + ex) / 2
      return `M ${sx} ${A.cy} C ${mx} ${A.cy}, ${mx} ${B.cy}, ${ex} ${B.cy}`
    }
    const sy = A.cy + Math.sign(B.cy - A.cy) * ah
    const ey = B.cy - Math.sign(B.cy - A.cy) * bh
    const my = (sy + ey) / 2
    return `M ${A.cx} ${sy} C ${A.cx} ${my}, ${B.cx} ${my}, ${B.cx} ${ey}`
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      <defs>
        <marker id="ng-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={C.faint} />
        </marker>
        <marker id="ng-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent)" />
        </marker>
      </defs>

      {groups.map((g) => (
        <g key={g.label}>
          <rect
            x={g.x}
            y={g.y}
            width={g.w}
            height={g.h}
            rx="10"
            fill="rgba(255,255,255,0.018)"
            stroke={C.edge}
            strokeDasharray="4 4"
          />
          <text x={g.x + 8} y={g.y + 14} fontSize="8.5" fill={C.faint} fontFamily="ui-monospace" letterSpacing="1">
            {g.label.toUpperCase()}
          </text>
        </g>
      ))}

      {edges.map((e, i) => {
        const hot = activeEdge === `${e.from}->${e.to}`
        return (
          <g key={i}>
            <path
              d={path(e)}
              fill="none"
              stroke={hot ? 'var(--color-accent)' : C.edge}
              strokeWidth={hot ? 2 : 1.2}
              strokeDasharray={e.dashed ? '4 3' : undefined}
              markerEnd={`url(#${hot ? 'ng-arrow-hot' : 'ng-arrow'})`}
            />
          </g>
        )
      })}

      {nodes.map((n) => {
        const on = active === n.id
        return (
          <g
            key={n.id}
            onClick={onPick ? () => onPick(n.id) : undefined}
            style={{ cursor: onPick ? 'pointer' : 'default' }}
          >
            <rect
              x={n.x}
              y={n.y}
              width={n.w ?? 120}
              height={n.h ?? 40}
              rx="7"
              fill={on ? 'rgba(125,211,252,0.14)' : 'var(--color-panel-2)'}
              stroke={on ? 'var(--color-accent)' : n.stroke ?? C.edge}
              strokeWidth={on ? 1.8 : 1}
            />
            <text
              x={n.x + (n.w ?? 120) / 2}
              y={n.y + (n.sub ? 17 : (n.h ?? 40) / 2 + 3)}
              textAnchor="middle"
              fontSize="9.5"
              fontFamily="ui-monospace"
              fill={on ? 'var(--color-accent)' : C.ink}
            >
              {n.label}
            </text>
            {n.sub && (
              <text
                x={n.x + (n.w ?? 120) / 2}
                y={n.y + 30}
                textAnchor="middle"
                fontSize="7.5"
                fontFamily="ui-monospace"
                fill={C.faint}
              >
                {n.sub}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
