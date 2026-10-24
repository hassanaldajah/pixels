import { create } from 'zustand'
import { outputColors } from '../tokens'
import { useImage } from './image'
import { useLayerPictures } from './layers'
import { useUi } from './ui'

/**
 * The Draw tool: draw and write by hand on the picture in any colour. Strokes stay editable (undo, redo,
 * clear) until they are added as a layer; the layer then goes through the Security Gate like any picture.
 */
export type DrawBrush = 'pen' | 'marker' | 'highlighter' | 'eraser'

export interface DrawStroke {
  brush: DrawBrush
  color: string
  size: number // image pixels
  opacity: number // 0..1
  /** [x, y, pressure 0..1] in image pixels */
  points: [number, number, number][]
}

export const BRUSHES: Record<DrawBrush, { label: string; hint: string }> = {
  pen: { label: 'Pen', hint: 'Smooth ink. With a pen or stylus, pressing harder draws thicker.' },
  marker: { label: 'Marker', hint: 'An even, solid line; crossing your own stroke does not darken it.' },
  highlighter: { label: 'Highlighter', hint: 'A flat, see-through line, like a highlighter pen.' },
  eraser: { label: 'Eraser', hint: 'Rubs out what you drew (the picture underneath is not changed).' },
}

/** Largest side of the drawing canvas. Larger pictures get a drawing layer scaled up to fit them. */
export const MAX_DRAW_SIDE = 6144

interface DrawStore {
  brush: DrawBrush
  color: string
  size: number
  opacity: number
  smoothing: number // 0..1
  strokes: DrawStroke[]
  undone: DrawStroke[]
  busy: boolean
  set: (patch: Partial<Pick<DrawStore, 'brush' | 'color' | 'size' | 'opacity' | 'smoothing'>>) => void
  addStroke: (stroke: DrawStroke) => void
  undo: () => void
  redo: () => void
  clear: () => void
  apply: () => Promise<void>
}

