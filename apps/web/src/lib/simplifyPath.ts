export type XY = [number, number]

function distanceToSegment(p: XY, a: XY, b: XY): number {
  const ex = b[0] - a[0]
  const ey = b[1] - a[1]
  const l2 = ex * ex + ey * ey
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2))
  return Math.hypot(p[0] - (a[0] + t * ex), p[1] - (a[1] + t * ey))
}

function douglasPeucker(pts: XY[], tolerance: number): XY[] {
  if (pts.length < 3) return pts
  const first = pts[0] as XY
  const last = pts[pts.length - 1] as XY
  let index = 0
  let farthest = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distanceToSegment(pts[i] as XY, first, last)
    if (d > farthest) {
      farthest = d
      index = i
    }
  }
  if (farthest <= tolerance) return [first, last]
  const left = douglasPeucker(pts.slice(0, index + 1), tolerance)
  const right = douglasPeucker(pts.slice(index), tolerance)
  return [...left.slice(0, -1), ...right]
}

/** Reduce a hand-drawn outline to at most `maxPoints` points (Douglas-Peucker, tolerance grown until it fits). */
export function simplifyPath(points: XY[], maxPoints: number): XY[] {
  let tolerance = 0.5
  let out = douglasPeucker(points, tolerance)
  while (out.length > maxPoints && tolerance < 1e5) {
    tolerance *= 1.4
    out = douglasPeucker(points, tolerance)
  }
  // a closed shape does not repeat its first point
  const a = out[0]
  const b = out[out.length - 1]
  if (out.length > 3 && a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) out = out.slice(0, -1)
  return out
}
