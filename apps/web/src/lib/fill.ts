/**
 * Fill layers: a solid colour, a two-colour gradient, or a paint bucket that fills the area around a point
 * whose colour is close to the colour clicked. Each becomes an ordinary layer (and goes through the gate).
 */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Which pixels the bucket fills: 255 inside, 0 outside. `tolerance` is 0..100 (the largest colour
 * difference accepted, as a percentage of the full range). `contiguous` fills only the connected area.
 */
export function floodMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  tolerance: number,
  contiguous: boolean,
): { mask: Uint8Array; box: Box | null } {
  const mask = new Uint8Array(width * height)
  const x0 = Math.floor(sx)
  const y0 = Math.floor(sy)
  if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) return { mask, box: null }
  const seed = (y0 * width + x0) * 4
  const [r, g, b, a] = [rgba[seed]!, rgba[seed + 1]!, rgba[seed + 2]!, rgba[seed + 3]!]
  // squared distance in RGBA; 100% tolerance accepts everything
  const limit = ((tolerance / 100) * 255) ** 2 * 4
  const close = (i: number): boolean => {
    const p = i * 4
    const dr = rgba[p]! - r
    const dg = rgba[p + 1]! - g
    const db = rgba[p + 2]! - b
    const da = rgba[p + 3]! - a
    return dr * dr + dg * dg + db * db + da * da <= limit
  }
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  const mark = (i: number) => {
    mask[i] = 255
    const x = i % width
    const y = (i - x) / width
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (!contiguous) {
    for (let i = 0; i < width * height; i++) if (close(i)) mark(i)
  } else {
    // scanline fill: an explicit stack, so a huge area cannot overflow the call stack
    const stack: number[] = [x0, y0]
    while (stack.length) {
      const y = stack.pop()!
      let x = stack.pop()!
      let i = y * width + x
      while (x > 0 && !mask[i - 1] && close(i - 1)) {
        x--
        i--
      }
      let up = false
      let down = false
      for (; x < width && !mask[i] && close(i); x++, i++) {
        mark(i)
        if (y > 0) {
          const above = i - width
          if (!mask[above] && close(above)) {
            if (!up) {
              stack.push(x, y - 1)
              up = true
            }
          } else up = false
        }
        if (y < height - 1) {
          const below = i + width
          if (!mask[below] && close(below)) {
            if (!down) {
              stack.push(x, y + 1)
              down = true
            }
          } else down = false
        }
      }
    }
  }
  const box = maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
  return { mask, box }
}

export interface GradientSpec {
  kind: 'linear' | 'radial'
  from: string
  to: string
  angle: number // degrees, linear only
}

/** Paints a gradient over the whole canvas: linear at `angle`, or radial from the centre to the corners. */
export function paintGradient(ctx: CanvasRenderingContext2D, w: number, h: number, g: GradientSpec): void {
  let gradient: CanvasGradient
  if (g.kind === 'radial') {
    gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2)
  } else {
    const a = (g.angle * Math.PI) / 180
    const reach = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2
    gradient = ctx.createLinearGradient(
      w / 2 - Math.cos(a) * reach,
      h / 2 - Math.sin(a) * reach,
      w / 2 + Math.cos(a) * reach,
      h / 2 + Math.sin(a) * reach,
    )
  }
  gradient.addColorStop(0, g.from)
  gradient.addColorStop(1, g.to)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)
}
