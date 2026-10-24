import { describe, expect, it } from 'vitest'
import { floodMask } from './fill'

/** A w x h picture: left half red, right half blue, with a red square inside the blue half. */
function picture(w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const red = x < w / 2 || (x >= 14 && x < 17 && y >= 2 && y < 5)
      px.set(red ? [250, 10, 10, 255] : [10, 10, 250, 255], i)
    }
  return px
}

const count = (m: Uint8Array) => m.reduce((n, v) => n + (v ? 1 : 0), 0)

describe('paint bucket', () => {
  it('fills the connected area of the clicked colour only', () => {
    const { mask, box } = floodMask(picture(20, 10), 20, 10, 2, 2, 10, true)
    expect(count(mask)).toBe(100)
    expect(box).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })

  it('fills every pixel of that colour when not contiguous', () => {
    const { mask, box } = floodMask(picture(20, 10), 20, 10, 2, 2, 10, false)
    expect(count(mask)).toBe(109)
    expect(box).toEqual({ x: 0, y: 0, w: 17, h: 10 })
  })

  it('tolerance decides how far the colour may drift', () => {
    const px = new Uint8ClampedArray(4 * 4 * 4)
    for (let i = 0; i < 16; i++) px.set([100 + i * 4, 100, 100, 255], i * 4)
    expect(count(floodMask(px, 4, 4, 0, 0, 0, true).mask)).toBe(1)
    expect(count(floodMask(px, 4, 4, 0, 0, 100, true).mask)).toBe(16)
  })

  it('handles a click outside the picture and a large area without overflowing', () => {
    expect(floodMask(picture(20, 10), 20, 10, -1, 3, 10, true).box).toBeNull()
    const big = new Uint8ClampedArray(1500 * 1500 * 4).fill(200)
    expect(count(floodMask(big, 1500, 1500, 700, 700, 5, true).mask)).toBe(1500 * 1500)
  })
})
