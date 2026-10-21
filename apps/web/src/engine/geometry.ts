/**
 * Geometry planning. A port of server/pipeline/geometry.py: each op is a 3x3 forward matrix from
 * the current image to the new one, plus the new size. Coordinates are continuous (pixel centres at
 * +0.5, y down). Matrices are row-major arrays of 9 numbers.
 */
import type { Anchor, GeoOp } from './types'

export type Mat3 = [number, number, number, number, number, number, number, number, number]
export type Fill = [number, number, number, number]

export interface Step {
  op: GeoOp
  matrix: Mat3
  outW: number
  outH: number
  fill: Fill
}

export class GeometryError extends Error {}

const TRANSPARENT: Fill = [0, 0, 0, 0]

export const identity = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0)
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++)
        out[r * 3 + c] = (out[r * 3 + c] as number) + (a[r * 3 + k] as number) * (b[k * 3 + c] as number)
  return out as Mat3
}

const translate = (tx: number, ty: number): Mat3 => [1, 0, tx, 0, 1, ty, 0, 0, 1]
const rotation = (radians: number): Mat3 => {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}

export function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12)
    throw new GeometryError('That transform flattens the image and cannot be undone.')
  const inv = 1 / det
  return [
    A * inv, -(b * i - c * h) * inv, (b * f - c * e) * inv,
    B * inv, (a * i - c * g) * inv, -(a * f - c * d) * inv,
    C * inv, -(a * h - b * g) * inv, (a * e - b * d) * inv,
  ] // prettier-ignore
}

const ceil = (v: number): number => Math.max(1, Math.ceil(Number(v.toFixed(6))))
const floorPositive = (v: number): number => Math.max(1, Math.floor(Number(v.toFixed(6))))

/** The 3x3 matrix taking four source points to four destination points (Gaussian elimination). */
export function homography(src: [number, number][], dst: [number, number][]): Mat3 {
  const rows: number[][] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i] as [number, number]
    const [u, v] = dst[i] as [number, number]
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col
    for (let r = col + 1; r < 8; r++)
      if (Math.abs((rows[r] as number[])[col] as number) > Math.abs((rows[pivot] as number[])[col] as number))
        pivot = r
    const pivotRow = rows[pivot] as number[]
    if (Math.abs(pivotRow[col] as number) < 1e-10)
      throw new GeometryError('The perspective corners are degenerate.')
    ;[rows[col], rows[pivot]] = [rows[pivot] as number[], rows[col] as number[]]
    const current = rows[col] as number[]
    for (let r = 0; r < 8; r++) {
      if (r === col) continue
      const row = rows[r] as number[]
      const factor = (row[col] as number) / (current[col] as number)
      for (let c = col; c < 9; c++) row[c] = (row[c] as number) - factor * (current[c] as number)
    }
  }
  const h = rows.map((row, i) => (row[8] as number) / (row[i] as number))
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] as Mat3
}

export function inscribedScale(w: number, h: number, radians: number): number {
  const c = Math.abs(Math.cos(radians))
  const s = Math.abs(Math.sin(radians))
  return Math.min(w / (w * c + h * s), h / (w * s + h * c))
}

const COLUMN: Record<Anchor, 0 | 0.5 | 1> = {
  tl: 0,
  ml: 0,
  bl: 0,
  tc: 0.5,
  c: 0.5,
  bc: 0.5,
  tr: 1,
  mr: 1,
  br: 1,
}
const ROW: Record<Anchor, 0 | 0.5 | 1> = {
  tl: 0,
  tc: 0,
  tr: 0,
  ml: 0.5,
  c: 0.5,
  mr: 0.5,
  bl: 1,
  bc: 1,
  br: 1,
}

export function hexToFill(hex: string | null): Fill {
  if (!hex) return TRANSPARENT
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
    1,
  ]
}

