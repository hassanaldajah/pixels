import { describe, expect, it } from 'vitest'
import { smoothPoints, strokeBounds, type DrawStroke } from './draw'

const stroke = (
  points: [number, number, number][],
  size = 10,
  brush: DrawStroke['brush'] = 'pen',
): DrawStroke => ({
  brush,
  color: '#ff0000',
  size,
  opacity: 1,
  points,
})

describe('draw tool maths', () => {
  it('bounds cover the strokes plus their width, clipped to the picture', () => {
    expect(
      strokeBounds(
        [
          stroke([
            [50, 60, 1],
            [80, 90, 1],
          ]),
        ],
        200,
        200,
      ),
    ).toEqual({ x: 43, y: 53, w: 44, h: 44 })
    expect(strokeBounds([stroke([[2, 2, 1]], 20)], 100, 100)).toEqual({ x: 0, y: 0, w: 14, h: 14 })
  })

  it('ignores eraser strokes and empty drawings', () => {
    expect(strokeBounds([stroke([[50, 50, 1]], 10, 'eraser')], 100, 100)).toBeNull()
    expect(strokeBounds([], 100, 100)).toBeNull()
    expect(strokeBounds([stroke([[500, 500, 1]])], 100, 100)).toBeNull()
  })

  it('smoothing keeps the ends and steadies the middle', () => {
    const shaky: [number, number, number][] = [
      [0, 0, 1],
      [10, 8, 1],
      [20, -8, 1],
      [30, 8, 1],
      [40, 0, 1],
    ]
    const smooth = smoothPoints(shaky, 0.8)
    expect(smooth[0]).toEqual(shaky[0])
    expect(smooth[smooth.length - 1]).toEqual(shaky[4])
    const swing = (pts: [number, number, number][]) => Math.max(...pts.map((p) => Math.abs(p[1])))
    expect(swing(smooth.slice(1, -1))).toBeLessThan(swing(shaky.slice(1, -1)))
    expect(smoothPoints(shaky, 0)).toBe(shaky)
  })
})
