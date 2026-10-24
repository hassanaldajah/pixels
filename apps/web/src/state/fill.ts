import { create } from 'zustand'
import { floodMask, paintGradient, type Box, type GradientSpec } from '../lib/fill'
import { outputColors } from '../tokens'
import { MAX_DRAW_SIDE } from './draw'
import { useImage } from './image'
import { useLayerPictures } from './layers'

export type FillKind = 'solid' | 'gradient' | 'bucket'

interface FillStore {
  kind: FillKind
  color: string
  color2: string
  gradient: GradientSpec['kind']
  angle: number
  tolerance: number // 0..100
  contiguous: boolean
  feather: number // px
  /** Waiting for a click on the picture (paint bucket). */
  picking: boolean
  busy: boolean
  error: string | null
  set: (patch: Partial<Omit<FillStore, 'set' | 'addWhole' | 'bucketAt'>>) => void
  /** A solid colour or gradient over the whole picture. */
  addWhole: () => Promise<void>
  /** Fill the area around an image point whose colour is close to the colour there. */
  bucketAt: (x: number, y: number) => Promise<void>
}

const canvasOf = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas is not available.')
  return [canvas, ctx]
}

async function addCanvas(
  canvas: HTMLCanvasElement,
  name: string,
  place: { x: number; y: number; scale: number },
) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The fill could not be made.')
  await useLayerPictures.getState().add(new File([blob], name, { type: 'image/png' }), place)
}

export const useFill = create<FillStore>((set, get) => ({
  kind: 'solid',
  color: outputColors.white,
  color2: outputColors.black,
  gradient: 'linear',
  angle: 90,
  tolerance: 20,
  contiguous: true,
  feather: 1,
  picking: false,
  busy: false,
  error: null,
  set: (patch) => set(patch),

  addWhole: async () => {
    const image = useImage.getState().current
    if (!image || get().busy) return
    const { kind, color, color2, gradient, angle } = get()
    set({ busy: true, error: null })
    try {
      const ratio = Math.min(1, MAX_DRAW_SIDE / Math.max(image.width, image.height))
      const w = Math.max(1, Math.round(image.width * ratio))
      const h = Math.max(1, Math.round(image.height * ratio))
      const [canvas, ctx] = canvasOf(w, h)
      if (kind === 'gradient') paintGradient(ctx, w, h, { kind: gradient, from: color, to: color2, angle })
      else {
        ctx.fillStyle = color
        ctx.fillRect(0, 0, w, h)
      }
      await addCanvas(canvas, kind === 'gradient' ? 'gradient.png' : 'colour.png', {
        x: 0,
        y: 0,
        scale: 1 / ratio,
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'The fill could not be made.' })
    } finally {
      set({ busy: false })
    }
  },

  bucketAt: async (x, y) => {
    const image = useImage.getState().current
    if (!image || get().busy) return
    const { color, tolerance, contiguous, feather } = get()
    set({ busy: true, picking: false, error: null })
    try {
      const ratio = Math.min(1, MAX_DRAW_SIDE / Math.max(image.width, image.height))
      const w = Math.max(1, Math.round(image.width * ratio))
      const h = Math.max(1, Math.round(image.height * ratio))
      const [, src] = canvasOf(w, h)
      src.drawImage(image.bitmap, 0, 0, w, h)
      const pixels = src.getImageData(0, 0, w, h)
      const { mask, box } = floodMask(pixels.data, w, h, x * ratio, y * ratio, tolerance, contiguous)
      if (!box) {
        set({ error: 'Click on the picture to fill.' })
        return
      }
      const pad = Math.ceil(feather * 2)
      // The area reaches `pad` past the fill on every side, even past the picture's edge: there the mask
      // repeats its edge pixels, so the soft edge never fades a fill that touches the border.
      const area: Box = { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad }
      const clampX = (v: number) => Math.min(w - 1, Math.max(0, v))
      const clampY = (v: number) => Math.min(h - 1, Math.max(0, v))
      const [maskCanvas, maskCtx] = canvasOf(area.w, area.h)
      const alpha = maskCtx.createImageData(area.w, area.h)
      for (let row = 0; row < area.h; row++) {
        const line = clampY(area.y + row) * w
        for (let col = 0; col < area.w; col++)
          alpha.data[(row * area.w + col) * 4 + 3] = mask[line + clampX(area.x + col)]!
      }
      maskCtx.putImageData(alpha, 0, 0)
      const [out, ctx] = canvasOf(area.w, area.h)
      ctx.fillStyle = color
      ctx.fillRect(0, 0, area.w, area.h)
      ctx.globalCompositeOperation = 'destination-in'
      if (feather > 0) ctx.filter = `blur(${feather * ratio}px)`
      ctx.drawImage(maskCanvas, 0, 0)
      await addCanvas(out, 'fill.png', { x: area.x / ratio, y: area.y / ratio, scale: 1 / ratio })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'The fill could not be made.' })
    } finally {
      set({ busy: false })
    }
  },
}))
