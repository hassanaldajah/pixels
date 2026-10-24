import { describe, expect, it } from 'vitest'
import {
  hslToRgb,
  hsvToRgb,
  NAMED_COLOURS,
  opaqueHex,
  paletteGrid,
  parseColor,
  rgbToHsv,
  searchNamed,
  toHex,
} from './colorMath'

describe('colour maths', () => {
  it('parses every hex and rgb form', () => {
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor('00ff0080')).toEqual({ r: 0, g: 255, b: 0, a: 128 / 255 })
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 })
    expect(parseColor('rgba(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 })
    expect(parseColor('nonsense')).toBeNull()
  })

  it('writes alpha only when the colour is not opaque', () => {
    expect(toHex({ r: 255, g: 128, b: 0, a: 1 })).toBe('#ff8000')
    expect(toHex({ r: 255, g: 128, b: 0, a: 0.5 })).toBe('#ff800080')
    expect(opaqueHex('#ff800080')).toBe('#ff8000')
  })

  it('round-trips through HSV', () => {
    for (const hex of ['#123456', '#ff0000', '#00ff00', '#0000ff', '#808080', '#fedcba']) {
      const rgb = parseColor(hex)!
      expect(toHex(hsvToRgb(rgbToHsv(rgb)))).toBe(hex)
    }
  })

  it('converts HSL', () => {
    expect(toHex(hslToRgb(0, 1, 0.5))).toBe('#ff0000')
    expect(toHex(hslToRgb(120, 1, 0.25))).toBe('#008000')
  })

  it('offers a full palette and many named colours in both languages', () => {
    const grid = paletteGrid()
    expect(grid.length).toBe(9)
    expect(new Set(grid.flat()).size).toBeGreaterThan(130)
    expect(NAMED_COLOURS.length).toBeGreaterThan(150)
    for (const c of NAMED_COLOURS) expect(c.ar.trim() && c.en.trim()).toBeTruthy()
    expect(new Set(NAMED_COLOURS.map((c) => c.en)).size).toBe(NAMED_COLOURS.length)
  })

  it('finds colours by Arabic or English name', () => {
    expect(searchNamed('خمري').map((c) => c.en)).toEqual(['Wine'])
    expect(searchNamed('ازرق').length).toBeGreaterThan(10) // matches أزرق without the hamza
    expect(searchNamed('navy')[0]?.ar).toBe('كحلي')
  })
})
