import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { LiquifyStroke } from '../engine/types'
import { useEdit } from '../state/edit'
import { useImage } from '../state/image'
import { applyLiquifyStroke, useLiquify } from '../state/liquify'
import { useUi } from '../state/ui'
import { useView } from '../state/view'
import { getLiveView, subscribeLiveView } from './liveView'
import { imageToScreen, type Point } from './math'

const SPACING = 0.12 // distance between dabs, as a fraction of the brush size
const HOLD_MS = 60 // bloat and pinch keep growing while the mouse is held still

/** The Liquify tool: push, bloat, pinch or restore under the brush. Space or the middle button pans. */
export function LiquifyOverlay() {
  const tool = useUi((s) => s.tool)
  const image = useImage((s) => s.current)
  const view = useSyncExternalStore(subscribeLiveView, getLiveView)
  const { viewport, dpr, image: size } = useView()
  const brushSize = useLiquify((s) => s.size)
  const box = useRef<HTMLDivElement>(null)
  const stroke = useRef<LiquifyStroke | null>(null)
  const hold = useRef<number | null>(null)
  const space = useRef(false)
  const [ring, setRing] = useState<Point | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = e.type === 'keydown'
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      if (hold.current) window.clearInterval(hold.current)
    }
  }, [])

  if (tool !== 'liquify' || !image || !size) return null
  const topLeft = imageToScreen({ x: 0, y: 0 }, view, viewport, dpr)
  const bottomRight = imageToScreen({ x: size.w, y: size.h }, view, viewport, dpr)
  const cssWidth = bottomRight.x - topLeft.x
  const cssScale = cssWidth / size.w

  const toImage = (e: { clientX: number; clientY: number }): Point => {
    const rect = box.current?.getBoundingClientRect()
    return {
      x: ((e.clientX - (rect?.left ?? 0)) / (rect?.width || 1)) * size.w,
      y: ((e.clientY - (rect?.top ?? 0)) / (rect?.height || 1)) * size.h,
    }
  }
  const round = (v: number) => Math.round(v * 10) / 10
  const stopHold = () => {
    if (hold.current) window.clearInterval(hold.current)
    hold.current = null
  }
  const finish = () => {
    stopHold()
    const s = stroke.current
    stroke.current = null
    if (s) applyLiquifyStroke(s, true)
  }

  return (
    <div
      ref={box}
      className="eraser-layer liquify-layer"
      style={{ left: topLeft.x, top: topLeft.y, width: cssWidth, height: bottomRight.y - topLeft.y }}
      onPointerDown={(e) => {
        if (e.button !== 0 || space.current) return
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        const l = useLiquify.getState()
        const p = toImage(e)
        stroke.current = {
          mode: l.mode,
          r: Math.max(2, l.size / 2),
          strength: l.strength,
          pts: [[round(p.x), round(p.y)]],
        }
        applyLiquifyStroke(stroke.current, false)
        if (l.mode !== 'push') {
          // holding still keeps adding dabs on the same spot, so bloat, pinch and restore build up
          hold.current = window.setInterval(() => {
            const s = stroke.current
            if (!s) return stopHold()
            s.pts.push([...(s.pts[s.pts.length - 1] as [number, number])])
            if (!applyLiquifyStroke(s, false)) finish()
          }, HOLD_MS)
        }
      }}
      onPointerMove={(e) => {
        const rect = box.current?.getBoundingClientRect()
        setRing({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) })
        const s = stroke.current
        if (!s) return
        const p = toImage(e)
        const last = s.pts[s.pts.length - 1] as [number, number]
        const gap = Math.hypot(p.x - last[0], p.y - last[1])
        const step = Math.max(1, s.r * 2 * SPACING)
        if (gap < step) return
        const n = Math.floor(gap / step)
        for (let i = 1; i <= n; i++)
          s.pts.push([round(last[0] + ((p.x - last[0]) * i) / n), round(last[1] + ((p.y - last[1]) * i) / n)])
        if (!applyLiquifyStroke(s, false)) finish()
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        stopHold()
        stroke.current = null
        useEdit.getState().preview(null)
      }}
      onPointerLeave={() => setRing(null)}
    >
      {ring && (
        <div
          className="eraser-ring"
          style={{ left: ring.x, top: ring.y, width: brushSize * cssScale, height: brushSize * cssScale }}
        />
      )}
    </div>
  )
}
