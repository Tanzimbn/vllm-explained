/**
 * Reusable visualization primitives.
 * Every stage composes these rather than inventing its own markup, so the
 * meaning of a colour or a shape stays constant across the whole site.
 *
 * Modernist rules apply here as much as to the chrome: square corners, 1px
 * divider rules instead of rings and shadows, and structure shown by the grid
 * rather than by boxes floating on a wash.
 */

export const C = {
  bg: 'var(--color-surface)',
  panel: 'var(--color-panel)',
  panel2: 'var(--color-panel-2)',
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
  divider: 'var(--color-divider)',
  edge: 'var(--color-edge)',
  ink: 'var(--color-ink)',
  dim: 'var(--color-ink-dim)',
  faint: 'var(--color-ink-faint)',

  n200: 'var(--color-neutral-200)',
  n300: 'var(--color-neutral-300)',
  n400: 'var(--color-neutral-400)',
  n500: 'var(--color-neutral-500)',
  n700: 'var(--color-neutral-700)',
  n900: 'var(--color-neutral-900)',
  a100: 'var(--color-accent-100)',
  a200: 'var(--color-accent-200)',
  a300: 'var(--color-accent-300)',
  a400: 'var(--color-accent-400)',
  a700: 'var(--color-accent-700)',
}

/**
 * The text colour that belongs on a given fill.
 *
 * On a light ground some role fills are dark (wanting light text) and some are
 * light (wanting ink), and the call site can't tell which — the values are CSS
 * variables. Each role therefore declares its own `-ink` companion in
 * index.css, and reqColor's hsl() output is read directly for lightness.
 */
const FILL_INK = {
  [C.prefill]: 'var(--color-prefill-ink)',
  [C.decode]: 'var(--color-decode-ink)',
  [C.free]: 'var(--color-free-ink)',
  [C.alloc]: 'var(--color-alloc-ink)',
  [C.cached]: 'var(--color-cached-ink)',
  [C.partial]: 'var(--color-partial-ink)',
  [C.good]: 'var(--color-good-ink)',
  [C.warn]: 'var(--color-warn-ink)',
  [C.bad]: 'var(--color-bad-ink)',
  [C.accent]: 'var(--color-surface)',
  [C.n900]: 'var(--color-surface)',
  [C.n700]: 'var(--color-surface)',
  [C.ink]: 'var(--color-surface)',
}

