import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { beginStroke, getMaskCanvas, resetMask, stroke } from '../lib/eraserMask'
import { useEraser } from '../state/eraser'
import { useImage } from '../state/image'
import { useUi } from '../state/ui'
import { useView } from '../state/view'
import { getLiveView, subscribeLiveView } from './liveView'
import { imageToScreen, type Point } from './math'

/**
 * The Eraser tool's brush: paint over what you want gone. The paint is a mask the size of the picture, drawn
 * in the accent colour; hold Alt to rub paint out instead. Hold Space or use the middle button to pan.
 */
export function EraserOverlay() {
  const tool = useUi((s) => s.tool)
  const image = useImage((s) => s.current)
  const view = useSyncExternalStore(subscribeLiveView, getLiveView)
  const { viewport, dpr, image: size } = useView()
  const brush = useEraser((s) => s.brush)
  const busy = useEraser((s) => s.busy)
  const layer = useRef<HTMLDivElement>(null)
  const last = useRef<Point | null>(null)
  const space = useRef(false)
  const [ring, setRing] = useState<Point | null>(null)
  const imageId = image?.id
  const width = size?.w
  const height = size?.h
  const shown = (tool === 'eraser' || tool === 'background') && imageId !== undefined && width !== undefined

  // a fresh, empty mask whenever the picture (or the size it is shown at) changes
  useEffect(() => {
    if (!width || !height) return
    resetMask(width, height)
    useEraser.getState().sync()
  }, [imageId, width, height])

  // the mask canvas lives inside the layer while the tool is open
  useEffect(() => {
    const element = layer.current
    if (!element) return
    const canvas = getMaskCanvas()
    canvas.className = 'eraser-mask'
    element.prepend(canvas)
    return () => canvas.remove()
  }, [shown])

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

  if (!shown || !size) return null
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
  const color = () => getComputedStyle(document.documentElement).getPropertyValue('--px-accent').trim()
  const painting = (e: React.PointerEvent) =>
    e.altKey ? !useEraser.getState().paint : useEraser.getState().paint
  const finish = () => {
    if (!last.current) return
    last.current = null
    useEraser.getState().sync()
  }

  return (
    <div
      ref={layer}
      className="eraser-layer"
      data-busy={busy}
      style={{ left: topLeft.x, top: topLeft.y, width: cssWidth, height: bottomRight.y - topLeft.y }}
      onPointerDown={(e) => {
        if (busy || e.button !== 0 || space.current || e.pointerType === 'touch') return
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        beginStroke()
        const p = toImage(e)
        last.current = p
        stroke(p, p, useEraser.getState().brush, painting(e), color())
      }}
      onPointerMove={(e) => {
        const p = toImage(e)
        const rect = layer.current?.getBoundingClientRect()
        setRing({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) })
        if (!last.current) return
        stroke(last.current, p, useEraser.getState().brush, painting(e), color())
        last.current = p
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={() => setRing(null)}
    >
      {ring && !busy && (
        <div
          className="eraser-ring"
          style={{ left: ring.x, top: ring.y, width: brush * cssScale, height: brush * cssScale }}
        />
      )}
    </div>
  )
}
