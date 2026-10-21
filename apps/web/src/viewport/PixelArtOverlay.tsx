import { useEffect, useSyncExternalStore } from 'react'
import { pixelArtPreview } from '../api/edit'
import type { EditState } from '../engine/types'
import { useDisplayedState } from '../state/edit'
import { useImage } from '../state/image'
import { usePixelPreview } from '../state/pixelPreview'
import { useView } from '../state/view'
import { getLiveView, subscribeLiveView } from './liveView'
import { imageToScreen } from './math'

const DEBOUNCE_MS = 220

/**
 * Shows the pixel-art version of the picture over the image while the edit state has pixel art on. The
 * picture comes from the server (it is the same code the export uses, so the preview is what you get),
 * and is drawn with nearest-neighbour filtering so every art pixel stays a crisp square at any zoom.
 */
export function PixelArtOverlay() {
  const image = useImage((s) => s.current)
  const state = useDisplayedState()
  const view = useSyncExternalStore(subscribeLiveView, getLiveView)
  const { viewport, dpr, image: size } = useView()
  const url = usePixelPreview((s) => s.url)
  const on = Boolean(state.pixelart)
  const json = JSON.stringify(state)
  const imageId = image?.id

  useEffect(() => {
    const preview = usePixelPreview.getState()
    if (!on || !imageId) {
      preview.clear()
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      preview.begin()
      pixelArtPreview(imageId, JSON.parse(json) as EditState, controller.signal)
        .then((result) =>
          controller.signal.aborted ? URL.revokeObjectURL(result.url) : preview.show(result),
        )
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          preview.fail(error instanceof Error ? error.message : 'The preview failed.')
        })
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [on, imageId, json])

  if (!on || !url || !size) return null
  const topLeft = imageToScreen({ x: 0, y: 0 }, view, viewport, dpr)
  const bottomRight = imageToScreen({ x: size.w, y: size.h }, view, viewport, dpr)
  return (
    <img
      className="pixelart-overlay"
      src={url}
      alt=""
      draggable={false}
      style={{
        left: topLeft.x,
        top: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      }}
    />
  )
}
