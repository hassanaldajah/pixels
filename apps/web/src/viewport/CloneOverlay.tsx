import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CloneStroke } from '../engine/types'
import { applyCloneStroke, useClone } from '../state/clone'
import { useEdit } from '../state/edit'
import { useImage } from '../state/image'
import { useUi } from '../state/ui'
import { useView } from '../state/view'
import { getLiveView, subscribeLiveView } from './liveView'
import { imageToScreen, type Point } from './math'

const SPACING = 0.18

/**
 * The Clone tool: Alt+click picks the place to copy from, then paint to copy it onto another place. The offset
 * between the two stays the same for later strokes (aligned), and a cross shows where the copy comes from.
 */
export function CloneOverlay() {
  const tool = useUi((s) => s.tool)
  const image = useImage((s) => s.current)
  const view = useSyncExternalStore(subscribeLiveView, getLiveView)
  const { viewport, dpr, image: size } = useView()
  const brushSize = useClone((s) => s.size)
  const source = useClone((s) => s.source)
  const offset = useClone((s) => s.offset)
  const layer = useRef<HTMLDivElement>(null)
  const stroke = useRef<CloneStroke | null>(null)
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

  if (tool !== 'clone' || !image || !size) return null
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
  const dab = (s: CloneStroke, p: Point) => s.pts.push([Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10])
  const finish = () => {
    const s = stroke.current
    stroke.current = null
    if (s) applyCloneStroke(s, true)
  }
  // where the copy comes from while the pointer is at `ring` (CSS pixels inside the layer)
  const sourceMark =
    ring && offset
      ? { x: ring.x + offset.dx * cssScale, y: ring.y + offset.dy * cssScale }
      : source && !offset
        ? { x: source.x * cssScale, y: source.y * cssScale }
        : null

  return (
    <div
      ref={layer}
      className="eraser-layer"
      style={{ left: topLeft.x, top: topLeft.y, width: cssWidth, height: bottomRight.y - topLeft.y }}
      onPointerDown={(e) => {
        if (e.button !== 0 || space.current || e.pointerType === 'touch') return
        e.stopPropagation()
        const p = toImage(e)
        const c = useClone.getState()
        if (e.altKey) {
          c.set({ source: { x: p.x, y: p.y }, offset: null })
          return
        }
        if (!c.source) return
        const off = c.offset ?? { dx: Math.round(c.source.x - p.x), dy: Math.round(c.source.y - p.y) }
        if (!c.offset) c.set({ offset: off })
        e.currentTarget.setPointerCapture(e.pointerId)
        stroke.current = {
          dx: off.dx,
          dy: off.dy,
          r: c.size / 2,
          hardness: c.hardness,
          flow: c.flow,
          pts: [],
        }
        dab(stroke.current, p)
        applyCloneStroke(stroke.current, false)
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
        if (!applyCloneStroke(s, false)) finish()
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
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
      {sourceMark && (
        <div className="clone-source" style={{ left: sourceMark.x, top: sourceMark.y }} aria-hidden="true" />
      )}
    </div>
  )
}
