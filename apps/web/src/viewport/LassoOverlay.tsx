import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { MAX_SELECTION_POINTS } from '../engine/types'
import { simplifyPath } from '../lib/simplifyPath'
import { committedState, useEdit } from '../state/edit'
import { useImage } from '../state/image'
import { useUi } from '../state/ui'
import { useView } from '../state/view'
import { getLiveView, subscribeLiveView } from './liveView'
import { imageToScreen, type Point } from './math'

/**
 * The Lasso tool: draw around an area by dragging. When you let go the shape closes and becomes the selection,
 * so the Adjust edits apply only inside it. Hold Space or use the middle button to pan the canvas instead.
 */
export function LassoOverlay() {
  const tool = useUi((s) => s.tool)
  const image = useImage((s) => s.current)
  const view = useSyncExternalStore(subscribeLiveView, getLiveView)
  const { viewport, dpr, image: size } = useView()
  const layer = useRef<HTMLDivElement>(null)
  const points = useRef<Point[] | null>(null)
  const space = useRef(false)
  const [path, setPath] = useState<Point[]>([])
  const active = tool === 'lasso' && !!image && !!size

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = e.type === 'keydown'
      if (e.key === 'Escape') {
        points.current = null
        setPath([])
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [active])

  if (!active || !size) return null
  const topLeft = imageToScreen({ x: 0, y: 0 }, view, viewport, dpr)
  const bottomRight = imageToScreen({ x: size.w, y: size.h }, view, viewport, dpr)
  const cssW = bottomRight.x - topLeft.x
  const cssH = bottomRight.y - topLeft.y
  const toImage = (e: React.PointerEvent): Point => {
    const rect = layer.current?.getBoundingClientRect()
    return {
      x: ((e.clientX - (rect?.left ?? 0)) / (rect?.width || 1)) * size.w,
      y: ((e.clientY - (rect?.top ?? 0)) / (rect?.height || 1)) * size.h,
    }
  }
  const finish = () => {
    const raw = points.current
    points.current = null
    setPath([])
    if (!raw || raw.length < 3) return
    const pts = simplifyPath(
      raw.map((p) => [p.x, p.y] as [number, number]),
      MAX_SELECTION_POINTS,
    ).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as [number, number])
    if (pts.length < 3) return
    const previous = committedState().selection
    useEdit.getState().commit('Lasso selection', {
      ...committedState(),
      selection: {
        kind: 'polygon',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        points: pts,
        feather: previous?.feather ?? 0,
        invert: previous?.invert ?? false,
      },
    })
  }
  const d = path
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x / size.w) * cssW},${(p.y / size.h) * cssH}`)
    .join(' ')

  return (
    <div
      ref={layer}
      className="eraser-layer lasso-layer"
      style={{ left: topLeft.x, top: topLeft.y, width: cssW, height: cssH }}
      onPointerDown={(e) => {
        if (e.button !== 0 || space.current || e.pointerType === 'touch') return
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        points.current = [toImage(e)]
        setPath(points.current)
      }}
      onPointerMove={(e) => {
        const list = points.current
        if (!list) return
        const p = toImage(e)
        const last = list[list.length - 1] as Point
        if (Math.hypot(p.x - last.x, p.y - last.y) < 1.5) return
        list.push(p)
        setPath([...list])
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        points.current = null
        setPath([])
      }}
    >
      {path.length > 1 && (
        <svg width={cssW} height={cssH} className="lasso-path" aria-hidden="true">
          <path d={`${d} Z`} />
        </svg>
      )}
    </div>
  )
}
