import { useEffect, useState } from 'react'
import { useT } from '../../i18n'
import { Icon } from '../../components/Icon'
import { LINUX_PLUGINS, useUndecodable, videoSupport, type VideoSupport } from '../support'

function Copy({ text }: { text: string }) {
  const t = useT()
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={t('Copy')}
      title={done ? t('Copied') : t('Copy')}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true)
          window.setTimeout(() => setDone(false), 1500)
        })
      }}
    >
      <Icon name={done ? 'check' : 'presets'} size={14} />
    </button>
  )
}

/** Shown when this system cannot play or export video: why, and two ways to fix it. */
export function SupportNotice() {
  const t = useT()
  const [support, setSupport] = useState<VideoSupport | null>(null)
  const [hidden, setHidden] = useState(false)
  const undecodable = useUndecodable()
  useEffect(() => {
    void videoSupport().then(setSupport)
  }, [])
  if (!support || hidden) return null
  const problem = !support.decode || !support.encode || undecodable.length > 0
  if (!problem) return null
  const url = window.location.origin
  return (
    <div className="v-support glass" role="alert">
      <div className="v-support-head">
        <Icon name="warn" size={16} />
        <strong>
          {!support.decode || undecodable.length
            ? t('This system cannot play some videos yet')
            : t('This system cannot export video yet')}
        </strong>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Dismiss')}
          onClick={() => setHidden(true)}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      {support.systemWebView && (
        <p>
          {t(
            'Open Pixels in Chrome, Edge or Firefox: it is the same app on this computer, with your projects.',
          )}
          <span className="v-support-line" dir="ltr">
            <code>{url}</code>
            <Copy text={url} />
          </span>
        </p>
      )}
      {support.linux && (
        <>
          <p>{t('Or install the video plugins for your system, then restart Pixels:')}</p>
          <ul>
            {LINUX_PLUGINS.map((p) => (
              <li key={p.name}>
                <span>{p.name}</span>
                <span className="v-support-line" dir="ltr">
                  <code>{p.command}</code>
                  <Copy text={p.command} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
