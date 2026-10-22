import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSystem } from './api/queries'
import { SplashHost } from './brand/SplashHost'
import { CanvasHud } from './components/CanvasHud'
import { Copyright } from './components/Copyright'
import { Dialogs } from './components/CommandPalette'
import { ExportDialog } from './components/ExportDialog'
import { Icon } from './components/Icon'
import { DropOverlay, EmptyState, FileInput, Notices, Rejections, useIntake } from './components/Overlays'
import { JobsDock } from './components/JobsDock'
import { RightPanel } from './components/RightPanel'
import { ToolRail } from './components/ToolRail'
import { TopBar } from './components/TopBar'
import { installPointerLight } from './lib/pointerLight'
import { installShortcuts, takesText } from './lib/shortcuts'
import { useEdit } from './state/edit'
import { useImage } from './state/image'
import { useJobs } from './state/jobs'
import { DOCK_HEIGHT, RIGHT_WIDTH, useUi } from './state/ui'
import { Viewport } from './viewport/Viewport'

const SPLASH_KEY = 'pixels.splash'
const DOCK_COLLAPSED = 40

/** The desktop window plays the opening on its own loading page and then opens the app with ?splash=0. */
function splashAlreadyShown(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('splash') === '0') return true
    return sessionStorage.getItem(SPLASH_KEY) === '1'
  } catch {
    return false
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export default function App() {
  const [splash, setSplash] = useState(() => !splashAlreadyShown())
  const [intro, setIntro] = useState(() => splashAlreadyShown())
  const [dragging, setDragging] = useState(false)
  const [glError, setGlError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const ui = useUi()
  const image = useImage((s) => s.current)
  const { data: system } = useSystem()

  useIntake(setDragging)
  useEffect(installShortcuts, [])
  useEffect(installPointerLight, [])
  // Hold the backslash key to flip to the unedited picture.
  useEffect(() => {
    const BACKSLASH = String.fromCharCode(92)
    const typing = (e: KeyboardEvent) => takesText(e.target)
    const down = (e: KeyboardEvent) => {
      if (e.key === BACKSLASH && !typing(e) && !e.repeat) useEdit.getState().setCompare({ hold: true })
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === BACKSLASH) useEdit.getState().setCompare({ hold: false })
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])
  useEffect(() => useJobs.getState().connect(), [])
  useEffect(() => {
    if (system) useImage.getState().setLimits(system.limits.max_file_bytes, system.limits.max_batch_files)
  }, [system])

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = ui.theme
  }, [ui.theme])
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('fx-reduced', ui.reduceEffects)
  }, [ui.reduceEffects])

  const endSplash = useCallback(() => {
    try {
      sessionStorage.setItem(SPLASH_KEY, '1')
    } catch {
      /* ignore */
    }
    setSplash(false)
    setIntro(true)
  }, [])
  const revealApp = useCallback(() => setIntro(true), [])

  // --- resizing (the CSS variable moves during the drag; the store is updated once on release) ---
  const startResize = (kind: 'right' | 'dock') => (e: React.PointerEvent<HTMLDivElement>) => {
    const el = root.current
    if (!el) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    el.classList.add('resizing')
    const startX = e.clientX
    const startY = e.clientY
    const startRight = ui.rightWidth
    const startDock = ui.dockHeight
    let latest = kind === 'right' ? startRight : startDock
    const move = (ev: PointerEvent) => {
      if (kind === 'right') {
        latest = clamp(startRight + (startX - ev.clientX), RIGHT_WIDTH.min, RIGHT_WIDTH.max)
        el.style.setProperty('--right-w', `${latest}px`)
      } else {
        latest = clamp(startDock + (startY - ev.clientY), DOCK_HEIGHT.min, DOCK_HEIGHT.max)
        el.style.setProperty('--dock-h', `${latest}px`)
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      el.classList.remove('resizing')
      el.style.removeProperty('--right-w')
      el.style.removeProperty('--dock-h')
      ui.set(kind === 'right' ? { rightWidth: latest } : { dockHeight: latest })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const style = {
    '--right-w': `${ui.rightOpen ? ui.rightWidth : 0}px`,
    '--dock-h': `${ui.dockOpen ? ui.dockHeight : DOCK_COLLAPSED}px`,
  } as React.CSSProperties

  return (
    <>
      <div ref={root} className="app" style={style} data-has-image={image !== null} data-intro={intro}>
        <TopBar />
        <ToolRail />
        <main className="stage">
          <Viewport onGlError={setGlError} />
          <CanvasHud />
          {!image && !glError && <EmptyState />}
          {glError && (
            <div className="empty">
              <div className="empty-card glass" role="alert">
                <Icon name="warn" size={32} />
                <h2>WebGL 2 is not available</h2>
                <p>{glError}</p>
                <p className="hint">
                  Update your graphics driver, or enable hardware acceleration in your browser.
                </p>
              </div>
            </div>
          )}
          <Rejections />
          <Notices />
          {dragging && <DropOverlay />}
          {!ui.rightOpen && (
            <button
              type="button"
              className="reopen glass"
              aria-label="Show inspector"
              title="Show inspector (Ctrl+])"
              onClick={() => ui.set({ rightOpen: true })}
            >
              <Icon name="panelRight" size={18} />
            </button>
          )}
        </main>
        {ui.rightOpen && (
          <>
            <div
              className="resizer resizer-v"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize inspector"
              onPointerDown={startResize('right')}
            />
            <RightPanel />
          </>
        )}
        {ui.dockOpen && (
          <div
            className="resizer resizer-h"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize dock"
            onPointerDown={startResize('dock')}
          />
        )}
        <JobsDock />
        <Copyright />
        <Dialogs />
        <ExportDialog />
        <FileInput />
      </div>
      {splash && <SplashHost onDone={endSplash} onReveal={revealApp} />}
    </>
  )
}
