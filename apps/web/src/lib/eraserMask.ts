/**
 * The eraser's mask: a canvas the size of the shown picture (capped at MAX_EDGE on its longest side) that you
 * paint on. It is sent to the server as packed bits, never as an image file.
 */
const MAX_EDGE = 2048
const MAX_UNDO = 10

let canvas: HTMLCanvasElement | null = null
let imageWidth = 1
const undo: Uint8ClampedArray[] = []

export const getMaskCanvas = (): HTMLCanvasElement => (canvas ??= document.createElement('canvas'))

const context = (): CanvasRenderingContext2D => {
  const ctx = getMaskCanvas().getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas is not available.')
  return ctx
}

/** Start with an empty mask for a picture of this size. */
export function resetMask(width: number, height: number): void {
  const c = getMaskCanvas()
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height, 1))
  c.width = Math.max(1, Math.round(width * scale))
  c.height = Math.max(1, Math.round(height * scale))
  imageWidth = Math.max(1, width)
  undo.length = 0
}

/** Mask pixels per picture pixel. */
export const maskScale = (): number => getMaskCanvas().width / imageWidth

export const undoDepth = (): number => undo.length

/** Call before a stroke so it can be undone. */
export function beginStroke(): void {
  const c = getMaskCanvas()
  undo.push(context().getImageData(0, 0, c.width, c.height).data)
  if (undo.length > MAX_UNDO) undo.shift()
}

/** One segment of a stroke, in picture pixels. `paint` false removes paint instead. */
export function stroke(
  from: { x: number; y: number },
  to: { x: number; y: number },
  diameter: number,
  paint: boolean,
  color: string,
): void {
  const ctx = context()
  const s = maskScale()
  ctx.save()
  ctx.globalCompositeOperation = paint ? 'source-over' : 'destination-out'
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = Math.max(1, diameter * s)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(from.x * s, from.y * s)
  ctx.lineTo(to.x * s + 0.01, to.y * s)
  ctx.stroke()
  ctx.restore()
}

export function undoStroke(): void {
  const previous = undo.pop()
  if (!previous) return
  const c = getMaskCanvas()
  context().putImageData(new ImageData(new Uint8ClampedArray(previous), c.width, c.height), 0, 0)
}

export function clearMask(): void {
  const c = getMaskCanvas()
  beginStroke()
  context().clearRect(0, 0, c.width, c.height)
}

export function maskIsEmpty(): boolean {
  const c = getMaskCanvas()
  const data = context().getImageData(0, 0, c.width, c.height).data
  for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 127) return false
  return true
}

/** The mask as base64 of packed bits (row-major, most significant bit first, 1 = erase). */
export function packedMask(): { width: number; height: number; bits: string } {
  const c = getMaskCanvas()
  const data = context().getImageData(0, 0, c.width, c.height).data
  const count = c.width * c.height
  const packed = new Uint8Array(Math.ceil(count / 8))
  for (let i = 0; i < count; i++) {
    if ((data[i * 4 + 3] ?? 0) > 127) packed[i >> 3] = (packed[i >> 3] ?? 0) | (0x80 >> (i & 7))
  }
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < packed.length; i += chunk) {
    binary += String.fromCharCode(...packed.subarray(i, i + chunk))
  }
  return { width: c.width, height: c.height, bits: btoa(binary) }
}
