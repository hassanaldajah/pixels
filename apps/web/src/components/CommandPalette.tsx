import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../i18n'
import { GuideDialog } from './GuideDialog'
import { COMMANDS, type Command } from '../lib/shortcuts'
import { useUi } from '../state/ui'

function Palette() {
  const t = useT()
  const set = useUi((s) => s.set)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return COMMANDS.filter((c) => !c.enabled || c.enabled()).filter(
      (c) =>
        !q ||
        c.title.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q) ||
        t(c.title).toLowerCase().includes(q) ||
        t(c.group).toLowerCase().includes(q),
    )
  }, [query, t])

  const close = () => set({ paletteOpen: false })
  const run = (c: Command | undefined) => {
    if (!c) return
    close()
    c.run()
  }

  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div
        className="palette glass"
        role="dialog"
        aria-label={t('Command palette')}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setIndex((i) => Math.min(items.length - 1, i + 1))
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setIndex((i) => Math.max(0, i - 1))
          }
          if (e.key === 'Enter') run(items[index])
        }}
      >
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          placeholder={t('Type a command…')}
          aria-label={t('Search commands')}
        />
        <ul role="listbox">
          {items.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === index}
              data-active={i === index}
              onPointerEnter={() => setIndex(i)}
              onClick={() => run(c)}
            >
              <span className="palette-group">{t(c.group)}</span>
              <span className="palette-title">{t(c.title)}</span>
              {c.keys && <kbd>{c.keys}</kbd>}
            </li>
          ))}
          {items.length === 0 && <li className="muted">{t('No matching command')}</li>}
        </ul>
      </div>
    </div>
  )
}

function Help() {
  const t = useT()
  const set = useUi((s) => s.set)
  const close = () => set({ helpOpen: false })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const groups = [...new Set(COMMANDS.map((c) => c.group))]
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div
        className="help glass"
        role="dialog"
        aria-label={t('Keyboard shortcuts')}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h3>{t('Keyboard shortcuts')}</h3>
        <div className="help-grid">
          {groups.map((g) => (
            <section key={g}>
              <h4>{t(g)}</h4>
              <dl>
                {COMMANDS.filter((c) => c.group === g && c.keys).map((c) => (
                  <div key={c.id}>
                    <dt>{t(c.title)}</dt>
                    <dd>
                      <kbd>{c.keys}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <section>
            <h4>{t('Canvas')}</h4>
            <dl>
              <div>
                <dt>{t('Zoom')}</dt>
                <dd>
                  <kbd>{t('Wheel')}</kbd>
                </dd>
              </div>
              <div>
                <dt>{t('Pan')}</dt>
                <dd>
                  <kbd>{t('Space')}</kbd> {t('+ drag, or middle mouse')}
                </dd>
              </div>
              <div>
                <dt>{t('Fit')}</dt>
                <dd>{t('Double-click')}</dd>
              </div>
              <div>
                <dt>{t('Add guide')}</dt>
                <dd>{t('Drag from a ruler')}</dd>
              </div>
              <div>
                <dt>{t('Remove guide')}</dt>
                <dd>{t('Drag it back out')}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}

export function Dialogs() {
  const palette = useUi((s) => s.paletteOpen)
  const help = useUi((s) => s.helpOpen)
  const guide = useUi((s) => s.guideOpen)
  return (
    <>
      {palette && <Palette />}
      {help && <Help />}
      {guide && <GuideDialog />}
    </>
  )
}
