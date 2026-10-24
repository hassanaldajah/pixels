import { useState } from 'react'
import { useT } from '../i18n'
import { openRecent } from '../lib/autosave'
import { forgetRecent, useRecent, type RecentItem } from '../lib/recent'
import { Icon } from './Icon'

const ago = (t: number, say: (s: string, v?: Record<string, number>) => string): string => {
  const minutes = Math.round((Date.now() - t) / 60000)
  if (minutes < 1) return say('just now')
  if (minutes < 60) return say('{n} min ago', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return say('{n} h ago', { n: hours })
  return say('{n} days ago', { n: Math.round(hours / 24) })
}

/** Recent work: pick up where you left off, even after the window was closed by mistake. */
export function RecentPanel({ kind, limit = 6 }: { kind?: RecentItem['kind']; limit?: number }) {
  const t = useT()
  const all = useRecent()
  const [notice, setNotice] = useState('')
  const items = all.filter((i) => !kind || i.kind === kind).slice(0, limit)
  if (items.length === 0) return null
  return (
    <section className="recent glass" aria-label={t('Recent')}>
      <h4>
        <Icon name="undo" size={14} /> {t('Continue where you left off')}
      </h4>
      <ul>
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              className="recent-item"
              onClick={async () => {
                setNotice('')
                const result = await openRecent(item).catch(() => 'missing' as const)
                if (result === 'missing')
                  setNotice(t('That picture is no longer on this computer (pictures are kept for 14 days).'))
              }}
            >
              {item.kind === 'photo' ? (
                <img src={item.thumb} alt="" className="recent-thumb" />
              ) : (
                <span className="recent-thumb recent-film">
                  <Icon name="film" size={20} />
                </span>
              )}
              <span className="recent-text">
                <span className="recent-name" dir="auto">
                  {item.name}
                </span>
                <span className="recent-when">
                  {item.kind === 'video' ? t('Video') : t('Picture')} · {ago(item.updatedAt, t)}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t('Remove from the list')}
              title={t('Remove from the list')}
              onClick={() => void forgetRecent(item.key)}
            >
              <Icon name="close" size={13} />
            </button>
          </li>
        ))}
      </ul>
      {notice && (
        <p className="hint" role="status">
          {notice}
        </p>
      )}
    </section>
  )
}
