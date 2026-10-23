import { useEffect, useMemo, useState } from 'react'
import { GUIDE, type Block, type GuideSection } from '../help/guide'
import { translate, useLang, useT } from '../i18n'
import { useUi } from '../state/ui'
import { Icon } from './Icon'

const text = (b: Block): string =>
  'p' in b
    ? b.p
    : 'ul' in b
      ? b.ul.join(' ')
      : 'steps' in b
        ? b.steps.join(' ')
        : 'tip' in b
          ? b.tip
          : b.keys.flat().join(' ')

/** Sections whose title, summary or text contain every word typed. */
export function searchGuide(
  query: string,
  sections: GuideSection[] = GUIDE,
  show: (text: string) => string = (x) => x,
): GuideSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return sections
  return sections.filter((s) => {
    const hay = `${s.title} ${s.summary} ${s.blocks.map(text).join(' ')}`.toLowerCase()
    const shown = show(hay)
    return words.every(
      (w) =>
        hay.includes(w) ||
        [s.title, s.summary, ...s.blocks.map(text)].some((x) => show(x).toLowerCase().includes(w)) ||
        shown.includes(w),
    )
  })
}

function Blocks({ blocks }: { blocks: Block[] }) {
  const t = useT()
  return (
    <>
      {blocks.map((b, i) => {
        if ('p' in b) return <p key={i}>{t(b.p)}</p>
        if ('ul' in b)
          return (
            <ul key={i}>
              {b.ul.map((x) => (
                <li key={x}>{t(x)}</li>
              ))}
            </ul>
          )
        if ('steps' in b)
          return (
            <ol key={i}>
              {b.steps.map((x) => (
                <li key={x}>{t(x)}</li>
              ))}
            </ol>
          )
        if ('tip' in b)
          return (
            <p key={i} className="guide-tip">
              <strong>{t('Tip:')}</strong> {t(b.tip)}
            </p>
          )
        return (
          <dl key={i} className="guide-keys">
            {b.keys.map(([k, d]) => (
              <div key={k}>
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{t(d)}</dd>
              </div>
            ))}
          </dl>
        )
      })}
    </>
  )
}

/** The in-app user guide (F1). Works offline: the text ships with the app. */
export function GuideDialog() {
  const t = useT()
  const lang = useLang((s) => s.lang)
  const set = useUi((s) => s.set)
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(GUIDE[0]?.id ?? 'start')
  const close = () => set({ guideOpen: false })
  const found = useMemo(() => searchGuide(query, GUIDE, (x) => translate(lang, x)), [query, lang])
  const section = found.find((s) => s.id === current) ?? found[0]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div
        className="guide glass"
        role="dialog"
        aria-label={t('User guide')}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="guide-head">
          <h3>{t('User guide')}</h3>
          <input
            type="search"
            className="guide-search"
            placeholder={t('Search the guide (for example: blur, undo, export)')}
            aria-label={t('Search the guide')}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="icon-button" aria-label={t('Close the guide')} onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="guide-body">
          <nav className="guide-nav" aria-label={t('Guide sections')}>
            {found.map((s) => (
              <button
                key={s.id}
                type="button"
                data-active={s.id === section?.id}
                onClick={() => setCurrent(s.id)}
              >
                {t(s.title)}
              </button>
            ))}
            {found.length === 0 && <p className="muted">{t('Nothing matches that. Try one word.')}</p>}
          </nav>
          <article className="guide-page">
            {section && (
              <>
                <h4>{t(section.title)}</h4>
                <p className="guide-summary">{t(section.summary)}</p>
                <Blocks blocks={section.blocks} />
              </>
            )}
          </article>
        </div>
      </div>
    </div>
  )
}
