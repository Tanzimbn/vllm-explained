import { Link } from 'react-router-dom'
import { chapters, source, stages, stagesOf } from '../content/roadmap'

/*
 * The map. A display-scale hero split against a meta column, then one row per
 * act: a 250px act label against a grid of equal stage cells, everything held
 * together by rules rather than by cards.
 */

const MICRO = 'font-mono text-[10px] tracking-[0.16em] uppercase'
const SIM_COUNT = stages.flatMap((s) => s.sims).length

/*
 * Chapter 02 carries the accent as a field. The system asks for exactly one
 * poster statement per page, and paged attention is the idea the rest is built
 * on — so that's where the red goes.
 */
const POSTER_CHAPTER = 'ch2'

function StageCell({ s, poster }) {
  return (
    <Link
      to={`/stage/${s.slug}`}
      className={`flex min-h-[118px] flex-col border-r border-b border-edge px-[18px] py-[18px] transition-colors sm:px-6 sm:py-[22px] ${
        poster ? 'bg-accent-100 hover:bg-accent-200' : 'hover:bg-accent-100'
      }`}
    >
      <div
        className={`mb-2.5 font-mono text-[11px] ${poster ? 'text-accent-700' : 'text-neutral-600'}`}
      >
        {String(s.n).padStart(2, '0')}
      </div>
      <div className="mb-1.5 text-[16px] font-[700] tracking-[-0.01em]">{s.title}</div>
      <div className="text-[13px] leading-[1.5] text-neutral-700">{s.hook}</div>
      <div className={`${MICRO} mt-auto pt-3 text-accent-700`}>
        {s.sims.length} sim{s.sims.length > 1 ? 's' : ''}
      </div>
    </Link>
  )
}

function ActRow({ ch, ci, last }) {
  const rows = stagesOf(ch.id)
  const poster = ch.id === POSTER_CHAPTER
  // Blank cells complete the row so the grid stays a grid. Desktop only —
  // on one column there is no row to complete.
  const fillers = (3 - (rows.length % 3)) % 3

  return (
    <div
      className={`grid border-t-2 border-edge lg:grid-cols-[250px_minmax(0,1fr)] ${
        last ? 'border-b-2' : ''
      }`}
    >
      <div
        className={`border-b border-edge px-[18px] py-6 sm:px-8 lg:border-r-2 lg:border-b-0 ${
          poster ? 'bg-accent text-surface' : ''
        }`}
      >
        <div className="flex items-baseline gap-2.5">
          <span className={`font-mono text-[12px] ${poster ? 'opacity-75' : 'text-accent'}`}>
            {String(ci + 1).padStart(2, '0')}
          </span>
          <span className="text-[19px] font-[800] tracking-[-0.01em]">{ch.title}</span>
        </div>
        <p
          className={`mt-2 mb-0 text-[13px] leading-[1.5] ${
            poster ? 'opacity-90' : 'text-neutral-700'
          }`}
        >
          {ch.blurb}
        </p>
      </div>
      <div className="grid lg:grid-cols-3">
        {rows.map((s) => (
          <StageCell key={s.slug} s={s} poster={poster} />
        ))}
        {Array.from({ length: fillers }, (_, i) => (
          <div
            key={`f${i}`}
            className="hidden border-r border-b border-edge bg-neutral-200 lg:block"
          />
        ))}
      </div>
    </div>
  )
}

