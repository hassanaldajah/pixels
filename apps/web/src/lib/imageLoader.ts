import { fetchImageBlob } from '../api/client'

export interface Histogram {
  r: Uint32Array
  g: Uint32Array
  b: Uint32Array
  luma: Uint32Array
  max: number
}

export interface LoadedPixels {
  blob: Blob
  bitmap: ImageBitmap
  thumbUrl: string
  histogram: Histogram
}

const PROBE_EDGE = 512
const THUMB_EDGE = 240

function draw(bitmap: ImageBitmap, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas is not available.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas
}

export function computeHistogram(data: Uint8ClampedArray): Histogram {
  const r = new Uint32Array(256)
  const g = new Uint32Array(256)
  const b = new Uint32Array(256)
  const luma = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < 8) continue // fully transparent pixels carry no colour
    const rr = data[i] ?? 0
    const gg = data[i + 1] ?? 0
    const bb = data[i + 2] ?? 0
    r[rr] = (r[rr] ?? 0) + 1
    g[gg] = (g[gg] ?? 0) + 1
    b[bb] = (b[bb] ?? 0) + 1
    const l = Math.round(0.2126 * rr + 0.7152 * gg + 0.0722 * bb)
    luma[l] = (luma[l] ?? 0) + 1
  }
  let max = 1
  for (const channel of [r, g, b]) for (const v of channel) if (v > max) max = v
  return { r, g, b, luma, max }
}

/** Fetch the sanitised PNG, decode it once, and derive the thumbnail and histogram. */
export async function loadPixels(url: string): Promise<LoadedPixels> {
  const blob = await fetchImageBlob(url)
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const probe = draw(bitmap, PROBE_EDGE)
  const data = probe.getContext('2d')?.getImageData(0, 0, probe.width, probe.height).data
  const histogram = computeHistogram(data ?? new Uint8ClampedArray(0))
  const thumbUrl = draw(bitmap, THUMB_EDGE).toDataURL('image/png')
  return { blob, bitmap, thumbUrl, histogram }
}
