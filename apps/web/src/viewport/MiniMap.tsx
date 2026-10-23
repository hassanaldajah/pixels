import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useImage } from '../state/image'
import { useView } from '../state/view'
import { getLiveView, subscribeLiveView } from './liveView'

const WIDTH = 150

export function MiniMap() {
  const t = useT()
  const image = useImage((s) => s.current)
  const frame = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState({ x: 0, y: 0, w: 1, h: 1 })
  const dragging = useRef(false)

  useEffect(() => {
    const update = () => {
      const { image: size, viewport, dpr } = useView.getState()
      if (!size) return
      const v = getLiveView()
      const scale = v.zoom / dpr
      const visW = viewport.w / scale
      const visH = viewport.h / scale
      const x = (v.panX - visW / 2) / size.w
      const y = (v.panY - visH / 2) / size.h
      setRect({ x, y, w: visW / size.w, h: visH / size.h })
    }
    update()
    const a = subscribeLiveView(update)
    const b = useView.subscribe(update)
    return () => {
      a()
      b()
    }
  }, [image])

  if (!image) return null
  const height = Math.round((WIDTH * image.height) / image.width)
  const fullyVisible = rect.x <= 0 && rect.y <= 0 && rect.x + rect.w >= 1 && rect.y + rect.h >= 1

  const moveTo = (e: React.PointerEvent) => {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return
    useView
      .getState()
      .panTo(
        ((e.clientX - box.left) / box.width) * image.width,
        ((e.clientY - box.top) / box.height) * image.height,
      )
  }

  return (
    <div
      className="minimap glass"
      data-dim={fullyVisible}
      style={{ width: WIDTH, height }}
      onPointerDown={(e) => {
        e.stopPropagation()
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        moveTo(e)
      }}
      onPointerMove={(e) => {
        e.stopPropagation()
        if (dragging.current) moveTo(e)
      }}
      onPointerUp={(e) => {
        e.stopPropagation()
        dragging.current = false
      }}
      aria-label={t('Mini-map: drag to move the view')}
    >
      <div ref={frame} className="minimap-frame">
        <img src={image.thumbUrl} alt="" draggable={false} />
        <div
          className="minimap-view"
          style={{
            left: `${Math.max(0, rect.x) * 100}%`,
            top: `${Math.max(0, rect.y) * 100}%`,
            width: `${Math.min(1, rect.w) * 100}%`,
            height: `${Math.min(1, rect.h) * 100}%`,
          }}
        />
      </div>
    </div>
  )
}
