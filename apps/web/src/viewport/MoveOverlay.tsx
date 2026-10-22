import { useEffect, useRef, useSyncExternalStore } from 'react'
import { committedState, useEdit } from '../state/edit'
import { useImage } from '../state/image'
import { commitLayer, previewLayer, useLayerPictures } from '../state/layers'
import { useUi } from '../state/ui'
import { useView } from '../state/view'
import { getLiveView, subscribeLiveView } from './liveView'
import { imageToScreen, type Point } from './math'

/**
 * The Move tool: drag to move the selected layer on the picture (Shift keeps it on a straight line). Arrow keys
 * nudge it by 1 pixel (10 with Shift). Hold Space or use the middle button to pan the canvas instead.
 */
export function MoveOverlay() {
  const tool = useUi((s) => s.tool)
  const image = useImage((s) => s.current)
  const view = useSyncExternalStore(subscribeLiveView, getLiveView)
  const { viewport, dpr, image: size } = useView()
  const selected = useLayerPictures((s) => s.selected)
  const layer = useRef<HTMLDivElement>(null)
  const drag = useRef<{ start: Point; x: number; y: number } | null>(null)
  const space = useRef(false)
  const active = tool === 'move' && !!image && !!size

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = e.type === 'keydown'
      if (e.type !== 'keydown' || !selected) return
      const step = e.shiftKey ? 10 : 1
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      const target = (committedState().layers ?? []).find((l) => l.id === selected)
      if ((dx || dy) && target) {
        e.preventDefault()
        commitLayer('Move layer', selected, { x: target.x + dx, y: target.y + dy })
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [active, selected])

  if (!active || !size) return null
  const topLeft = imageToScreen({ x: 0, y: 0 }, view, viewport, dpr)
  const bottomRight = imageToScreen({ x: size.w, y: size.h }, view, viewport, dpr)
  const toImage = (e: React.PointerEvent): Point => {
    const rect = layer.current?.getBoundingClientRect()
    return {
      x: ((e.clientX - (rect?.left ?? 0)) / (rect?.width || 1)) * size.w,
      y: ((e.clientY - (rect?.top ?? 0)) / (rect?.height || 1)) * size.h,
    }
  }
  const finish = () => {
    const d = drag.current
    drag.current = null
    if (d && selected) {
      const t = (useEdit.getState().live?.layers ?? committedState().layers ?? []).find(
        (l) => l.id === selected,
      )
      if (t) commitLayer('Move layer', selected, { x: t.x, y: t.y })
    }
  }

  return (
    <div
      ref={layer}
      className="eraser-layer move-layer"
      data-empty={!selected}
      title={selected ? 'Drag to move the selected layer' : 'Select a layer in Layers first'}
      style={{
        left: topLeft.x,
        top: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      }}
      onPointerDown={(e) => {
        if (e.button !== 0 || space.current || !selected || e.pointerType === 'touch') return
        const t = (committedState().layers ?? []).find((l) => l.id === selected)
        if (!t) return
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { start: toImage(e), x: t.x, y: t.y }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || !selected) return
        const p = toImage(e)
        let dx = p.x - d.start.x
        let dy = p.y - d.start.y
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0
          else dx = 0
        }
        previewLayer(selected, { x: Math.round(d.x + dx), y: Math.round(d.y + dy) })
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        drag.current = null
        useEdit.getState().preview(null)
      }}
    />
  )
}
