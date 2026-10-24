import type { SmudgeStroke } from '../engine/types'

/**
 * Smudge, step for step the same as server/pipeline/smudge.py: square windows of whole pixels around
 * floor(point), the first dab picks colour up, later dabs lay it down with a soft round falloff and pick
 * some of the new surface up again. `rgba` is straight RGBA in 0..1 (changed in place); `scale` maps
 * full-resolution canvas pixels to this image (the preview may be smaller).
 */
export function smudge(rgba: Float32Array, w: number, h: number, strokes: SmudgeStroke[], scale = 1): void {
  for (const stroke of strokes) {
    const r = Math.max(stroke.r * scale, 0.5)
    const reach = Math.ceil(r)
    const side = 2 * reach + 1
    const soft = Math.max(1 - stroke.hardness, 0.001)
    let carried: Float32Array | null = null
    const surface = new Float32Array(side * side * 4)
    for (const [fx, fy] of stroke.pts) {
      const px = fx * scale
      const py = fy * scale
      const cx = Math.floor(px)
      const cy = Math.floor(py)
      for (let j = 0; j < side; j++) {
        const y = Math.min(h - 1, Math.max(0, cy - reach + j))
        for (let i = 0; i < side; i++) {
          const x = Math.min(w - 1, Math.max(0, cx - reach + i))
          surface.set(rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (j * side + i) * 4)
        }
      }
      if (!carried) {
        carried = surface.slice()
        continue
      }
      const keep = 1 - stroke.strength
      for (let j = 0; j < side; j++) {
        const y = cy - reach + j
        for (let i = 0; i < side; i++) {
          const x = cx - reach + i
          const inside = x >= 0 && x < w && y >= 0 && y < h
          const d = Math.hypot(x + 0.5 - px, y + 0.5 - py) / r
          const a = Math.min(1, Math.max(0, (1 - d) / soft))
          const weight = inside ? stroke.strength * a * a * (3 - 2 * a) : 0
          const k = (j * side + i) * 4
          for (let c = 0; c < 4; c++) {
            const s =
              (surface[k + c] as number) + ((carried[k + c] as number) - (surface[k + c] as number)) * weight
            surface[k + c] = s
            carried[k + c] = (carried[k + c] as number) + (s - (carried[k + c] as number)) * keep
            if (inside) rgba[(y * w + x) * 4 + c] = s
          }
        }
      }
    }
  }
}
