import { describe, expect, it } from 'vitest'
import { curveLut, sampleCurve } from './curves'
import { GeometryError, homography, invert, multiply, outputSize, plan, scaleOp, type Mat3 } from './geometry'
import {
  defaultAdjust,
  hasPointAdjustments,
  isEmptyState,
  isIdentityAdjust,
  emptyState,
  withDefaults,
  type EditState,
  type GeoOp,
} from './types'

const last = (ops: GeoOp[], w: number, h: number) => plan(ops, w, h).at(-1) as ReturnType<typeof plan>[number]
const close = (a: readonly number[], b: readonly number[], eps = 1e-5) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i] as number, -Math.log10(eps)))

// Golden values come from the Python implementation (server/pipeline/geometry.py).
describe('geometry planning matches the server', () => {
  const cases: [string, GeoOp[], number, number, [number, number], number[]][] = [
    [
      'rotate 30 expand',
      [{ type: 'rotate', angle: 30, expand: true }],
      40,
      20,
      [45, 38],
      [0.866025, -0.5, 10.179492, 0.5, 0.866025, 0.339746, 0, 0, 1],
    ],
    [
      'straighten 8',
      [{ type: 'straighten', angle: 8 }],
      60,
      40,
      [50, 33],
      [0.990268, -0.139173, -1.92458, 0.139173, 0.990268, -7.480554, 0, 0, 1],
    ],
    [
      'straighten -12',
      [{ type: 'straighten', angle: -12 }],
      200,
      100,
      [143, 71],
      [0.978148, 0.207912, -36.710345, -0.207912, 0.978148, 7.383789, 0, 0, 1],
    ],
    ['rotate90', [{ type: 'rotate90', turns: 1 }], 30, 50, [50, 30], [0, -1, 50, 1, 0, 0, 0, 0, 1]],
    [
      'crop clipped',
      [{ type: 'crop', x: 10, y: 8, w: 50, h: 50 }],
      30,
      20,
      [20, 12],
      [1, 0, -10, 0, 1, -8, 0, 0, 1],
    ],
    [
      'canvas bottom-right',
      [{ type: 'canvas', w: 100, h: 80, anchor: 'br', fill: null }],
      40,
      20,
      [100, 80],
      [1, 0, 60, 0, 1, 60, 0, 0, 1],
    ],
    [
      'canvas smaller',
      [{ type: 'canvas', w: 10, h: 10, anchor: 'c', fill: null }],
      25,
      15,
      [10, 10],
      [1, 0, -8, 0, 1, -3, 0, 0, 1],
    ],
    [
      'chain',
      [
        { type: 'rotate90', turns: 1 },
        { type: 'straighten', angle: 5 },
        { type: 'canvas', w: 300, h: 300, anchor: 'tc', fill: '#112233' },
      ],
      120,
      80,
      [300, 300],
      [1, 0, 115, 0, 1, 0, 0, 0, 1],
    ],
  ]
  it.each(cases)('%s', (_name, ops, w, h, size, matrix) => {
    const step = last(ops, w, h)
    expect([step.outW, step.outH]).toEqual(size)
    close(step.matrix, matrix)
  })

  it('computes the perspective homography like the server', () => {
    const h = homography([[0, 0], [30, 0], [30, 20], [0, 20]], [[5, 2], [28, 0], [30, 22], [0, 18]]) // prettier-ignore
    close(h, [0.54908, -0.25, 5, -0.066667, 0.603988, 2, -0.007771, -0.01089, 1], 1e-4)
  })
})

