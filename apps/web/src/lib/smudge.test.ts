import { describe, expect, it } from 'vitest'
import { smudge } from './smudge'

function halves(): Float32Array {
  const img = new Float32Array(40 * 20 * 4)
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 40; x++) {
      const k = (y * 40 + x) * 4
      img[k] = x < 20 ? 1 : 0
      img[k + 3] = 1
    }
  return img
}

const px = (img: Float32Array, x: number, y: number) => img[(y * 40 + x) * 4] as number

describe('smudge (mirrors server/pipeline/smudge.py)', () => {
  const pts = Array.from({ length: 16 }, (_, i) => [14 + i + 0.5, 10.5] as [number, number])

  it('drags red into the black half and leaves the rest alone', () => {
    const img = halves()
    smudge(img, 40, 20, [{ r: 4, hardness: 0.6, strength: 0.8, pts }])
    expect(px(img, 24, 10)).toBeGreaterThan(0.3)
    expect(px(img, 24, 0)).toBe(0)
    expect(px(img, 35, 19)).toBe(0)
  })

  it('the first dab only picks up colour', () => {
    const img = halves()
    smudge(img, 40, 20, [{ r: 4, hardness: 0.5, strength: 1, pts: [[22.5, 10.5]] }])
    expect(img).toEqual(halves())
  })

  it('matches the server value at a probe point', () => {
    // values printed by the numpy version (server/pipeline/smudge.py) for the same stroke
    const img = halves()
    smudge(img, 40, 20, [{ r: 4, hardness: 0.6, strength: 0.8, pts }])
    expect(px(img, 24, 10)).toBeCloseTo(0.9994953274726868, 5)
    expect(img[(12 * 40 + 27) * 4]).toBeCloseTo(0.9910038709640503, 5)
  })
})
