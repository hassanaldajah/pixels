/**
 * Tap offsets for the motion and lens blurs, computed in double precision exactly like
 * server/pipeline/blur.py. The shader receives them ready-made: a float32 GPU would round taps that land
 * exactly on half a pixel (sin 30° = 0.5) differently from the server.
 */
export const MAX_RADIUS = 96
export const MAX_TAPS = 2 * MAX_RADIUS + 1
const LENS_TAPS = 64
const GOLDEN_ANGLE = 2.39996323

const round = (v: number): number => Math.floor(v + 0.5)

export function motionTaps(length: number, angleDeg: number): [number, number][] {
  const half = Math.min(MAX_RADIUS, Math.max(1, Math.ceil(3 * length)))
  const a = (angleDeg * Math.PI) / 180
  const taps: [number, number][] = []
  for (let i = -half; i <= half; i++) taps.push([round(i * Math.cos(a)), round(-i * Math.sin(a))])
  return taps
}

export function lensTaps(radius: number): [number, number][] {
  const rMax = Math.min(MAX_RADIUS, Math.max(1, radius))
  const taps: [number, number][] = []
  for (let k = 0; k < LENS_TAPS; k++) {
    const r = rMax * Math.sqrt((k + 0.5) / LENS_TAPS)
    const t = k * GOLDEN_ANGLE
    taps.push([round(r * Math.cos(t)), round(r * Math.sin(t))])
  }
  return taps
}
