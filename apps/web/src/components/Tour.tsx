import { useEffect, useLayoutEffect, useState } from 'react'
import { create } from 'zustand'
import { useLang, useT } from '../i18n'
import { Icon } from './Icon'

/**
 * A short guided tour: each step lights up one part of the window and says what it is for.
 * It starts by itself the first time (photo editor after the opening, video editor on first visit)
 * and can be replayed from the command palette or the help button.
 */
export type TourKind = 'photo' | 'video'

interface Step {
  target: string | null // a CSS selector; null shows the card in the middle
  title: string
  body: string
}

const TOURS: Record<TourKind, Step[]> = {
  photo: [
    {
      target: null,
      title: 'Welcome to Pixels',
      body: 'A one-minute tour of the main parts. Everything runs on this computer: nothing is uploaded anywhere.',
    },
    {
      target: '[data-tour="open"]',
      title: 'Open a picture',
      body: 'Choose a picture, drop it on the window or paste it. Every file is checked for hidden dangers before it is shown.',
    },
    {
      target: '.toolrail',
      title: 'Tools',
      body: 'Crop, adjust, draw, erase, liquify, clone and more. Each tool shows its settings on the inspector.',
    },
    {
      target: '.rightpanel',
      title: 'Inspector',
      body: 'The settings of the tool you picked, and below them layers, text, fills, actions and the history of every change.',
    },
    {
      target: '[data-tour="view"]',
      title: 'Compare and zoom',
      body: 'See the picture before and after your edits, and zoom in or out. Hold the backslash key to flip quickly.',
    },
    {
      target: '[data-tour="export"]',
      title: 'Save your work',
      body: 'Save the project to keep editing later, or export the picture for the web, print or app stores.',
    },
    {
      target: '.mode-switch',
      title: 'Video editor',
      body: 'Switch to Video to cut clips, add music, titles, transitions and colour, and export up to 4K.',
    },
    {
      target: '[data-tour="help"]',
      title: 'Help is always here',
      body: 'The guide (F1) explains every tool. The language button switches between Arabic and English.',
    },
  ],
  video: [
    {
      target: '.v-bin',
      title: 'Media',
      body: 'Import videos, music, voice and pictures, or add a title. Click a file to add it to the timeline, or drag it there.',
    },
    {
      target: '.v-preview',
      title: 'Preview',
      body: 'Play your video (Space). Choose the frame shape for each platform, and see it inside a phone with the safe zones.',
    },
    {
      target: '.v-timeline',
      title: 'Timeline',
      body: 'Drag clips to move them, drag their edges to trim them, press S to split at the red line. Ctrl+Z undoes.',
    },
    {
      target: '.v-inspector',
      title: 'Clip settings',
      body: 'Size, position and movement (◆ adds a keyframe), speed, sound, colour and looks, transitions and animations.',
    },
    {
      target: '[data-tour="video-export"]',
      title: 'Export',
      body: 'Export an MP4 at 720p, 1080p, 2K or 4K: only the sizes this computer can make are offered.',
    },
  ],
}

/** The key that opened the tour (Enter in the command palette) must not also turn its first page. */
let startedAt = 0

const KEY = (kind: TourKind) => `pixels.tour.${kind}`
const seen = (kind: TourKind): boolean => {
  try {
    return localStorage.getItem(KEY(kind)) === 'done'
  } catch {
    return true
  }
}
const markSeen = (kind: TourKind) => {
  try {
    localStorage.setItem(KEY(kind), 'done')
  } catch {
    /* fine */
  }
}

export const useTour = create<{
  kind: TourKind | null
  step: number
  start: (k: TourKind) => void
  stop: () => void
}>((set, get) => ({
  kind: null,
  step: 0,
  start: (kind) => {
    startedAt = performance.now()
    set({ kind, step: 0 })
  },
  stop: () => {
    const { kind } = get()
    if (kind) markSeen(kind)
    set({ kind: null, step: 0 })
  },
}))

/** Start the tour once, the first time (`ready` is false while the opening animation runs). */
export function useFirstTour(kind: TourKind, ready: boolean): void {
  useEffect(() => {
    // automated browsers (the test suites) start it themselves when they test it
    if (!ready || seen(kind) || navigator.webdriver) return
    const timer = window.setTimeout(() => useTour.getState().start(kind), 600)
    return () => window.clearTimeout(timer)
  }, [kind, ready])
}

export function Tour() {
  const t = useT()
  const rtl = useLang((s) => s.lang) === 'ar'
  const { kind, step } = useTour()
  const [rect, setRect] = useState<DOMRect | null>(null)
  const steps = kind ? TOURS[kind] : []
  const current = steps[step]

  useLayoutEffect(() => {
    if (!current?.target) {
      setRect(null)
      return
    }
    const measure = () => {
      const el = document.querySelector(current.target as string)
      setRect(el ? el.getBoundingClientRect() : null)
    }
    measure()
    window.addEventListener('resize', measure)
    const timer = window.setInterval(measure, 400) // panels may still be animating in
    return () => {
      window.removeEventListener('resize', measure)
      window.clearInterval(timer)
    }
  }, [current])

  useEffect(() => {
    if (!kind) return
    const onKey = (e: KeyboardEvent) => {
      if (performance.now() - startedAt < 250) return
      const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
      const back = rtl ? 'ArrowRight' : 'ArrowLeft'
      if (e.key === 'Escape') useTour.getState().stop()
      else if (e.key === forward || e.key === 'Enter') next()
      else if (e.key === back) useTour.setState((s) => ({ step: Math.max(0, s.step - 1) }))
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!kind || !current) return null
  const last = step === steps.length - 1
  function next() {
    // the key that opened the tour also "presses" the focused Next button: ignore that first moment
    if (performance.now() - startedAt < 250) return
    if (step >= steps.length - 1) useTour.getState().stop()
    else useTour.setState({ step: step + 1 })
  }

  // the card sits beside the lit area, inside the window
  const pad = 8
  const card = { width: 340, height: 190 }
  let style: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  if (rect) {
    const below = rect.bottom + pad + card.height < window.innerHeight
    const top = below ? rect.bottom + pad + 6 : Math.max(pad, rect.top - card.height - pad - 6)
    const fitsSide = rect.height > window.innerHeight * 0.5
    const left = fitsSide
      ? rect.left > window.innerWidth / 2
        ? rect.left - card.width - 16
        : rect.right + 16
      : rect.left + rect.width / 2 - card.width / 2
    style = {
      left: Math.min(window.innerWidth - card.width - pad, Math.max(pad, left)),
      top: fitsSide ? Math.min(window.innerHeight - card.height - pad, Math.max(pad, rect.top + 20)) : top,
    }
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        <div
          className="tour-spot"
          style={{
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
          }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card glass" style={style}>
        <div className="tour-step">{t('Step {n} of {total}', { n: step + 1, total: steps.length })}</div>
        <h3 id="tour-title">{t(current.title)}</h3>
        <p>{t(current.body)}</p>
        <div className="tour-dots" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} data-on={i === step} />
          ))}
        </div>
        <div className="tour-actions">
          <button type="button" className="link-button" onClick={() => useTour.getState().stop()}>
            {t('Skip')}
          </button>
          <span className="topbar-spacer" />
          {step > 0 && (
            <button type="button" className="button" onClick={() => useTour.setState({ step: step - 1 })}>
              {t('Back')}
            </button>
          )}
          <button type="button" className="button button-primary" onClick={next} autoFocus>
            {last ? t('Done') : t('Next')}
            {!last && <Icon name="chevronRight" size={14} className="rtl-flip" />}
          </button>
        </div>
      </div>
    </div>
  )
}
