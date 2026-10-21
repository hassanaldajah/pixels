import { useImage } from '../state/image'
import { useView } from '../state/view'
import { useCursor } from '../viewport/liveView'
import { formatZoom } from '../viewport/math'

export function CanvasHud() {
  const image = useImage((s) => s.current)
  const zoom = useView((s) => s.target.zoom)
  const cursor = useCursor((s) => s.image)
  const shown = useView((s) => s.image) // the picture as edited: size changes with crops and rotations
  if (!image || !shown) return null
  return (
    <div className="hud glass" aria-hidden="true">
      <span>{formatZoom(zoom)}</span>
      <span>
        {shown.w} × {shown.h}
      </span>
      <span className="hud-cursor">{cursor ? `x ${cursor.x}  y ${cursor.y}` : 'x –  y –'}</span>
    </div>
  )
}
