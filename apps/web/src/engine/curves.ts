/**
 * Tone curves: monotone cubic (Fritsch-Carlson / PCHIP) as a 256-entry LUT.
 * Same algorithm as server/pipeline/curves.py; both are tested against the same golden values.
 */
import type { CurvePoints } from './types'

export const LUT_SIZE = 256

const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0)

function derivatives(xs: number[], ys: number[]): number[] {
  const n = xs.length
  const h: number[] = []
  const delta: number[] = []
  for (let i = 0; i < n - 1; i++) {
    h.push((xs[i + 1] as number) - (xs[i] as number))
    delta.push(((ys[i + 1] as number) - (ys[i] as number)) / (h[i] as number))
  }
  if (n === 2) return [delta[0] as number, delta[0] as number]
  const d = new Array<number>(n).fill(0)
  for (let k = 1; k < n - 1; k++) {
    const prev = delta[k - 1] as number
    const next = delta[k] as number
    if (prev * next <= 0) d[k] = 0
    else {
      const w1 = 2 * (h[k] as number) + (h[k - 1] as number)
      const w2 = (h[k] as number) + 2 * (h[k - 1] as number)
      d[k] = (w1 + w2) / (w1 / prev + w2 / next)
    }
  }
  const edge = (h0: number, h1: number, d0: number, d1: number): number => {
    const value = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1)
    if (sign(value) !== sign(d0)) return 0
    if (sign(d0) !== sign(d1) && Math.abs(value) > 3 * Math.abs(d0)) return 3 * d0
    return value
  }
  d[0] = edge(h[0] as number, h[1] as number, delta[0] as number, delta[1] as number)
  d[n - 1] = edge(h[n - 2] as number, h[n - 3] as number, delta[n - 2] as number, delta[n - 3] as number)
  return d
}

export function curveLut(points: CurvePoints): Float32Array {
  const pts = [...points].sort((a, b) => a[0] - b[0])
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const d = derivatives(xs, ys)
  const lut = new Float32Array(LUT_SIZE)
  for (let i = 0; i < LUT_SIZE; i++) {
    const x = i / (LUT_SIZE - 1)
    let y: number
    if (x <= (xs[0] as number)) y = ys[0] as number
    else if (x >= (xs[xs.length - 1] as number)) y = ys[ys.length - 1] as number
    else {
      let k = 0
      while (x > (xs[k + 1] as number)) k++
      const h = (xs[k + 1] as number) - (xs[k] as number)
      const t = (x - (xs[k] as number)) / h
      const t2 = t * t
      const t3 = t2 * t
      y =
        (2 * t3 - 3 * t2 + 1) * (ys[k] as number) +
        (t3 - 2 * t2 + t) * h * (d[k] as number) +
        (-2 * t3 + 3 * t2) * (ys[k + 1] as number) +
        (t3 - t2) * h * (d[k + 1] as number)
    }
    lut[i] = Math.min(1, Math.max(0, y))
  }
  return lut
}

/** Value of the curve at x in 0..1 (linear between LUT entries, like the shader). */
export function sampleCurve(lut: Float32Array, x: number): number {
  const v = Math.min(1, Math.max(0, x)) * (LUT_SIZE - 1)
  const i0 = Math.floor(v)
  const i1 = Math.min(LUT_SIZE - 1, i0 + 1)
  const t = v - i0
  return (lut[i0] as number) * (1 - t) + (lut[i1] as number) * t
}
