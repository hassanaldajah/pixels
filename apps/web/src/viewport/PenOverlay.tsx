import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useDisplayedState } from '../state/edit'
import { useImage } from '../state/image'
import { useLayerPictures } from '../state/layers'
import { usePen } from '../state/pen'
import { useUi } from '../state/ui'
import { useView } from '../state/view'
import { svgPath, type PenNode } from '../lib/penPath'
import { getLiveView, subscribeLiveView } from './liveView'
import { imageToScreen } from './math'

type Drag =
  | { kind: 'new'; index: number; x: number; y: number }
  | { kind: 'node'; index: number }
  | { kind: 'handle'; index: number; side: 'in' | 'out'; free: boolean }

const HIT = 8 // screen pixels

/**
 * The Pen tool on the picture. Click: a corner point. Click and drag: a curved point. Click the first point:
 * close the shape. Drag a point or a handle to change it (Alt moves one handle alone).
 * Backspace removes the last point, Enter adds the shape as a layer, Esc starts over.
 */
export function PenOverlay() {
  const tool = useUi((s) => s.tool)
  const image = useImage((s) => s.current)
  const view = useSyncExternalStore(subscribeLiveView, getLiveView)
  const { viewport, dpr, image: size } = useView()
  const pen = usePen()
  const selected = useLayerPictures((s) => s.selected)
  const layers = useDisplayedState().layers
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const active = tool === 'path' && !!image && !!size

  // selecting a path layer while the Pen is active brings its points back for editing
  const pathLayer = (layers ?? []).find((l) => l.id === selected && l.source?.kind === 'path')
  useEffect(() => {
    if (
      active &&
      pathLayer &&
      usePen.getState().editing !== pathLayer.id &&
      usePen.getState().nodes.length === 0
    )
      usePen.getState().loadLayer(pathLayer)
    // also when the pen becomes empty (a path was just added): its new layer is selected, ready for tweaks
  }, [active, pathLayer, pen.nodes.length, pen.editing])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return
      const p = usePen.getState()
      if (e.key === 'Backspace' && p.nodes.length && !p.closed) {
        e.preventDefault()
        p.set({ nodes: p.nodes.slice(0, -1) })
      } else if (e.key === 'Enter') void p.commit()
      else if (e.key === 'Escape') p.reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  if (!active || !size) return null
  const topLeft = imageToScreen({ x: 0, y: 0 }, view, viewport, dpr)
  const bottomRight = imageToScreen({ x: size.w, y: size.h }, view, viewport, dpr)
  const cssW = bottomRight.x - topLeft.x
  const cssH = bottomRight.y - topLeft.y
  const k = cssW / size.w
  const toScreen = (x: number, y: number): [number, number] => [x * k, y * k]
  const toImage = (e: { clientX: number; clientY: number }) => {
    const rect = box.current?.getBoundingClientRect()
    return { x: (e.clientX - (rect?.left ?? 0)) / k, y: (e.clientY - (rect?.top ?? 0)) / k }
  }
  const near = (ax: number, ay: number, bx: number, by: number) =>
    Math.hypot((ax - bx) * k, (ay - by) * k) < HIT

  const update = (index: number, patch: Partial<PenNode>) =>
    usePen
      .getState()
      .set({ nodes: usePen.getState().nodes.map((n, i) => (i === index ? { ...n, ...patch } : n)) })

  return (
    <div
      ref={box}
      className="eraser-layer pen-layer"
      style={{ left: topLeft.x, top: topLeft.y, width: cssW, height: cssH }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        const p = toImage(e)
        const { nodes, closed } = usePen.getState()
        // a handle of any point
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i] as PenNode
          for (const side of ['in', 'out'] as const) {
            const h = n[side]
            if (h && near(p.x, p.y, n.x + h[0], n.y + h[1])) {
              drag.current = { kind: 'handle', index: i, side, free: e.altKey }
              return
            }
          }
        }
        // the first point closes an open shape; any other point is moved
        const hit = nodes.findIndex((n) => near(p.x, p.y, n.x, n.y))
        if (hit === 0 && !closed && nodes.length > 2) {
          usePen.getState().set({ closed: true })
          return
        }
        if (hit >= 0) {
          drag.current = { kind: 'node', index: hit }
          return
        }
        if (closed) return
        usePen.getState().set({ nodes: [...nodes, { x: p.x, y: p.y }] })
        drag.current = { kind: 'new', index: nodes.length, x: p.x, y: p.y }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const p = toImage(e)
        const n = usePen.getState().nodes[d.index]
        if (!n) return
        if (d.kind === 'new') {
          // dragging out of a new point makes it smooth: mirrored handles
          if (Math.hypot((p.x - d.x) * k, (p.y - d.y) * k) < 3) return
          update(d.index, { out: [p.x - d.x, p.y - d.y], in: [d.x - p.x, d.y - p.y] })
        } else if (d.kind === 'node') update(d.index, { x: p.x, y: p.y })
        else {
          const h: [number, number] = [p.x - n.x, p.y - n.y]
          const other = d.side === 'in' ? 'out' : 'in'
          update(d.index, d.free || !n[other] ? { [d.side]: h } : { [d.side]: h, [other]: [-h[0], -h[1]] })
        }
      }}
      onPointerUp={() => {
        drag.current = null
      }}
    >
      <svg width={cssW} height={cssH} className="pen-svg" aria-hidden="true">
        {pen.fill && pen.closed && (
          <path d={svgPath(pen, toScreen)} className="pen-fill" style={{ fill: pen.fill }} />
        )}
        <path d={svgPath(pen, toScreen)} className="pen-line" />
        {pen.nodes.map((n, i) => {
          const [sx, sy] = toScreen(n.x, n.y)
          return (
            <g key={i}>
              {(['in', 'out'] as const).map((side) => {
                const h = n[side]
                if (!h) return null
                const [hx, hy] = toScreen(n.x + h[0], n.y + h[1])
                return (
                  <g key={side}>
                    <line x1={sx} y1={sy} x2={hx} y2={hy} className="pen-handle-line" />
                    <circle cx={hx} cy={hy} r={4} className="pen-handle" />
                  </g>
                )
              })}
              <rect
                x={sx - 4.5}
                y={sy - 4.5}
                width={9}
                height={9}
                className={
                  i === 0 && !pen.closed && pen.nodes.length > 2 ? 'pen-node pen-node-first' : 'pen-node'
                }
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
