/** Draws text and simple shapes into transparent PNG files, so they can be added as ordinary layers. */
export type FontKind = 'sans' | 'arabic' | 'display' | 'serif' | 'mono'

/** Every family ends with the Arabic font, so Arabic letters are always drawn with a real Arabic face. */
export const FAMILY: Record<FontKind, string> = {
  sans: '"Inter Variable", "IBM Plex Sans Arabic", "Segoe UI", Arial, sans-serif',
  arabic: '"IBM Plex Sans Arabic", "Inter Variable", "Segoe UI", sans-serif',
  display: '"Space Grotesk Variable", "IBM Plex Sans Arabic", sans-serif',
  serif: 'Georgia, "Times New Roman", "IBM Plex Sans Arabic", serif',
  mono: '"JetBrains Mono", Consolas, "IBM Plex Sans Arabic", monospace',
}

export type TextAlign = 'start' | 'center' | 'end'

export interface TextOptions {
  text: string
  font: FontKind
  size: number // px
  color: string // #rrggbb or #rrggbbaa
  bold: boolean
  italic: boolean
  align?: TextAlign
  /** A second colour: the fill fades from `color` to it at `gradientAngle` degrees. */
  gradient?: { color: string; angle: number } | null
  outline?: { width: number; color: string } | null
  shadow?: { blur: number; distance: number; color: string } | null
  background?: { color: string; padding: number; radius: number } | null
  letterSpacing?: number // px
  lineHeight?: number // multiple of the size
}

const MAX_SIDE = 8000
const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/

/** True when the first letter that has a direction is Arabic or Hebrew. */
export const isRtlText = (text: string): boolean => {
  const first = /[A-Za-z\u00c0-\u024f\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/.exec(text)
  return !!first && RTL.test(first[0])
}

/**
 * Text with its outline, shadow, gradient and background on a transparent canvas, sized to fit.
 * `scale` draws a smaller copy for the live preview.
 */
export async function renderText(o: TextOptions, scale = 1): Promise<HTMLCanvasElement> {
  const lines = o.text.split('\n').slice(0, 20)
  const size = Math.min(Math.max(o.size, 6), 600) * scale
  const font = `${o.italic ? 'italic ' : ''}${o.bold ? '700 ' : '400 '}${size}px ${FAMILY[o.font]}`
  try {
    await document.fonts.load(font, o.text)
  } catch {
    /* the fallback font is used */
  }
  const rtl = isRtlText(o.text)
  const spacing = (o.letterSpacing ?? 0) * scale
  const lineHeight = Math.ceil(size * (o.lineHeight ?? 1.25))
  const outline = o.outline && o.outline.width > 0 ? o.outline.width * scale : 0
  const shadow = o.shadow && (o.shadow.blur > 0 || o.shadow.distance !== 0) ? o.shadow : null
  const shadowBlur = (shadow?.blur ?? 0) * scale
  const shadowShift = (shadow?.distance ?? 0) * scale
  const box = o.background ? Math.max(0, o.background.padding) * scale : 0

  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) throw new Error('2D canvas is not available.')
  const setup = (ctx: CanvasRenderingContext2D) => {
    ctx.font = font
    ctx.direction = rtl ? 'rtl' : 'ltr'
    ctx.letterSpacing = `${spacing}px`
    ctx.textBaseline = 'middle'
  }
  setup(probe)
  const widths = lines.map((l) => probe.measureText(l).width)
  const textW = Math.ceil(Math.max(1, ...widths))
  const textH = lineHeight * lines.length
  const margin = Math.ceil(size * 0.15 + outline + shadowBlur * 2 + Math.abs(shadowShift))
  const width = Math.min(MAX_SIDE, textW + 2 * (box + margin))
  const height = Math.min(MAX_SIDE, textH + 2 * (box + margin))

  // the letters with their outline, on their own canvas so one shadow covers both
  const glyphs = document.createElement('canvas')
  glyphs.width = width
  glyphs.height = height
  const g = glyphs.getContext('2d')
  if (!g) throw new Error('2D canvas is not available.')
  setup(g)
  const left = margin + box
  const align = o.align ?? 'center'
  const xFor = (w: number) => {
    const physical = align === 'center' ? 'center' : (align === 'start') !== rtl ? 'left' : 'right'
    const offset = physical === 'center' ? (textW - w) / 2 : physical === 'left' ? 0 : textW - w
    return rtl ? left + offset + w : left + offset // in RTL the canvas draws leftward from x
  }
  g.textAlign = rtl ? 'right' : 'left'
  let fill: string | CanvasGradient = o.color
  if (o.gradient) {
    const angle = (o.gradient.angle * Math.PI) / 180
    const cx = width / 2
    const cy = height / 2
    const reach = (Math.abs(Math.cos(angle)) * textW + Math.abs(Math.sin(angle)) * textH) / 2
    const gradient = g.createLinearGradient(
      cx - Math.cos(angle) * reach,
      cy - Math.sin(angle) * reach,
      cx + Math.cos(angle) * reach,
      cy + Math.sin(angle) * reach,
    )
    gradient.addColorStop(0, o.color)
    gradient.addColorStop(1, o.gradient.color)
    fill = gradient
  }
  lines.forEach((line, i) => {
    const x = xFor(widths[i] ?? 0)
    const y = margin + box + i * lineHeight + lineHeight / 2
    if (outline > 0 && o.outline) {
      g.lineJoin = 'round'
      g.miterLimit = 2
      g.lineWidth = outline * 2 // half of it is under the fill
      g.strokeStyle = o.outline.color
      g.strokeText(line, x, y)
    }
    g.fillStyle = fill
    g.fillText(line, x, y)
  })

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is not available.')
  if (o.background) {
    ctx.fillStyle = o.background.color
    ctx.beginPath()
    ctx.roundRect(margin, margin, textW + 2 * box, textH + 2 * box, Math.max(0, o.background.radius) * scale)
    ctx.fill()
  }
  if (shadow) {
    ctx.shadowColor = shadow.color
    ctx.shadowBlur = shadowBlur
    ctx.shadowOffsetX = shadowShift * Math.SQRT1_2
    ctx.shadowOffsetY = shadowShift * Math.SQRT1_2
  }
  ctx.drawImage(glyphs, 0, 0)
  return canvas
}

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

/** Text on a transparent canvas, sized to fit, with a margin so outlines, shadows and soft edges are not cut. */
export async function makeTextFile(o: TextOptions): Promise<File> {
  const canvas = await renderText(o)
  // the file name is only a label: keep letters (Arabic too), digits and spaces
  const name =
    o.text
      .trim()
      .slice(0, 24)
      .replace(/[^\p{L}\p{N} ]+/gu, '')
      .trim() || 'Text'
  return toFile(canvas, name)
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
