import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { paintStroke, smoothPoints, useDraw, type DrawStroke } from '../state/draw'
import { useImage } from '../state/image'
import { useUi } from '../state/ui'
import { useView } from '../state/view'
import { getLiveView, subscribeLiveView } from './liveView'
import { imageToScreen, type Point } from './math'

/** The on-screen copy of the drawing is at most this many pixels on its long side (the layer is drawn at full size). */
const SCREEN_SIDE = 2048

/**
 * The Draw tool: draw with the mouse, a finger or a pen (pressure changes the pen's width).
 * Hold Space or use the middle button to pan the canvas instead.
 */
export function DrawOverlay() {
  const tool = useUi((s) => s.tool)
  const image = useImage((s) => s.current)
  const view = useSyncExternalStore(subscribeLiveView, getLiveView)
  const { viewport, dpr, image: size } = useView()
  const strokes = useDraw((s) => s.strokes)
  const brushSize = useDraw((s) => s.size)
  const base = useRef<HTMLCanvasElement>(null)
  const live = useRef<HTMLCanvasElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const current = useRef<DrawStroke | null>(null)
  const space = useRef(false)
  const [ring, setRing] = useState<Point | null>(null)
  const active = tool === 'draw' && !!image && !!size
  const ratio = size ? Math.min(1, SCREEN_SIDE / Math.max(size.w, size.h)) : 1
  const w = size ? Math.max(1, Math.round(size.w * ratio)) : 1
  const h = size ? Math.max(1, Math.round(size.h * ratio)) : 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = e.type === 'keydown'
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [])

  // every committed stroke, redrawn when the list changes (undo, redo, clear)
  useEffect(() => {
    const ctx = base.current?.getContext('2d')
    if (!ctx || !active) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    for (const s of strokes) paintStroke(ctx, s)
  }, [strokes, active, ratio, w, h])

  if (!active || !size) return null
  const topLeft = imageToScreen({ x: 0, y: 0 }, view, viewport, dpr)
  const bottomRight = imageToScreen({ x: size.w, y: size.h }, view, viewport, dpr)
  const cssWidth = bottomRight.x - topLeft.x
  const cssScale = cssWidth / size.w

  const toImage = (e: { clientX: number; clientY: number }): Point => {
    const rect = layer.current?.getBoundingClientRect()
    return {
      x: ((e.clientX - (rect?.left ?? 0)) / (rect?.width || 1)) * size.w,
      y: ((e.clientY - (rect?.top ?? 0)) / (rect?.height || 1)) * size.h,
    }
  }
  const pressure = (e: PointerEvent | React.PointerEvent) =>
    e.pointerType === 'pen' ? Math.min(1, Math.max(0.05, e.pressure)) : 1

  const drawLive = () => {
    const ctx = live.current?.getContext('2d')
    const s = current.current
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (!s) return
    if (s.brush === 'eraser') {
      // show the eraser path as a faint trail; it is applied when the stroke ends
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      paintStroke(ctx, { ...s, brush: 'marker', color: 'rgba(255, 255, 255, 0.35)', opacity: 1 })
      return
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    paintStroke(ctx, { ...s, points: smoothPoints(s.points, useDraw.getState().smoothing) })
  }
  const finish = () => {
    const s = current.current
    current.current = null
    drawLive()
    if (s && s.points.length > 0)
      useDraw.getState().addStroke({ ...s, points: smoothPoints(s.points, useDraw.getState().smoothing) })
  }

  return (
    <div
      ref={layer}
      className="eraser-layer draw-layer"
      style={{ left: topLeft.x, top: topLeft.y, width: cssWidth, height: bottomRight.y - topLeft.y }}
      onPointerDown={(e) => {
        if (e.button !== 0 || space.current) return
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        const d = useDraw.getState()
        const p = toImage(e)
        current.current = {
          brush: d.brush,
          color: d.color,
          size: d.size,
          opacity: d.opacity,
          points: [[p.x, p.y, pressure(e)]],
        }
        drawLive()
      }}
      onPointerMove={(e) => {
        const rect = layer.current?.getBoundingClientRect()
        if (e.pointerType !== 'touch')
          setRing({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) })
        const s = current.current
        if (!s) return
        // coalesced events: every point the pointer passed, not only one per frame
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
        for (const ev of events.length ? events : [e.nativeEvent]) {
          const p = toImage(ev)
          const last = s.points[s.points.length - 1] as [number, number, number]
          if (Math.hypot(p.x - last[0], p.y - last[1]) < 0.75 / Math.max(cssScale, 0.01)) continue
          s.points.push([p.x, p.y, pressure(ev)])
        }
        drawLive()
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        current.current = null
        drawLive()
      }}
      onPointerLeave={() => setRing(null)}
    >
      <canvas ref={base} className="draw-canvas" width={w} height={h} />
      <canvas ref={live} className="draw-canvas" width={w} height={h} />
      {ring && (
        <div
          className="eraser-ring"
          style={{ left: ring.x, top: ring.y, width: brushSize * cssScale, height: brushSize * cssScale }}
        />
      )}
    </div>
  )
}