export function planStep(op: GeoOp, w: number, h: number): Step {
  switch (op.type) {
    case 'rotate90': {
      const mats: Record<number, Mat3> = {
        1: [0, -1, h, 1, 0, 0, 0, 0, 1],
        2: [-1, 0, w, 0, -1, h, 0, 0, 1],
        3: [0, 1, 0, -1, 0, w, 0, 0, 1],
      }
      const odd = op.turns % 2 === 1
      return { op, matrix: mats[op.turns] as Mat3, outW: odd ? h : w, outH: odd ? w : h, fill: TRANSPARENT }
    }
    case 'flip':
      return {
        op,
        matrix: op.axis === 'h' ? [-1, 0, w, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, -1, h, 0, 0, 1],
        outW: w,
        outH: h,
        fill: TRANSPARENT,
      }
    case 'rotate': {
      const a = (op.angle * Math.PI) / 180
      const ow = op.expand ? ceil(Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) : w
      const oh = op.expand ? ceil(Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))) : h
      const m = multiply(multiply(translate(ow / 2, oh / 2), rotation(a)), translate(-w / 2, -h / 2))
      return { op, matrix: m, outW: ow, outH: oh, fill: TRANSPARENT }
    }
    case 'straighten': {
      const a = (op.angle * Math.PI) / 180
      const s = inscribedScale(w, h, a)
      const ow = floorPositive(w * s)
      const oh = floorPositive(h * s)
      const m = multiply(multiply(translate(ow / 2, oh / 2), rotation(a)), translate(-w / 2, -h / 2))
      return { op, matrix: m, outW: ow, outH: oh, fill: TRANSPARENT }
    }
    case 'crop': {
      const x0 = Math.min(op.x, w - 1)
      const y0 = Math.min(op.y, h - 1)
      const cw = Math.min(op.w, w - x0)
      const ch = Math.min(op.h, h - y0)
      return {
        op: { type: 'crop', x: x0, y: y0, w: cw, h: ch },
        matrix: translate(-x0, -y0),
        outW: cw,
        outH: ch,
        fill: TRANSPARENT,
      }
    }
    case 'skew': {
      const sx: Mat3 = [1, Math.tan((op.x * Math.PI) / 180), 0, 0, 1, 0, 0, 0, 1]
      const sy: Mat3 = [1, 0, 0, Math.tan((op.y * Math.PI) / 180), 1, 0, 0, 0, 1]
      const m = multiply(multiply(multiply(translate(w / 2, h / 2), sy), sx), translate(-w / 2, -h / 2))
      return { op, matrix: m, outW: w, outH: h, fill: TRANSPARENT }
    }
    case 'perspective': {
      const src: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]] // prettier-ignore
      return { op, matrix: homography(src, op.quad), outW: w, outH: h, fill: TRANSPARENT }
    }
    case 'resize':
      return {
        op,
        matrix: [op.w / w, 0, 0, 0, op.h / h, 0, 0, 0, 1],
        outW: op.w,
        outH: op.h,
        fill: TRANSPARENT,
      }
    case 'canvas': {
      const dx = Math.floor((op.w - w) * COLUMN[op.anchor])
      const dy = Math.floor((op.h - h) * ROW[op.anchor])
      return { op, matrix: translate(dx, dy), outW: op.w, outH: op.h, fill: hexToFill(op.fill) }
    }
  }
}

export function plan(ops: GeoOp[], w: number, h: number, maxPixels = Number.POSITIVE_INFINITY): Step[] {
  const steps: Step[] = []
  for (const op of ops) {
    const step = planStep(op, w, h)
    if (step.outW * step.outH > maxPixels)
      throw new GeometryError(
        `The result would be ${step.outW.toLocaleString()} x ${step.outH.toLocaleString()} px, above the size limit.`,
      )
    steps.push(step)
    w = step.outW
    h = step.outH
  }
  return steps
}

export function outputSize(ops: GeoOp[], w: number, h: number): { w: number; h: number } {
  const steps = plan(ops, w, h)
  const last = steps[steps.length - 1]
  return last ? { w: last.outW, h: last.outH } : { w, h }
}

/** Is the op an exact pixel copy (no resampling)? Used to decide whether a preview scale matters. */
export const isExact = (op: GeoOp): boolean => ['rotate90', 'flip', 'crop', 'canvas'].includes(op.type)

/** Scale an op from full-resolution coordinates to a preview that is `f` times as large. */
export function scaleOp(op: GeoOp, f: number): GeoOp {
  if (f === 1) return op
  const r = (v: number): number => Math.max(1, Math.round(v * f))
  switch (op.type) {
    case 'crop':
      return { type: 'crop', x: Math.round(op.x * f), y: Math.round(op.y * f), w: r(op.w), h: r(op.h) }
    case 'canvas':
      return { ...op, w: r(op.w), h: r(op.h) }
    case 'resize':
      return { ...op, w: r(op.w), h: r(op.h) }
    case 'perspective':
      return { type: 'perspective', quad: op.quad.map(([x, y]) => [x * f, y * f] as [number, number]) }
    default:
      return op
  }
}
