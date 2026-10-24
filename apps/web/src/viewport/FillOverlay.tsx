import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useFill } from '../state/fill'
import { useImage } from '../state/image'
import { useView } from '../state/view'
import { getLiveView, subscribeLiveView } from './liveView'
import { imageToScreen } from './math'

/** While the paint bucket waits for a click: a crosshair over the picture. Esc cancels. */
export function FillOverlay() {
  const picking = useFill((s) => s.picking)
  const image = useImage((s) => s.current)
  const view = useSyncExternalStore(subscribeLiveView, getLiveView)
  const { viewport, dpr, image: size } = useView()
  const layer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!picking) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useFill.getState().set({ picking: false })
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picking])

  if (!picking || !image || !size) return null
  const topLeft = imageToScreen({ x: 0, y: 0 }, view, viewport, dpr)
  const bottomRight = imageToScreen({ x: size.w, y: size.h }, view, viewport, dpr)
  return (
    <div
      ref={layer}
      className="eraser-layer fill-layer"
      style={{
        left: topLeft.x,
        top: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        const rect = layer.current?.getBoundingClientRect()
        if (!rect) return
        void useFill
          .getState()
          .bucketAt(
            ((e.clientX - rect.left) / rect.width) * size.w,
            ((e.clientY - rect.top) / rect.height) * size.h,
          )
      }}
    />
  )
}
