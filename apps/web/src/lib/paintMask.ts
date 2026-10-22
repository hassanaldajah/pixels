import type { Paint } from '../engine/types'

/**
 * Rasterises brush strokes into an 8-bit mask at the preview scale. The same stamping as
 * server/pipeline/paint.py: soft round dabs (smoothstep falloff), built up with `flow`, rubbed out with `erase`.
 * Distances are measured in full-resolution canvas pixels so the preview and the export agree.
 */
export function rasterisePaint(paint: Paint, w: number, h: number, scale: number): Uint8Array {
  const m = new Float32Array(w * h)
  for (const stroke of paint.strokes) {
    const r = stroke.r
    const soft = Math.max(1 - stroke.hardness, 0.001)
    const reach = Math.ceil(r * scale) + 1
    for (const [x, y] of stroke.pts) {
      const cx = x * scale
      const cy = y * scale
      const x0 = Math.max(0, Math.floor(cx - reach))
      const x1 = Math.min(w, Math.ceil(cx + reach))
      const y0 = Math.max(0, Math.floor(cy - reach))
      const y1 = Math.min(h, Math.ceil(cy + reach))
      for (let j = y0; j < y1; j++) {
        const fy = (j + 0.5) / scale - y
        for (let i = x0; i < x1; i++) {
          const fx = (i + 0.5) / scale - x
          const d = Math.hypot(fx, fy) / r
          const a = Math.min(1, Math.max(0, (1 - d) / soft))
          const dab = stroke.flow * a * a * (3 - 2 * a)
          if (dab <= 0) continue
          const k = j * w + i
          const cur = m[k] as number
          m[k] = stroke.erase ? cur * (1 - dab) : cur + (1 - cur) * dab
        }
      }
    }
  }
  const out = new Uint8Array(w * h)
  for (let k = 0; k < out.length; k++) out[k] = Math.round((m[k] as number) * 255)
  return out
}

/** A cheap fingerprint of the strokes, to know when the cached mask is stale. */
export function paintKey(paint: Paint, w: number, h: number): string {
  let sum = 0
  let dabs = 0
  for (const s of paint.strokes) {
    sum = (sum * 31 + s.r * 7 + s.hardness * 13 + s.flow * 17 + (s.erase ? 5 : 0)) % 1e9
    for (const [x, y] of s.pts) {
      sum = (sum * 31 + x * 3 + y * 5) % 1e9
      dabs++
    }
  }
  return `${w}x${h}:${paint.strokes.length}:${dabs}:${sum.toFixed(3)}`
}
