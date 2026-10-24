import type { LiquifyStroke } from '../engine/types'

/**
 * The liquify displacement field, step for step like server/pipeline/liquify.py: (H, W, 2) in pixels,
 * x then y. `scale` maps full-resolution canvas pixels to this field (the preview may be smaller); the
 * displacements scale with it, so the preview moves pixels by the same fraction of the picture.
 */
export function liquifyField(strokes: LiquifyStroke[], w: number, h: number, scale = 1): Float32Array {
  const d = new Float32Array(w * h * 2)
  for (const stroke of strokes) {
    const r = Math.max(stroke.r * scale, 0.5)
    const reach = Math.ceil(r)
    let previous: [number, number] | null = null
    for (const [fx, fy] of stroke.pts) {
      const px = fx * scale
      const py = fy * scale
      const cx = Math.floor(px)
      const cy = Math.floor(py)
      for (let y = Math.max(0, cy - reach); y <= Math.min(h - 1, cy + reach); y++) {
        const gy = y + 0.5 - py
        for (let x = Math.max(0, cx - reach); x <= Math.min(w - 1, cx + reach); x++) {
          const gx = x + 0.5 - px
          const a = Math.min(1, Math.max(0, 1 - Math.hypot(gx, gy) / r))
          const weight = stroke.strength * a * a * (3 - 2 * a)
          if (weight === 0) continue
          const k = (y * w + x) * 2
          if (stroke.mode === 'push') {
            if (previous) {
              d[k] = (d[k] as number) + weight * (px - previous[0])
              d[k + 1] = (d[k + 1] as number) + weight * (py - previous[1])
            }
          } else if (stroke.mode === 'bloat' || stroke.mode === 'pinch') {
            const sign = stroke.mode === 'bloat' ? 0.5 : -0.5
            d[k] = (d[k] as number) + weight * sign * gx
            d[k + 1] = (d[k + 1] as number) + weight * sign * gy
          } else {
            d[k] = (d[k] as number) * (1 - weight)
            d[k + 1] = (d[k + 1] as number) * (1 - weight)
          }
        }
      }
      previous = [px, py]
    }
  }
  return d
}
