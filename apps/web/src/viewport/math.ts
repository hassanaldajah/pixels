/**
 * Viewport maths. Coordinates:
 *  - image space: pixels, origin top-left of the image
 *  - screen space: CSS pixels inside the viewport element
 *  - `zoom` is device pixels per image pixel (100% = one image pixel per physical pixel), so the
 *    CSS-pixel scale is zoom / dpr.
 *  - `pan` is the image-space point shown at the centre of the viewport.
 */

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 10
export const ZOOM_STEPS = [0.1, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 6, 8, 10] as const

export interface View {
  zoom: number
  panX: number
  panY: number
}
export interface Size {
  w: number
  h: number
}
export interface Point {
  x: number
  y: number
}

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export const cssScale = (view: View, dpr: number): number => view.zoom / dpr

export function screenToImage(p: Point, view: View, viewport: Size, dpr: number): Point {
  const s = cssScale(view, dpr)
  return { x: (p.x - viewport.w / 2) / s + view.panX, y: (p.y - viewport.h / 2) / s + view.panY }
}

export function imageToScreen(p: Point, view: View, viewport: Size, dpr: number): Point {
  const s = cssScale(view, dpr)
  return { x: (p.x - view.panX) * s + viewport.w / 2, y: (p.y - view.panY) * s + viewport.h / 2 }
}

/** Change zoom while the image point under `anchor` (screen space) stays under the cursor. */
export function zoomAt(view: View, zoom: number, anchor: Point, viewport: Size, dpr: number): View {
  const z = clampZoom(zoom)
  const before = screenToImage(anchor, view, viewport, dpr)
  const s = z / dpr
  return {
    zoom: z,
    panX: before.x - (anchor.x - viewport.w / 2) / s,
    panY: before.y - (anchor.y - viewport.h / 2) / s,
  }
}

/** Zoom that fits the whole image with a margin. */
export function fitZoom(image: Size, viewport: Size, dpr: number, margin = 0.92): number {
  if (image.w <= 0 || image.h <= 0) return 1
  return clampZoom(Math.min((viewport.w * dpr) / image.w, (viewport.h * dpr) / image.h) * margin)
}

export function fitView(image: Size, viewport: Size, dpr: number): View {
  return { zoom: fitZoom(image, viewport, dpr), panX: image.w / 2, panY: image.h / 2 }
}

/** Keep the image from being dragged completely out of sight. */
export function constrainPan(view: View, image: Size, viewport: Size, dpr: number): View {
  const s = cssScale(view, dpr)
  const visibleW = viewport.w / s
  const visibleH = viewport.h / s
  const keep = 0.15 // at least 15% of the visible area must still show image
  const limit = (size: number, visible: number): [number, number] => [
    -visible * (0.5 - keep),
    size + visible * (0.5 - keep),
  ]
  const [minX, maxX] = limit(image.w, visibleW)
  const [minY, maxY] = limit(image.h, visibleH)
  return {
    ...view,
    panX: Math.min(maxX, Math.max(minX, view.panX)),
    panY: Math.min(maxY, Math.max(minY, view.panY)),
  }
}

/** Next preset zoom in the given direction (+1 in, -1 out). */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const eps = 1e-3
  if (direction > 0) return ZOOM_STEPS.find((z) => z > zoom + eps) ?? MAX_ZOOM
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - eps) ?? MIN_ZOOM
}

export const formatZoom = (zoom: number): string => {
  const pct = zoom * 100
  return `${pct >= 100 || Number.isInteger(pct) ? Math.round(pct) : pct.toFixed(1)}%`
}

/** Snap a guide position (image px) to useful targets when within `tolerance` image px. */
export function snapGuide(value: number, targets: number[], tolerance: number): number {
  let best = Math.round(value)
  let bestDist = Number.POSITIVE_INFINITY
  for (const t of targets) {
    const d = Math.abs(t - value)
    if (d <= tolerance && d < bestDist) {
      best = t
      bestDist = d
    }
  }
  return best
}

export const guideTargets = (size: number): number[] => [0, size / 3, size / 2, (size * 2) / 3, size]

/** Picks a ruler tick spacing (image px) that is a round number and at least ~60 CSS px apart. */
export function rulerStep(cssPerImagePx: number): number {
  const minimum = 60 / cssPerImagePx
  const magnitude = 10 ** Math.floor(Math.log10(minimum))
  for (const m of [1, 2, 5, 10]) if (m * magnitude >= minimum) return m * magnitude
  return 10 * magnitude
}
