import { useRef, useState, useSyncExternalStore } from 'react'
import { useEdit, committedState } from '../state/edit'
import { useImage } from '../state/image'
import { resolveRatio, useTransform } from '../state/transform'
import { useUi } from '../state/ui'
import { useView } from '../state/view'
import { CURSORS, HANDLES, dragRect, handlePosition, type Handle } from './cropMath'
import { getLiveView, subscribeLiveView } from './liveView'
import { imageToScreen, screenToImage, type Point } from './math'

const HANDLE_SIZE = 11

/** Interactive overlays for the Transform tool: crop box, perspective corners, horizon line. */
export function TransformOverlay() {
  const tool = useUi((s) => s.tool)
  const image = useImage((s) => s.current)
  const view = useSyncExternalStore(subscribeLiveView, getLiveView)
  const { viewport, dpr, image: size } = useView()
  const t = useTransform()
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<null | {
    handle: Handle | 'corner' | 'horizon'
    index: number
    startImage: Point
    startRect?: NonNullable<typeof t.crop>
  }>(null)

  if (tool !== 'transform' || !image || !size) return null
  const toScreen = (p: Point) => imageToScreen(p, view, viewport, dpr)
  const toImage = (e: React.PointerEvent): Point => {
    const rect = svg.current?.getBoundingClientRect()
    return screenToImage(
      { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) },
      view,
      viewport,
      dpr,
    )
  }
  const shown = size
  const ratio = resolveRatio(t.ratioId, t.customRatio, t.landscape, shown.w, shown.h)
  const stop = (e: React.PointerEvent) => e.stopPropagation()

  // ---- horizon line -------------------------------------------------------------------------
  if (t.tab === 'rotate' && t.drawingHorizon) {
    const line = t.horizon
    const a = line && toScreen({ x: line.a[0], y: line.a[1] })
    const b = line && toScreen({ x: line.b[0], y: line.b[1] })
    return (
      <svg
        ref={svg}
        className="overlay overlay-capture"
        style={{ cursor: 'crosshair' }}
        onPointerDown={(e) => {
          stop(e)
          const p = toImage(e)
          t.set({ horizon: { a: [p.x, p.y], b: [p.x, p.y] } })
          setDrag({ handle: 'horizon', index: 0, startImage: p })
          svg.current?.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (drag?.handle !== 'horizon' || !t.horizon) return
          const p = toImage(e)
          t.set({ horizon: { a: t.horizon.a, b: [p.x, p.y] } })
        }}
        onPointerUp={() => setDrag(null)}
      >
        {a && b && (
          <>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="overlay-line" />
            <circle cx={a.x} cy={a.y} r={5} className="overlay-dot" />
            <circle cx={b.x} cy={b.y} r={5} className="overlay-dot" />
          </>
        )}
        <text x={16} y={viewport.h - 16} className="overlay-text">
          Drag along something that should be level (the horizon, a table edge)
        </text>
      </svg>
    )
  }

  // ---- perspective --------------------------------------------------------------------------
  if (t.tab === 'perspective') {
    const quad = t.quad ?? ([[0, 0], [shown.w, 0], [shown.w, shown.h], [0, shown.h]] as [number, number][]) // prettier-ignore
    const points = quad.map(([x, y]) => toScreen({ x, y }))
    return (
      <svg
        ref={svg}
        className="overlay"
        onPointerMove={(e) => {
          if (drag?.handle !== 'corner') return
          const p = toImage(e)
          const next = quad.map((q, i) => (i === drag.index ? [p.x, p.y] : q)) as [number, number][]
          t.set({ quad: next })
          const state = committedState()
          useEdit
            .getState()
            .preview({ ...state, geometry: [...state.geometry, { type: 'perspective', quad: next }] })
        }}
        onPointerUp={() => setDrag(null)}
      >
        <polygon points={points.map((p) => `${p.x},${p.y}`).join(' ')} className="overlay-quad" />
        {points.map((p, i) => (
          <rect
            key={i}
            x={p.x - HANDLE_SIZE / 2}
            y={p.y - HANDLE_SIZE / 2}
            width={HANDLE_SIZE}
            height={HANDLE_SIZE}
            className="overlay-handle"
            rx={3}
            ry={3}
            style={{ cursor: 'move' }}
            onPointerDown={(e) => {
              stop(e)
              svg.current?.setPointerCapture(e.pointerId)
              setDrag({ handle: 'corner', index: i, startImage: toImage(e) })
            }}
          />
        ))}
      </svg>
    )
  }

  // ---- crop ---------------------------------------------------------------------------------
  if (t.tab !== 'crop') return null
  const crop = t.crop ?? { x: 0, y: 0, w: shown.w, h: shown.h }
  const tl = toScreen({ x: crop.x, y: crop.y })
  const br = toScreen({ x: crop.x + crop.w, y: crop.y + crop.h })
  const whole = toScreen({ x: 0, y: 0 })
  const wholeEnd = toScreen({ x: shown.w, y: shown.h })

  const begin = (handle: Handle) => (e: React.PointerEvent) => {
    stop(e)
    svg.current?.setPointerCapture(e.pointerId)
    setDrag({ handle, index: 0, startImage: toImage(e), startRect: crop })
  }
  return (
    <svg
      ref={svg}
      className="overlay"
      onPointerMove={(e) => {
        if (!drag || drag.handle === 'corner' || drag.handle === 'horizon' || !drag.startRect) return
        const p = toImage(e)
        t.set({
          crop: dragRect(
            drag.startRect,
            drag.handle,
            p.x - drag.startImage.x,
            p.y - drag.startImage.y,
            shown,
            ratio,
          ),
        })
      }}
      onPointerUp={() => setDrag(null)}
    >
      <path
        className="overlay-shade"
        fillRule="evenodd"
        d={`M${whole.x} ${whole.y}H${wholeEnd.x}V${wholeEnd.y}H${whole.x}Z M${tl.x} ${tl.y}V${br.y}H${br.x}V${tl.y}Z`}
      />
      <rect
        x={tl.x}
        y={tl.y}
        width={br.x - tl.x}
        height={br.y - tl.y}
        className="overlay-crop"
        style={{ cursor: CURSORS.move }}
        onPointerDown={begin('move')}
        onDoubleClick={() => t.set({ crop: null })}
      />
      {[1, 2].map((k) => (
        <g key={k} className="overlay-thirds">
          <line x1={tl.x + ((br.x - tl.x) * k) / 3} y1={tl.y} x2={tl.x + ((br.x - tl.x) * k) / 3} y2={br.y} />
          <line x1={tl.x} y1={tl.y + ((br.y - tl.y) * k) / 3} x2={br.x} y2={tl.y + ((br.y - tl.y) * k) / 3} />
        </g>
      ))}
      {HANDLES.map((h) => {
        const [hx, hy] = handlePosition(crop, h)
        const p = toScreen({ x: hx, y: hy })
        return (
          <rect
            key={h}
            x={p.x - HANDLE_SIZE / 2}
            y={p.y - HANDLE_SIZE / 2}
            width={HANDLE_SIZE}
            height={HANDLE_SIZE}
            className="overlay-handle"
            rx={3}
            ry={3}
            style={{ cursor: CURSORS[h] }}
            onPointerDown={begin(h)}
          />
        )
      })}
      <text x={tl.x + 6} y={Math.max(14, tl.y - 8)} className="overlay-text">
        {crop.w} × {crop.h}
      </text>
    </svg>
  )
}
