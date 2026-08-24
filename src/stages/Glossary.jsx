import { Link } from 'react-router-dom'
import { chapters, stages, stagesOf } from '../content/roadmap'
import { glossary, termsOf } from '../content/glossary'

/*
 * Every term the site uses, grouped by the stage that introduces it.
 *
 * This exists because the concept chips on each stage header looked like
 * definitions and weren't. A reader who lands deep in the roadmap from a search
 * has no way back to what "acceptance rate" means; now the chip is a link, and
 * this is where it lands.
 *
 * Rendered eagerly (not lazily like the stages) because it is small, and because
 * a deep link to #b-sat has to resolve on first paint for the anchor to work.
 */

const MICRO = 'font-mono text-[10px] tracking-[0.16em] uppercase'

function StageBlock({ stage, last }) {
  const terms = termsOf(stage.n)
  if (!terms.length) return null

  return (
    <div
      className={`grid border-t-2 border-edge lg:grid-cols-[250px_minmax(0,1fr)] ${
        last ? 'border-b-2' : ''
      }`}
    >
      <div className="border-b border-edge px-[18px] py-6 sm:px-8 lg:border-r-2 lg:border-b-0">
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono text-[12px] text-accent">
            {String(stage.n).padStart(2, '0')}
          </span>
          <Link
            to={`/stage/${stage.slug}`}
            className="text-[17px] font-[800] tracking-[-0.01em] text-ink"
          >
            {stage.title}
          </Link>
        </div>
        <p className="mt-2 mb-0 text-[13px] leading-[1.5] text-neutral-700">{stage.hook}</p>
      </div>

      <div>
        {terms.map((t) => (
          <div
            key={t.slug}
            id={t.slug}
            className="grid scroll-mt-[110px] gap-1 border-b border-edge px-[18px] py-4 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] sm:px-6"
          >
            <div className="font-mono text-[13px] text-accent-700">{t.term}</div>
            <p className="m-0 text-[14px] leading-[1.55] text-neutral-800 text-pretty">{t.def}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Glossary() {
  const withTerms = stages.filter((s) => termsOf(s.n).length > 0)

  return (
    <main>
      <section className="grid border-b-2 border-edge lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="border-b border-edge px-[18px] pt-9 pb-8 sm:px-8 lg:border-r lg:border-b-0 lg:pt-14 lg:pr-10 lg:pb-12">
          <div className={`${MICRO} mb-7 text-accent-700`}>every term, once</div>
          <h1 className="mb-[22px] text-[clamp(44px,5.4vw,84px)] leading-[0.92] font-[900] tracking-[-0.035em]">
            Glossary
          </h1>
          <p className="mb-0 max-w-[46ch] text-[17px] leading-[1.45] font-[500] text-pretty">
            One line per term, grouped by the stage that introduces it. The stage is where the
            actual explanation lives — this is the reminder, not the lesson.
          </p>
        </div>

        <div className="flex flex-col">
          <div className="grid grid-cols-2 border-b border-edge">
            <div className="border-r border-edge px-[18px] py-[22px] sm:px-8">
              <div className="text-[38px] leading-none font-[900] tracking-[-0.03em]">
                {glossary.length}
              </div>
              <div className={`${MICRO} mt-1 text-neutral-600`}>terms</div>
            </div>
            <div className="px-[18px] py-[22px] sm:px-8">
              <div className="text-[38px] leading-none font-[900] tracking-[-0.03em] text-accent">
                {withTerms.length}
              </div>
              <div className={`${MICRO} mt-1 text-neutral-600`}>stages</div>
            </div>
          </div>
          <div className="flex-1 px-[18px] py-[26px] sm:px-8">
            <div className={`${MICRO} mb-2.5 text-neutral-600`}>By act</div>
            <div className="flex flex-col gap-1.5">
              {chapters.map((ch, ci) => {
                const first = stagesOf(ch.id).find((s) => termsOf(s.n).length > 0)
                const count = stagesOf(ch.id).reduce((a, s) => a + termsOf(s.n).length, 0)
                if (!first) return null
                return (
                  <a
                    key={ch.id}
                    href={`#${termsOf(first.n)[0].slug}`}
                    className="flex items-baseline justify-between gap-4 border-b border-accent-300 text-[14px] text-accent-700 hover:border-accent hover:text-accent"
                  >
                    <span>
                      {String(ci + 1).padStart(2, '0')} {ch.title}
                    </span>
                    <span className="font-mono text-[11px] text-neutral-600">{count}</span>
                  </a>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      <section>
        {withTerms.map((s, i) => (
          <StageBlock key={s.slug} stage={s} last={i === withTerms.length - 1} />
        ))}
      </section>

      <footer className="px-[18px] pt-7 pb-11 sm:px-8">
        <Link
          to="/"
          className="border-b-2 border-accent text-[17px] font-[800] tracking-[-0.015em] text-ink"
        >
          ← Back to the map
        </Link>
      </footer>
    </main>
  )
}
