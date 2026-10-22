import { useEffect, useRef, type MutableRefObject } from 'react'
import { GpuPipeline, type RenderResult } from '../engine/pipeline'
import { isEmptyState, type EditState } from '../engine/types'
import { displayedState, useEdit } from '../state/edit'
import { useImage } from '../state/image'
import { useLayerPictures } from '../state/layers'
import { QUALITY, useUi } from '../state/ui'
import { useView } from '../state/view'
import type { GlViewport, Layer } from './renderer'

const SIDE_GAP = 0.04 // fraction of the width left between the two halves of a side-by-side view
const ORIGINAL_EDGE_CAP = 8192

declare global {
  interface Window {
    /** Present only when localStorage["pixels.e2e"] is "1": lets the browser test drive the engine. */
    __pixelsE2E?: {
      engineReady: boolean
      readOutput: () => ReturnType<GpuPipeline['readOutput']>
      commit: (state: EditState) => void
    }
  }
}

function e2eEnabled(): boolean {
  try {
    return localStorage.getItem('pixels.e2e') === '1'
  } catch {
    return false
  }
}

function proxyEdge(quality: keyof typeof QUALITY, maxTexture: number): number {
  return QUALITY[quality].maxEdge ?? Math.min(maxTexture, ORIGINAL_EDGE_CAP)
}

/**
 * Connects the edit state to the viewport: keeps a downscaled copy of the image on the GPU, runs the
 * pipeline whenever the state or the compare mode changes, and hands the result to the renderer.
 * With no edits the viewport shows the original tiles at full resolution instead.
 */
export function useEngine(gl: MutableRefObject<GlViewport | null>, markDirty: () => void): void {
  const pipeline = useRef<GpuPipeline | null>(null)
  const frame = useRef(0)
  const ready = useRef(false)
  const lastSize = useRef<{ w: number; h: number } | null>(null)
  const image = useImage((s) => s.current)
  const quality = useUi((s) => s.quality)

  const draw = useRef(() => {})
  draw.current = () => {
    const renderer = gl.current
    const engine = pipeline.current
    const current = useImage.getState().current
    if (!renderer || !current) return
    const state = displayedState()
    const compare = useEdit.getState().compare
    if (isEmptyState(state) && compare.mode === 'off') {
      renderer.setLayers(null)
      useView.getState().resizeImage({ w: current.width, h: current.height })
      markDirty()
      return
    }
    if (!engine || !ready.current) return
    const result: RenderResult = engine.run(state)
    const { fullW, fullH } = result
    const before = { texture: result.geometryOnly, rect: [0, 0, fullW, fullH] as Layer['rect'] }
    const after = { texture: result.out, rect: [0, 0, fullW, fullH] as Layer['rect'] }
    let layers: Layer[]
    let layout = { w: fullW, h: fullH }
    if (compare.mode === 'split' && !compare.hold) {
      const x = compare.split * fullW
      layers = [{ ...before, clipX: [0, x] }, { ...after, clipX: [x, fullW] }] // prettier-ignore
    } else if (compare.mode === 'side') {
      const gap = Math.round(fullW * SIDE_GAP)
      layers = [before, { ...after, rect: [fullW + gap, 0, fullW, fullH] }]
      layout = { w: fullW * 2 + gap, h: fullH }
    } else layers = [compare.hold ? before : after]
    renderer.setLayers(layers, layout)
    // While a handle is being dragged the picture may change size every frame; refit only on release.
    const dragging = useEdit.getState().live !== null
    if (!dragging && (lastSize.current?.w !== layout.w || lastSize.current?.h !== layout.h)) {
      lastSize.current = layout
      useView.getState().resizeImage(layout)
    }
    markDirty()
  }

  const schedule = useRef(() => {})
  schedule.current = () => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      draw.current()
    })
  }

  // Upload a downscaled copy whenever the image or the quality changes.
  useEffect(() => {
    const renderer = gl.current
    if (!renderer || !image) {
      ready.current = false
      lastSize.current = null
      return
    }
    let cancelled = false
    ready.current = false
    void (async () => {
      const context = renderer.context
      pipeline.current ??= new GpuPipeline(context)
      const maxTexture = context.getParameter(context.MAX_TEXTURE_SIZE) as number
      const edge = proxyEdge(quality, maxTexture)
      const f = Math.min(1, edge / Math.max(image.width, image.height))
      const bitmap =
        f < 1
          ? await createImageBitmap(image.blob, {
              resizeWidth: Math.max(1, Math.round(image.width * f)),
              resizeHeight: Math.max(1, Math.round(image.height * f)),
              resizeQuality: 'high',
              premultiplyAlpha: 'none',
              colorSpaceConversion: 'none',
            })
          : image.bitmap
      if (cancelled) {
        if (f < 1) bitmap.close()
        return
      }
      pipeline.current.setSource(bitmap, image.width, image.height)
      if (f < 1) bitmap.close()
      ready.current = true
      lastSize.current = null
      if (e2eEnabled())
        window.__pixelsE2E = {
          engineReady: true,
          readOutput: () => pipeline.current?.readOutput() ?? null,
          commit: (state) => useEdit.getState().commit('test', state),
        }
      schedule.current()
    })()
    return () => {
      cancelled = true
    }
  }, [image, quality, gl])

  // Layer pictures: load any the edit refers to, keep the GPU copies in step, and redraw when one arrives.
  useEffect(() => {
    const sync = () => {
      const engine = pipeline.current
      const { pictures, ensure } = useLayerPictures.getState()
      const wanted = new Set((displayedState().layers ?? []).map((l) => l.image_id))
      for (const id of wanted) if (!pictures[id]) void ensure(id)
      const renderer = gl.current
      if (!engine || !ready.current || !renderer) return
      const maxTexture = renderer.context.getParameter(renderer.context.MAX_TEXTURE_SIZE) as number
      const edge = Math.min(maxTexture, ORIGINAL_EDGE_CAP)
      for (const id of wanted) {
        const picture = pictures[id]
        if (!picture || engine.hasLayerImage(id)) continue
        const f = Math.min(1, edge / Math.max(picture.width, picture.height))
        if (f < 1) {
          void createImageBitmap(picture.blob, {
            resizeWidth: Math.max(1, Math.round(picture.width * f)),
            resizeHeight: Math.max(1, Math.round(picture.height * f)),
            resizeQuality: 'high',
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'none',
          }).then((small) => {
            pipeline.current?.setLayerImage(id, small, picture.width, picture.height)
            small.close()
            schedule.current()
          })
        } else engine.setLayerImage(id, picture.bitmap, picture.width, picture.height)
      }
    }
    sync()
    const offEdit = useEdit.subscribe(() => {
      sync()
      schedule.current()
    })
    const offPictures = useLayerPictures.subscribe(() => {
      sync()
      schedule.current()
    })
    return () => {
      offEdit()
      offPictures()
    }
  }, [image, quality, gl])

  // Redraw when the state, the dragged state or the compare mode changes.
  useEffect(() => {
    const unsubscribe = useEdit.subscribe(() => schedule.current())
    schedule.current()
    return unsubscribe
  }, [image])

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      pipeline.current?.dispose()
      pipeline.current = null
    },
    [],
  )
}