describe('matrix helpers', () => {
  it('inverts and multiplies', () => {
    const m: Mat3 = [2, 0, 5, 0, 3, -1, 0, 0, 1]
    close(multiply(m, invert(m)), [1, 0, 0, 0, 1, 0, 0, 0, 1])
  })

  it('refuses singular matrices and degenerate quads', () => {
    expect(() => invert([1, 0, 0, 0, 0, 0, 0, 0, 1])).toThrow(GeometryError)
    expect(() => homography([[0, 0], [5, 5], [10, 10], [3, 3]], [[0, 0], [1, 0], [1, 1], [0, 1]])).toThrow(GeometryError) // prettier-ignore
  })

  it('enforces the pixel limit', () => {
    expect(() => plan([{ type: 'canvas', w: 5000, h: 5000, anchor: 'c', fill: null }], 10, 10, 1e6)).toThrow(
      /limit/,
    )
  })

  it('reports output size through a chain', () => {
    expect(
      outputSize(
        [
          { type: 'rotate90', turns: 1 },
          { type: 'crop', x: 0, y: 0, w: 3, h: 4 },
        ],
        10,
        20,
      ),
    ).toEqual({ w: 3, h: 4 })
  })

  it('scales preview ops but leaves angles alone', () => {
    expect(scaleOp({ type: 'crop', x: 100, y: 50, w: 400, h: 200 }, 0.5)).toEqual({
      type: 'crop',
      x: 50,
      y: 25,
      w: 200,
      h: 100,
    })
    expect(scaleOp({ type: 'straighten', angle: 4 }, 0.5)).toEqual({ type: 'straighten', angle: 4 })
    expect(scaleOp({ type: 'canvas', w: 10, h: 10, anchor: 'c', fill: null }, 0.25)).toMatchObject({
      w: 3,
      h: 3,
    })
  })
})

// Golden values from server/pipeline/curves.py
describe('curves match the server', () => {
  it('reproduces the golden LUT values', () => {
    const lut = curveLut([[0, 0], [0.25, 0.15], [0.75, 0.9], [1, 1]]) // prettier-ignore
    const golden: Record<number, number> = {
      0: 0,
      32: 0.0591,
      64: 0.1508,
      96: 0.3132,
      128: 0.5428,
      160: 0.764,
      192: 0.9017,
      224: 0.969,
      255: 1,
    }
    for (const [i, v] of Object.entries(golden)) expect(lut[Number(i)]).toBeCloseTo(v, 3)
    const other = curveLut([[0, 0.1], [0.5, 0.6], [0.8, 0.7], [1, 1]]) // prettier-ignore
    const golden2: Record<number, number> = { 0: 0.1, 64: 0.4095, 128: 0.6009, 170: 0.6507, 204: 0.7, 255: 1 }
    for (const [i, v] of Object.entries(golden2)) expect(other[Number(i)]).toBeCloseTo(v, 3)
  })

  it('is the identity for a straight line and monotone for an S curve', () => {
    const id = curveLut([[0, 0], [1, 1]]) // prettier-ignore
    for (let i = 0; i < 256; i++) expect(id[i]).toBeCloseTo(i / 255, 5)
    const s = curveLut([[0, 0], [0.25, 0.15], [0.75, 0.85], [1, 1]]) // prettier-ignore
    for (let i = 1; i < 256; i++) expect(s[i] as number).toBeGreaterThanOrEqual((s[i - 1] as number) - 1e-7)
  })

  it('samples between entries', () => {
    const lut = curveLut([[0, 0], [1, 1]]) // prettier-ignore
    expect(sampleCurve(lut, 0.5)).toBeCloseTo(0.5, 4)
  })
})

describe('edit state helpers', () => {
  it('knows when nothing has been edited', () => {
    expect(isEmptyState(emptyState())).toBe(true)
    const a = defaultAdjust()
    a.exposure = 0.5
    expect(isIdentityAdjust(a)).toBe(false)
    expect(isEmptyState({ geometry: [{ type: 'flip', axis: 'h' }], adjust: defaultAdjust() })).toBe(false)
  })

  it('separates point adjustments from spatial ones', () => {
    const a = defaultAdjust()
    a.sharpen.amount = 80
    a.vignette.amount = -20
    expect(hasPointAdjustments(a)).toBe(false)
    a.contrast = 10
    expect(hasPointAdjustments(a)).toBe(true)
  })
})

describe('states from older versions', () => {
  it('get the fields added later (blur, ...) filled with their defaults', () => {
    const old = { geometry: [], adjust: { exposure: 0.5 } } as unknown as EditState
    const fixed = withDefaults(old)
    expect(fixed.adjust.exposure).toBe(0.5)
    expect(fixed.adjust.blur).toBe(0)
    expect(fixed.adjust.sharpen).toEqual(defaultAdjust().sharpen)
  })

  it('keep an untouched state recognisable as empty', () => {
    const old = { geometry: [], adjust: defaultAdjust() } as unknown as EditState
    delete (old.adjust as unknown as Record<string, unknown>).blur
    expect(isEmptyState(withDefaults(old))).toBe(true)
  })
})
