import { describe, expect, it } from 'vitest'
import { simplifyPath, type XY } from './simplifyPath'

describe('simplifyPath', () => {
  it('keeps the corners of a drawn square and drops the points on its sides', () => {
    const square: XY[] = []
    for (let i = 0; i <= 20; i++) square.push([i * 5, 0])
    for (let i = 1; i <= 20; i++) square.push([100, i * 5])
    for (let i = 1; i <= 20; i++) square.push([100 - i * 5, 100])
    for (let i = 1; i <= 20; i++) square.push([0, 100 - i * 5])
    const out = simplifyPath(square, 128)
    expect(out.length).toBeLessThanOrEqual(6)
    for (const corner of [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ] as XY[])
      expect(out.some((p) => p[0] === corner[0] && p[1] === corner[1])).toBe(true)
  })

  it('never returns more than the allowed number of points', () => {
    const circle: XY[] = Array.from({ length: 2000 }, (_, i) => [
      200 + 150 * Math.cos((i / 2000) * Math.PI * 2),
      200 + 150 * Math.sin((i / 2000) * Math.PI * 2),
    ])
    expect(simplifyPath(circle, 40).length).toBeLessThanOrEqual(40)
    expect(simplifyPath(circle, 40).length).toBeGreaterThan(8)
  })

  it('does not repeat the first point at the end of a closed shape', () => {
    const closed: XY[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ]
    const out = simplifyPath(closed, 128)
    expect(out.length).toBe(4)
  })
})