export function inkOn(fill, fallback = C.ink) {
  if (FILL_INK[fill]) return FILL_INK[fill]
  const m = /hsl\(\s*[\d.]+\s+[\d.]+%\s+([\d.]+)%/.exec(fill ?? '')
  if (m) return Number(m[1]) > 58 ? C.ink : C.bg
  return fallback
}

/**
 * Stable per-request colour, so request #2 looks the same in every sim.
 *
 * Modernist is a mono system, but identity is the one job a single accent can't
 * do: a block grid with five owners needs five separable fills at once. The hue
 * order is unchanged from the dark theme (request identity must not shuffle
 * between stages); saturation and lightness are pulled down so the set reads as
 * one muted, printed-ink family on the light ground.
 */
const REQ_HUES = [200, 28, 150, 280, 340, 95, 250, 15, 175, 315]
export function reqColor(i, { light = false } = {}) {
  const h = REQ_HUES[i % REQ_HUES.length]
  return light ? `hsl(${h} 34% 74%)` : `hsl(${h} 38% 42%)`
}

/** The text colour that belongs on top of reqColor(i). */
export function reqInk(i, opts) {
  return inkOn(reqColor(i, opts))
}

/* ------------------------------------------------------------------ BlockGrid */

/**
 * A grid of physical KV-cache blocks.
 * blocks: [{ state: 'free'|'alloc'|'cached'|'partial', owner?, label?, refs?, glyph? }]
 *
 * Drawn as a seamless ruled grid — rules on the container's top/left and each
 * cell's right/bottom — so the blocks read as one table rather than as a set of
 * floating tiles.
 */
export function BlockGrid({ blocks, cols = 16, size = 26, showIndex = false, onHover }) {
  return (
    <div className="scroll-x">
      <div
        className="grid w-max border-t border-l border-edge"
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
          return (
            <div
              key={i}
              onMouseEnter={onHover ? () => onHover(i) : undefined}
              title={b.title ?? `block ${i} — ${b.state}`}
              className="relative flex items-center justify-center border-r border-b border-edge font-mono text-[0.58rem] transition-colors duration-200"
              style={{ height: size, background: bg, color: inkOn(bg) }}
            >
              {b.glyph ?? (showIndex ? i : '')}
              {b.refs > 1 && (
                <span
                  className="absolute top-0 right-0 flex h-3 w-3 items-center justify-center bg-accent text-[0.5rem] font-bold text-surface"
                  title={`refcount ${b.refs}`}
                >
                  {b.refs}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ QueueLane */

/** A horizontal lane of request chips — used for waiting/running queues. */
export function QueueLane({ label, items, empty = 'empty', accent, right }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-20 shrink-0 pt-1 text-right">
        <div
          className="font-mono text-[0.62rem] tracking-wider uppercase"
          style={{ color: accent ?? C.faint }}
        >
          {label}
        </div>
        <div className="font-mono text-[0.6rem] text-ink-faint tabular-nums">{items.length}</div>
      </div>
      <div className="scroll-x flex min-h-8 flex-1 flex-wrap items-center gap-1.5 border border-dashed border-edge px-2 py-1.5">
        {items.length === 0 ? (
          <span className="font-mono text-[0.65rem] text-ink-faint">{empty}</span>
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
      className="inline-flex items-center gap-1 px-1.5 py-1 font-mono text-[0.65rem] transition-all duration-200"
      style={{
        background: dim ? 'transparent' : bg,
        color: dim ? bg : inkOn(bg),
        boxShadow: `inset 0 0 0 1px ${bg}`,
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
      <div className="overflow-hidden bg-neutral-300" style={{ height }}>
        <div
          className="h-full transition-all duration-300"
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
      <div className="flex overflow-hidden bg-neutral-300" style={{ height }}>
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
    <div className={`flex ${wrap ? 'flex-wrap' : 'scroll-x'} items-end`} style={{ gap }}>
      {tokens.map((t, i) => (
        <div key={i} className="flex flex-col items-center" style={{ minWidth: size }}>
          <div
            className={`flex items-center justify-center px-1 transition-colors duration-200 ${
              mono ? 'font-mono' : ''
            }`}
            style={{
              height: size,
              minWidth: size,
              background: t.dim ? 'transparent' : (t.color ?? C.free),
              boxShadow: `inset 0 0 0 1px ${t.dim ? (t.color ?? C.edge) : C.divider}`,
              color: t.dim ? (t.color ?? C.faint) : inkOn(t.color ?? C.free),
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
  wait: C.n300,
  prefill: C.prefill,
  decode: C.decode,
  preempt: C.bad,
  hit: C.cached,
  done: C.n500,
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
                  className="transition-colors duration-200"
                  style={{
                    width: cell,
                    height: cell,
                    background: c.color ?? CELL_COLOR[c.kind] ?? 'transparent',
                    boxShadow: c.kind === 'idle' ? `inset 0 0 0 1px ${C.divider}` : undefined,
                    outline: cursor === i ? `1px solid ${C.accent}` : undefined,
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
      <div className="flex items-end gap-1.5 border-b border-edge" style={{ height }}>
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
                className="w-full transition-all duration-300"
                style={{
                  height: h,
                  background: b.color ?? C.decode,
                  opacity: b.muted ? 0.28 : 1,
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
  const xs = series.flatMap((s) => s.points.map((p) => p[0])).filter(Number.isFinite)
  const ys = series.flatMap((s) => s.points.map((p) => p[1])).filter(Number.isFinite)
  // An empty or all-NaN series would otherwise put Infinity through px()/py()
  // and emit NaN into every x/cx attribute in the chart.
  const x0 = xs.length ? Math.min(...xs) : 0
  const x1 = xs.length ? Math.max(...xs) : 1
  const y0 = 0
  const y1 = (ys.length ? Math.max(...ys) : 0) * 1.08 || 1
  const px = (x) =>
    pad.l + ((Number.isFinite(x) ? x - x0 : 0) / (x1 - x0 || 1)) * (width - pad.l - pad.r)
  const py = (y) =>
    height - pad.b - ((Number.isFinite(y) ? y - y0 : 0) / (y1 - y0 || 1)) * (height - pad.t - pad.b)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: height * 1.4 }}>
      {/* frame */}
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={height - pad.b} stroke={C.ink} strokeWidth="1.5" />
      <line
        x1={pad.l}
        y1={height - pad.b}
        x2={width - pad.r}
        y2={height - pad.b}
        stroke={C.ink}
        strokeWidth="1.5"
      />
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line
            x1={pad.l}
            y1={py(t)}
            x2={width - pad.r}
            y2={py(t)}
            stroke={C.n300}
            strokeDasharray="2 4"
          />
          <text
            x={pad.l - 6}
            y={py(t) + 3}
            textAnchor="end"
            fontSize="8"
            fill={C.faint}
            fontFamily="ui-monospace"
          >
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
          <line
            x1={px(m.x)}
            y1={pad.t}
            x2={px(m.x)}
            y2={height - pad.b}
            stroke={m.color ?? C.warn}
            strokeDasharray="4 3"
          />
          <text
            x={px(m.x) + 4}
            y={pad.t + 9}
            fontSize="8"
            fill={m.color ?? C.warn}
            fontFamily="ui-monospace"
          >
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
            <rect
              x={px(s.dot[0]) - 3.5}
              y={py(s.dot[1]) - 3.5}
              width="7"
              height="7"
              fill={s.color ?? C.decode}
            />
          )}
        </g>
      ))}
      {xLabel && (
        <text
          x={(width + pad.l) / 2}
          y={height - 4}
          textAnchor="middle"
          fontSize="8.5"
          fill={C.faint}
          fontFamily="ui-monospace"
        >
          {xLabel}
        </text>
      )}
      {yLabel && (
        <text
          x={11}
          y={height / 2}
          textAnchor="middle"
          fontSize="8.5"
          fill={C.faint}
          fontFamily="ui-monospace"
          transform={`rotate(-90 11 ${height / 2})`}
        >
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
        <marker
          id="ng-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={C.n500} />
        </marker>
        <marker
          id="ng-arrow-hot"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={C.accent} />
        </marker>
      </defs>

      {groups.map((g) => (
        <g key={g.label}>
          <rect
            x={g.x}
            y={g.y}
            width={g.w}
            height={g.h}
            fill="none"
            stroke={C.divider}
            strokeDasharray="4 4"
          />
          <text
            x={g.x + 8}
            y={g.y + 14}
            fontSize="8.5"
            fill={C.faint}
            fontFamily="ui-monospace"
            letterSpacing="1"
          >
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
              stroke={hot ? C.accent : C.n400}
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
              fill={on ? C.accent : C.panel}
              stroke={on ? C.accent : (n.stroke ?? C.divider)}
              strokeWidth={on ? 2 : 1}
            />
            <text
              x={n.x + (n.w ?? 120) / 2}
              y={n.y + (n.sub ? 17 : (n.h ?? 40) / 2 + 3)}
              textAnchor="middle"
              fontSize="9.5"
              fontFamily="ui-monospace"
              fill={on ? C.bg : C.ink}
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
                fill={on ? C.a200 : C.faint}
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
