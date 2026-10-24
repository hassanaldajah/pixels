import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Stroke } from '../engine/types'
import { useDisplayedState, useEdit } from '../state/edit'
import { useImage } from '../state/image'
import { applyMaskStroke, useLayerMask } from '../state/layerMask'
import { useLayerPictures } from '../state/layers'
import { useView } from '../state/view'
import { getLiveView, subscribeLiveView } from './liveView'
import { imageToScreen, type Point } from './math'

const SPACING = 0.18 // distance between dabs, as a fraction of the brush size

/**
 * Painting the selected layer's mask: strokes are stored in the layer's own pixels, so the mask moves and
 * scales with the layer. Hold Alt (or pick Reveal) to bring hidden parts back. Esc stops painting.
 */
export function LayerMaskOverlay() {
  const painting = useLayerMask((s) => s.painting)
  const size = useLayerMask((s) => s.size)
  const selected = useLayerPictures((s) => s.selected)
  const image = useImage((s) => s.current)
  const view = useSyncExternalStore(subscribeLiveView, getLiveView)
  const { viewport, dpr, image: canvas } = useView()
  const layerBox = useRef<HTMLDivElement>(null)
  const stroke = useRef<Stroke | null>(null)
  const space = useRef(false)
  const [ring, setRing] = useState<Point | null>(null)
  const layers = useDisplayedState().layers
  const layer = (layers ?? []).find((l) => l.id === selected)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = e.type === 'keydown'
      if (e.type === 'keydown' && e.key === 'Escape') useLayerMask.getState().set({ painting: false })
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [])

  if (!painting || !image || !canvas || !layer) return null
  const topLeft = imageToScreen({ x: 0, y: 0 }, view, viewport, dpr)
  const bottomRight = imageToScreen({ x: canvas.w, y: canvas.h }, view, viewport, dpr)
  const cssWidth = bottomRight.x - topLeft.x
  const cssScale = cssWidth / canvas.w

  /** Screen point -> the layer's own pixels (undo its move and scale). */
  const toLayer = (e: React.PointerEvent): Point => {
    const rect = layerBox.current?.getBoundingClientRect()
    const x = ((e.clientX - (rect?.left ?? 0)) / (rect?.width || 1)) * canvas.w
    const y = ((e.clientY - (rect?.top ?? 0)) / (rect?.height || 1)) * canvas.h
    return { x: (x - layer.x) / layer.scale, y: (y - layer.y) / layer.scale }
  }
  const finish = () => {
    const s = stroke.current
    stroke.current = null
    if (s) applyMaskStroke(layer.id, s, true)
  }

  return (
    <div
      ref={layerBox}
      className="eraser-layer mask-layer"
      style={{ left: topLeft.x, top: topLeft.y, width: cssWidth, height: bottomRight.y - topLeft.y }}
      onPointerDown={(e) => {
        if (e.button !== 0 || space.current) return
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        const m = useLayerMask.getState()
        const p = toLayer(e)
        stroke.current = {
          r: Math.max(1, m.size / 2 / layer.scale),
          hardness: m.hardness,
          flow: m.flow,
          erase: m.reveal !== e.altKey,
          pts: [[Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]],
        }
        applyMaskStroke(layer.id, stroke.current, false)
      }}
      onPointerMove={(e) => {
        const rect = layerBox.current?.getBoundingClientRect()
        setRing({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) })
        const s = stroke.current
        if (!s) return
        const p = toLayer(e)
        const last = s.pts[s.pts.length - 1] as [number, number]
        const gap = Math.hypot(p.x - last[0], p.y - last[1])
        const step = Math.max(1, s.r * 2 * SPACING)
        if (gap < step) return
        const n = Math.floor(gap / step)
        for (let i = 1; i <= n; i++) {
          const x = last[0] + ((p.x - last[0]) * i) / n
          const y = last[1] + ((p.y - last[1]) * i) / n
          s.pts.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10])
        }
        if (!applyMaskStroke(layer.id, s, false)) finish()
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
          style={{ left: ring.x, top: ring.y, width: size * cssScale, height: size * cssScale }}
        />
      )}
    </div>
  )
}
