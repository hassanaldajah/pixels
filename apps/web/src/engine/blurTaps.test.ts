import { describe, expect, it } from 'vitest'
import { lensTaps, motionTaps } from './blurTaps'

describe('blur taps (must equal server/pipeline/blur.py)', () => {
  it('motion taps round half away like the server', () => {
    const taps = motionTaps(1, 45)
    expect(taps[0]).toEqual([-2, 2])
    expect(taps[taps.length - 1]).toEqual([2, -2])
    expect(taps.length).toBe(7)
  })
  it('half-pixel cases at 30 degrees are decided the same way every time', () => {
    // sin 30° is 0.5: i = 1 gives -0.5, which floor(x + 0.5) sends to 0
    expect(motionTaps(1, 30)[4]).toEqual([1, 0])
  })
  it('lens taps cover the disc', () => {
    const taps = lensTaps(9)
    expect(taps.length).toBe(64)
    expect(Math.max(...taps.map(([x, y]) => Math.hypot(x, y)))).toBeLessThanOrEqual(9.6)
  })
})