export const useDraw = create<DrawStore>((set, get) => ({
  brush: 'pen',
  color: outputColors.white,
  size: 12,
  opacity: 1,
  smoothing: 0.5,
  strokes: [],
  undone: [],
  busy: false,
  set: (patch) => set(patch),
  addStroke: (stroke) => set((s) => ({ strokes: [...s.strokes, stroke], undone: [] })),
  undo: () =>
    set((s) => {
      const last = s.strokes[s.strokes.length - 1]
      return last ? { strokes: s.strokes.slice(0, -1), undone: [...s.undone, last] } : {}
    }),
  redo: () =>
    set((s) => {
      const last = s.undone[s.undone.length - 1]
      return last ? { strokes: [...s.strokes, last], undone: s.undone.slice(0, -1) } : {}
    }),
  clear: () => set({ strokes: [], undone: [] }),
  apply: async () => {
    const { strokes, busy } = get()
    const image = useImage.getState().current
    if (busy || !image || strokes.every((s) => s.brush === 'eraser')) return
    const box = strokeBounds(strokes, image.width, image.height)
    if (!box) return
    set({ busy: true })
    try {
      const ratio = Math.min(1, MAX_DRAW_SIDE / Math.max(box.w, box.h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(box.w * ratio))
      canvas.height = Math.max(1, Math.round(box.h * ratio))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('2D canvas is not available.')
      ctx.setTransform(ratio, 0, 0, ratio, -box.x * ratio, -box.y * ratio)
      for (const stroke of strokes) paintStroke(ctx, stroke)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('The drawing could not be saved.')
      await useLayerPictures
        .getState()
        .add(new File([blob], 'drawing.png', { type: 'image/png' }), { x: box.x, y: box.y, scale: 1 / ratio })
      set({ strokes: [], undone: [] })
    } finally {
      set({ busy: false })
    }
  },
}))

/** Leaving the Draw tool keeps the drawing: it is added as a layer, never lost. */
useUi.subscribe((state, previous) => {
  if (previous.tool === 'draw' && state.tool !== 'draw' && useDraw.getState().strokes.length > 0)
    void useDraw.getState().apply()
})

/** The area the strokes cover, in whole image pixels, clipped to the picture. Null when nothing is drawn. */
export function strokeBounds(
  strokes: DrawStroke[],
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of strokes) {
    if (s.brush === 'eraser') continue
    const r = s.size / 2 + 2
    for (const [x, y] of s.points) {
      x0 = Math.min(x0, x - r)
      y0 = Math.min(y0, y - r)
      x1 = Math.max(x1, x + r)
      y1 = Math.max(y1, y + r)
    }
  }
  x0 = Math.max(0, Math.floor(x0))
  y0 = Math.max(0, Math.floor(y0))
  x1 = Math.min(width, Math.ceil(x1))
  y1 = Math.min(height, Math.ceil(y1))
  if (!(x1 > x0 && y1 > y0)) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Points eased toward their neighbours: steadier lines from a shaky hand or a mouse. */
export function smoothPoints(points: [number, number, number][], amount: number): [number, number, number][] {
  if (amount <= 0 || points.length < 3) return points
  const out: [number, number, number][] = [points[0] as [number, number, number]]
  let [px, py] = points[0] as [number, number, number]
  const keep = 1 - Math.min(0.9, amount * 0.85)
  for (let i = 1; i < points.length; i++) {
    const [x, y, p] = points[i] as [number, number, number]
    px += (x - px) * keep
    py += (y - py) * keep
    out.push([px, py, p])
  }
  const last = points[points.length - 1] as [number, number, number]
  out.push(last)
  return out
}

let scratch: HTMLCanvasElement | null = null

/** Draws one stroke. Marker and highlighter strokes go through a scratch canvas so they do not darken where they cross. */
export function paintStroke(ctx: CanvasRenderingContext2D, stroke: DrawStroke): void {
  const pts = stroke.points
  if (pts.length === 0) return
  const flat = stroke.brush === 'highlighter'
  const alpha = stroke.brush === 'highlighter' ? Math.min(stroke.opacity, 0.45) : stroke.opacity
  const trace = (c: CanvasRenderingContext2D, width: (p: number) => number) => {
    c.lineCap = flat ? 'square' : 'round'
    c.lineJoin = 'round'
    if (pts.length === 1) {
      const [x, y, p] = pts[0] as [number, number, number]
      c.beginPath()
      if (flat) c.rect(x - width(p) / 2, y - width(p) / 2, width(p), width(p))
      else c.arc(x, y, width(p) / 2, 0, Math.PI * 2)
      c.fill()
      return
    }
    if (stroke.brush === 'pen') {
      // width follows the pressure: short quadratic segments through the midpoints
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1] as [number, number, number]
        const b = pts[i] as [number, number, number]
        const c0 = i > 1 ? pts[i - 2] : a
        c.lineWidth = width((a[2] + b[2]) / 2)
        c.beginPath()
        c.moveTo((c0![0] + a[0]) / 2, (c0![1] + a[1]) / 2)
        c.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        c.stroke()
      }
      const end = pts[pts.length - 1] as [number, number, number]
      const prev = pts[pts.length - 2] as [number, number, number]
      c.beginPath()
      c.moveTo((prev[0] + end[0]) / 2, (prev[1] + end[1]) / 2)
      c.lineTo(end[0], end[1])
      c.stroke()
      return
    }
    c.lineWidth = width(1)
    c.beginPath()
    c.moveTo((pts[0] as number[])[0] as number, (pts[0] as number[])[1] as number)
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i] as [number, number, number]
      const b = pts[i + 1] as [number, number, number]
      c.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    }
    const end = pts[pts.length - 1] as [number, number, number]
    c.lineTo(end[0], end[1])
    c.stroke()
  }
  const pressureWidth = (p: number) => stroke.size * (stroke.brush === 'pen' ? 0.35 + 0.65 * p : 1)

  if (stroke.brush === 'eraser') {
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.strokeStyle = 'black'
    ctx.fillStyle = 'black'
    trace(ctx, () => stroke.size)
    ctx.restore()
    return
  }
  if (stroke.brush === 'pen' && alpha >= 1) {
    ctx.save()
    ctx.strokeStyle = stroke.color
    ctx.fillStyle = stroke.color
    trace(ctx, pressureWidth)
    ctx.restore()
    return
  }
  // solid on a scratch canvas, then laid down once at the stroke's opacity
  const target = ctx.canvas
  scratch ??= document.createElement('canvas')
  if (scratch.width !== target.width || scratch.height !== target.height) {
    scratch.width = target.width
    scratch.height = target.height
  }
  const s = scratch.getContext('2d')
  if (!s) return
  s.setTransform(1, 0, 0, 1, 0, 0)
  s.clearRect(0, 0, scratch.width, scratch.height)
  s.setTransform(ctx.getTransform())
  s.strokeStyle = stroke.color
  s.fillStyle = stroke.color
  trace(s, pressureWidth)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = alpha
  ctx.drawImage(scratch, 0, 0)
  ctx.restore()
}
