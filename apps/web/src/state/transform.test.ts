import { describe, expect, it } from 'vitest'
import { fitRatio, fromUnit, resolveRatio, toUnit } from './transform'

describe('crop ratios', () => {
  it('resolves presets, original, custom and orientation', () => {
    expect(resolveRatio('free', [1, 1], true, 100, 50)).toBeNull()
    expect(resolveRatio('original', [1, 1], true, 300, 200)).toBeCloseTo(1.5)
    expect(resolveRatio('16:9', [1, 1], true, 1, 1)).toBeCloseTo(16 / 9)
    expect(resolveRatio('16:9', [1, 1], false, 1, 1)).toBeCloseTo(9 / 16)
    expect(resolveRatio('9:16', [1, 1], true, 1, 1)).toBeCloseTo(16 / 9)
    expect(resolveRatio('1:1', [1, 1], false, 1, 1)).toBe(1)
    expect(resolveRatio('custom', [5, 2], true, 1, 1)).toBeCloseTo(2.5)
    expect(resolveRatio('a4', [1, 1], false, 1, 1)).toBeCloseTo(210 / 297)
  })

  it('fits the largest centred rectangle', () => {
    expect(fitRatio(1, 200, 100)).toEqual({ x: 50, y: 0, w: 100, h: 100 })
    expect(fitRatio(2, 100, 100)).toEqual({ x: 0, y: 25, w: 100, h: 50 })
  })
})

describe('physical units', () => {
  it('converts pixels to centimetres and inches with the DPI', () => {
    expect(toUnit(300, 'in', 300)).toBeCloseTo(1)
    expect(toUnit(300, 'cm', 300)).toBeCloseTo(2.54)
    expect(fromUnit(2.54, 'cm', 300)).toBeCloseTo(300)
    expect(fromUnit(10, 'px', 72)).toBe(10)
  })
})
