/** Draws text and simple shapes into transparent PNG files, so they can be added as ordinary layers. */
export type FontKind = 'sans' | 'serif' | 'mono'

const FAMILY: Record<FontKind, string> = {
  sans: 'Inter, "Segoe UI", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"JetBrains Mono", Consolas, monospace',
}

export interface TextOptions {
  text: string
  font: FontKind
  size: number // px
  color: string // #rrggbb
  bold: boolean
  italic: boolean
}

const MAX_SIDE = 8000

function toFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(new File([blob], `${name}.png`, { type: 'image/png' }))
          : reject(new Error('Could not draw it.')),
      'image/png',
    ),
  )
}

/** Text on a transparent canvas, sized to fit, with a small margin so soft edges are not cut. */
export async function makeTextFile(o: TextOptions): Promise<File> {
  const lines = o.text.split('\n').slice(0, 20)
  const size = Math.min(Math.max(o.size, 6), 600)
  const font = `${o.italic ? 'italic ' : ''}${o.bold ? '700 ' : '400 '}${size}px ${FAMILY[o.font]}`
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) throw new Error('2D canvas is not available.')
  probe.font = font
  const pad = Math.ceil(size * 0.2)
  const lineHeight = Math.ceil(size * 1.25)
  const width = Math.min(
    MAX_SIDE,
    Math.ceil(Math.max(1, ...lines.map((l) => probe.measureText(l).width))) + pad * 2,
  )
  const height = Math.min(MAX_SIDE, lineHeight * lines.length + pad * 2)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is not available.')
  ctx.font = font
  ctx.fillStyle = o.color
  ctx.textBaseline = 'top'
  lines.forEach((line, i) => ctx.fillText(line, pad, pad + i * lineHeight + (lineHeight - size) / 2))
  return toFile(
    canvas,
    o.text
      .trim()
      .slice(0, 24)
      .replace(/[^\w ]+/g, '') || 'Text',
  )
}

export type ShapeKind = 'rectangle' | 'ellipse' | 'line'

export interface ShapeOptions {
  kind: ShapeKind
  width: number
  height: number
  color: string
  /** Rectangle corner radius, or the line's thickness. */
  detail: number
}

export async function makeShapeFile(o: ShapeOptions): Promise<File> {
  const w = Math.min(MAX_SIDE, Math.max(2, Math.round(o.width)))
  const h = Math.min(MAX_SIDE, Math.max(2, Math.round(o.height)))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is not available.')
  ctx.fillStyle = o.color
  ctx.strokeStyle = o.color
  if (o.kind === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
    ctx.fill()
  } else if (o.kind === 'line') {
    ctx.lineWidth = Math.max(1, o.detail)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(ctx.lineWidth / 2, h / 2)
    ctx.lineTo(w - ctx.lineWidth / 2, h / 2)
    ctx.stroke()
  } else {
    const r = Math.min(Math.max(0, o.detail), w / 2, h / 2)
    ctx.beginPath()
    ctx.roundRect(0, 0, w, h, r)
    ctx.fill()
  }
  return toFile(canvas, o.kind)
}
