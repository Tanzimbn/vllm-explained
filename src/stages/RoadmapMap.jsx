import { Link } from 'react-router-dom'
import { chapters, source, stages, stagesOf } from '../content/roadmap'

function StageCard({ s }) {
  return (
    <Link
      to={`/stage/${s.slug}`}
      className="group relative block rounded-xl border border-edge bg-panel/60 p-4 transition-all hover:border-accent-dim hover:bg-panel"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[0.6rem] text-ink-faint tabular-nums">
          {String(s.n).padStart(2, '0')}
        </span>
        <span className="font-mono text-[0.58rem] text-accent/0 transition-colors group-hover:text-accent/70">
          open →
        </span>
      </div>
      <h3 className="mt-1 text-sm font-semibold text-ink">{s.title}</h3>
      <p className="mt-1 text-[0.78rem] leading-relaxed text-ink-dim">{s.hook}</p>
      <div className="mt-3 flex flex-wrap gap-1">
        {s.sims.map((sm) => (
          <span
            key={sm}
            className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[0.58rem] text-accent/80 ring-1 ring-accent-dim/30"
          >
            ▶ {sm}
          </span>
        ))}
      </div>
    </Link>
  )
}

export default function RoadmapMap() {
  return (
    <div>
      <header className="mb-12">
        <div className="font-mono text-[0.65rem] tracking-[0.2em] text-accent uppercase">
          interactive companion
        </div>
        <h1 className="mt-2 text-4xl leading-tight font-semibold tracking-tight text-ink sm:text-5xl">
          Inside vLLM
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-dim">
          An LLM inference engine is a machine full of moving parts — block allocators,
          preempting schedulers, draft models being audited by bigger models. Those are hard
          to learn from a still diagram, because the interesting part <em>is</em> the movement.
        </p>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-dim">
          So every concept here comes with a simulator you drive yourself: press{' '}
          <span className="font-mono text-accent">step</span>, watch one engine tick happen,
          turn a knob, watch it happen differently. Thirteen stages, in dependency order.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to={`/stage/${stages[0].slug}`}
            className="rounded-md border border-accent-dim bg-accent/12 px-4 py-2 font-mono text-xs text-accent transition-colors hover:bg-accent/20"
          >
            ▶ start at stage 01
          </Link>
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-edge px-4 py-2 font-mono text-xs text-ink-dim transition-colors hover:border-edge-bright hover:text-ink"
          >
            read the original post ↗
          </a>
        </div>
        <p className="mt-5 max-w-2xl text-[0.78rem] leading-relaxed text-ink-faint">
          Assumes you know transformers and attention. Assumes nothing about inference serving —
          that's the whole subject. Based on {source.author}'s post{' '}
          <a href={source.url} target="_blank" rel="noreferrer">
            “{source.title}”
          </a>{' '}
          ({source.date}), analysing vLLM V1 at commit{' '}
          <span className="font-mono">{source.commit}</span>.
        </p>
      </header>

      <div className="space-y-10">
        {chapters.map((ch, ci) => (
          <section key={ch.id}>
            <div className="mb-3 flex items-baseline gap-3">
              <span className="font-mono text-xs text-accent/60 tabular-nums">
                {String(ci + 1).padStart(2, '0')}
              </span>
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-ink">{ch.title}</h2>
                <p className="text-[0.8rem] text-ink-faint">{ch.blurb}</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {stagesOf(ch.id).map((s) => (
                <StageCard key={s.slug} s={s} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer className="mt-14 border-t border-edge pt-6 text-[0.75rem] leading-relaxed text-ink-faint">
        <p>
          Every simulator on this site is a small deterministic model of the real mechanism, not a
          recording — it is written as a pure reducer and covered by unit tests that assert the same
          invariants the prose claims (blocks are conserved, the token budget is never exceeded,
          speculative decoding preserves the target distribution). They are teaching models
          though: real engines have far more moving parts, and absolute numbers here are
          illustrative rather than measured.
        </p>
      </footer>
    </div>
  )
}
