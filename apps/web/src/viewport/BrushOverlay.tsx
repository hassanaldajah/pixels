import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Stroke } from '../engine/types'
import { applyStroke, endStroke, useBrush } from '../state/brush'
import { useEdit } from '../state/edit'
import { useImage } from '../state/image'
import { useUi } from '../state/ui'
import { useView } from '../state/view'
import { getLiveView, subscribeLiveView } from './liveView'
import { imageToScreen, type Point } from './math'

const SPACING = 0.18 // distance between dabs, as a fraction of the brush size

/**
 * The Brush tool: paint where a light or colour change should apply (dodge, burn, brighten eyes, whiten teeth...).
 * The change shows live while you paint. Hold Alt to rub paint out; hold Space or use the middle button to pan.
 */
export function BrushOverlay() {
  const tool = useUi((s) => s.tool)
  const image = useImage((s) => s.current)
  const view = useSyncExternalStore(subscribeLiveView, getLiveView)
  const { viewport, dpr, image: size } = useView()
  const size_ = useBrush((s) => s.size)
  const layer = useRef<HTMLDivElement>(null)
  const stroke = useRef<Stroke | null>(null)
  const space = useRef(false)
  const [ring, setRing] = useState<Point | null>(null)

  useEffect(() => {
    const set = (down: boolean) => (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = down
    }
    const onDown = set(true)
    const onUp = set(false)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [])

  if (tool !== 'brush' || !image || !size) return null
  const topLeft = imageToScreen({ x: 0, y: 0 }, view, viewport, dpr)
  const bottomRight = imageToScreen({ x: size.w, y: size.h }, view, viewport, dpr)
  const cssWidth = bottomRight.x - topLeft.x
  const cssScale = cssWidth / size.w

  const toImage = (e: React.PointerEvent): Point => {
    const rect = layer.current?.getBoundingClientRect()
    return {
      x: ((e.clientX - (rect?.left ?? 0)) / (rect?.width || 1)) * size.w,
      y: ((e.clientY - (rect?.top ?? 0)) / (rect?.height || 1)) * size.h,
    }
  }
  const dab = (s: Stroke, p: Point) => {
    s.pts.push([Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10])
  }
  const finish = () => {
    const s = stroke.current
    stroke.current = null
    if (s) applyStroke(s, true)
    else endStroke()
  }

  return (
    <div
      ref={layer}
      className="eraser-layer"
      style={{ left: topLeft.x, top: topLeft.y, width: cssWidth, height: bottomRight.y - topLeft.y }}
      onPointerDown={(e) => {
        if (e.button !== 0 || space.current || e.pointerType === 'touch') return
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        const b = useBrush.getState()
        const p = toImage(e)
        stroke.current = { r: b.size / 2, hardness: b.hardness, flow: b.flow, erase: e.altKey, pts: [] }
        dab(stroke.current, p)
        applyStroke(stroke.current, false)
      }}
      onPointerMove={(e) => {
        const rect = layer.current?.getBoundingClientRect()
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
          dab(s, { x: last[0] + ((p.x - last[0]) * i) / n, y: last[1] + ((p.y - last[1]) * i) / n })
        if (!applyStroke(s, false)) finish()
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        stroke.current = null
        endStroke()
        useEdit.getState().preview(null)
      }}
      onPointerLeave={() => setRing(null)}
    >
      {ring && (
        <div
          className="eraser-ring"
          style={{ left: ring.x, top: ring.y, width: size_ * cssScale, height: size_ * cssScale }}
        />
      )}
    </div>
  )
}
