import { useEffect, useMemo, useState } from 'react'
import { GUIDE, type Block, type GuideSection } from '../help/guide'
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
export function searchGuide(query: string, sections: GuideSection[] = GUIDE): GuideSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return sections
  return sections.filter((s) => {
    const hay = `${s.title} ${s.summary} ${s.blocks.map(text).join(' ')}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if ('p' in b) return <p key={i}>{b.p}</p>
        if ('ul' in b)
          return (
            <ul key={i}>
              {b.ul.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )
        if ('steps' in b)
          return (
            <ol key={i}>
              {b.steps.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ol>
          )
        if ('tip' in b)
          return (
            <p key={i} className="guide-tip">
              <strong>Tip:</strong> {b.tip}
            </p>
          )
        return (
          <dl key={i} className="guide-keys">
            {b.keys.map(([k, d]) => (
              <div key={k}>
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{d}</dd>
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
  const set = useUi((s) => s.set)
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(GUIDE[0]?.id ?? 'start')
  const close = () => set({ guideOpen: false })
  const found = useMemo(() => searchGuide(query), [query])
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
        aria-label="User guide"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="guide-head">
          <h3>User guide</h3>
          <input
            type="search"
            className="guide-search"
            placeholder="Search the guide (for example: blur, undo, export)"
            aria-label="Search the guide"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="icon-button" aria-label="Close the guide" onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="guide-body">
          <nav className="guide-nav" aria-label="Guide sections">
            {found.map((s) => (
              <button
                key={s.id}
                type="button"
                data-active={s.id === section?.id}
                onClick={() => setCurrent(s.id)}
              >
                {s.title}
              </button>
            ))}
            {found.length === 0 && <p className="muted">Nothing matches that. Try one word.</p>}
          </nav>
          <article className="guide-page">
            {section && (
              <>
                <h4>{section.title}</h4>
                <p className="guide-summary">{section.summary}</p>
                <Blocks blocks={section.blocks} />
              </>
            )}
          </article>
        </div>
      </div>
    </div>
  )
}
