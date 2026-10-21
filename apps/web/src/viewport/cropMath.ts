import type { Rect } from '../state/transform'

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const MIN = 4

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * Drag a crop rectangle. `dx`, `dy` are in image pixels since the drag began; `start` is the
 * rectangle at that moment. The result stays inside `bounds`, is at least MIN px on a side, and
 * keeps `ratio` (width / height) when given.
 */
export function dragRect(
  start: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  bounds: { w: number; h: number },
  ratio: number | null,
): Rect {
  if (handle === 'move') {
    return {
      ...start,
      x: Math.round(clamp(start.x + dx, 0, bounds.w - start.w)),
      y: Math.round(clamp(start.y + dy, 0, bounds.h - start.h)),
    }
  }
  let l = start.x
  let t = start.y
  let r = start.x + start.w
  let b = start.y + start.h
  if (handle.includes('w')) l = clamp(l + dx, 0, r - MIN)
  if (handle.includes('e')) r = clamp(r + dx, l + MIN, bounds.w)
  if (handle.includes('n')) t = clamp(t + dy, 0, b - MIN)
  if (handle.includes('s')) b = clamp(b + dy, t + MIN, bounds.h)

  if (ratio) {
    const corner = handle.length === 2
    const fromHorizontal = corner
      ? Math.abs(dx) * ratio >= Math.abs(dy) || !handle.match(/[ns]/)
      : handle === 'e' || handle === 'w'
    let w = r - l
    let h = b - t
    if (fromHorizontal) h = w / ratio
    else w = h * ratio
    // Keep the dragged corner/edge under the pointer and the opposite one fixed.
    const anchorX = handle.includes('w') ? r : handle.includes('e') ? l : (l + r) / 2
    const anchorY = handle.includes('n') ? b : handle.includes('s') ? t : (t + b) / 2
    const maxW = handle.includes('w')
      ? anchorX
      : handle.includes('e')
        ? bounds.w - anchorX
        : 2 * Math.min(anchorX, bounds.w - anchorX)
    const maxH = handle.includes('n')
      ? anchorY
      : handle.includes('s')
        ? bounds.h - anchorY
        : 2 * Math.min(anchorY, bounds.h - anchorY)
    const scale = Math.min(1, maxW / w, maxH / h)
    w *= scale
    h *= scale
    if (w < MIN) {
      w = MIN
      h = MIN / ratio
    }
    l = handle.includes('w') ? anchorX - w : handle.includes('e') ? anchorX : anchorX - w / 2
    t = handle.includes('n') ? anchorY - h : handle.includes('s') ? anchorY : anchorY - h / 2
    r = l + w
    b = t + h
  }
  return {
    x: Math.round(l),
    y: Math.round(t),
    w: Math.max(1, Math.round(r - l)),
    h: Math.max(1, Math.round(b - t)),
  }
}

export const handlePosition = (rect: Rect, handle: Handle): [number, number] => {
  const x = handle.includes('w') ? rect.x : handle.includes('e') ? rect.x + rect.w : rect.x + rect.w / 2
  const y = handle.includes('n') ? rect.y : handle.includes('s') ? rect.y + rect.h : rect.y + rect.h / 2
  return [x, y]
}

export const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  move: 'move',
}