export default function RoadmapMap() {
  return (
    <main>
      <section className="grid border-b-2 border-edge lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="border-b border-edge px-[18px] pt-9 pb-8 sm:px-8 lg:border-r lg:border-b-0 lg:pt-16 lg:pr-10 lg:pb-14">
          {/* Lowercase in the source, uppercased in CSS — the deployment test
              greps the rendered HTML for this string. */}
          <div className={`${MICRO} mb-7 text-accent-700`}>interactive companion · vLLM V1</div>
          <h1 className="mb-[26px] text-[clamp(56px,7.2vw,116px)] leading-[0.9] font-[900] tracking-[-0.035em]">
            Inside vLLM
          </h1>
          <p className="mb-[18px] max-w-[34ch] text-[21px] leading-[1.4] font-[500] text-pretty">
            An inference engine is a machine full of moving parts. The interesting part is the
            movement — so nothing here is a still diagram.
          </p>
          <p className="mb-[34px] max-w-[46ch] text-[15px] leading-[1.62] text-neutral-800 text-pretty">
            Thirteen stages in dependency order. Each one ships a simulator you drive yourself:
            press <span className="bg-neutral-200 px-1.5 py-0.5 font-mono text-[13px]">step</span>,
            watch one engine tick, turn a knob, watch it go differently.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to={`/stage/${stages[0].slug}`}
              className="bg-accent px-4 py-2.5 text-[14px] font-[800] text-surface transition-colors hover:bg-accent-600 active:bg-accent-700"
            >
              ▶ Start at stage 01
            </Link>
            <Link
              to="/stage/paged-attention"
              className="border border-edge px-4 py-2.5 text-[14px] font-[800] text-ink transition-colors hover:bg-accent-100"
            >
              Jump to the paged-attention lab
            </Link>
          </div>
        </div>

        <div className="flex flex-col">
          <div className="border-b border-edge px-[18px] py-[26px] sm:px-8">
            <div className={`${MICRO} mb-2 text-neutral-600`}>Assumes</div>
            <p className="m-0 text-[14px] leading-[1.55] text-neutral-800">
              You know transformers and attention. Nothing about inference serving — that is the
              whole subject.
            </p>
          </div>
          <div className="grid grid-cols-2 border-b border-edge">
            <div className="border-r border-edge px-[18px] py-[22px] sm:px-8">
              <div className="text-[38px] leading-none font-[900] tracking-[-0.03em]">
                {stages.length}
              </div>
              <div className={`${MICRO} mt-1 text-neutral-600`}>stages</div>
            </div>
            <div className="px-[18px] py-[22px] sm:px-8">
              <div className="text-[38px] leading-none font-[900] tracking-[-0.03em] text-accent">
                {SIM_COUNT}
              </div>
              <div className={`${MICRO} mt-1 text-neutral-600`}>simulators</div>
            </div>
          </div>
          <div className="flex-1 px-[18px] py-[26px] sm:px-8">
            <div className={`${MICRO} mb-2.5 text-neutral-600`}>Based on</div>
            <p className="m-0 text-[14px] leading-[1.55] text-neutral-800 text-pretty">
              {source.author},{' '}
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="border-b border-accent-300 text-accent-700 hover:border-accent hover:text-accent"
              >
                {source.title}
              </a>{' '}
              ({source.date}). Analysis tracks vLLM V1 at commit{' '}
              <span className="font-mono text-[13px]">{source.commit}</span>.
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-baseline justify-between gap-5 px-[18px] pt-[34px] pb-[18px] sm:px-8">
        <h2 className="m-0 text-[15px] font-[800] tracking-[0.02em] uppercase">The map</h2>
        <div className="font-mono text-[11px] text-neutral-600">
          six acts / thirteen stages / read in order or don't
        </div>
      </div>

      <section>
        {chapters.map((ch, ci) => (
          <ActRow key={ch.id} ch={ch} ci={ci} last={ci === chapters.length - 1} />
        ))}
      </section>

      <footer className="flex flex-wrap justify-between gap-6 px-[18px] pt-7 pb-11 sm:px-8">
        <p className="m-0 max-w-[70ch] text-[13px] leading-[1.55] text-neutral-700">
          Every simulator here is a small deterministic model of the real mechanism, not a recording
          — each is a pure reducer covered by unit tests that assert the same invariants the prose
          claims (blocks are conserved, the token budget is never exceeded, speculative decoding
          preserves the target distribution). They are teaching models though: real engines have far
          more moving parts, and absolute numbers are illustrative rather than measured.
        </p>
        <div className="font-mono text-[11px] text-neutral-600">
          companion to {source.author}'s post
        </div>
      </footer>
    </main>
  )
}
