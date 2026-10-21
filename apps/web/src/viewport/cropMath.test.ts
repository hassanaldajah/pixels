import { describe, expect, it } from 'vitest'
import { dragRect } from './cropMath'

const bounds = { w: 200, h: 100 }
const start = { x: 20, y: 10, w: 100, h: 50 }

describe('dragRect', () => {
  it('moves without leaving the image', () => {
    expect(dragRect(start, 'move', 30, 5, bounds, null)).toEqual({ x: 50, y: 15, w: 100, h: 50 })
    expect(dragRect(start, 'move', 500, 500, bounds, null)).toEqual({ x: 100, y: 50, w: 100, h: 50 })
    expect(dragRect(start, 'move', -500, -500, bounds, null)).toEqual({ x: 0, y: 0, w: 100, h: 50 })
  })

  it('resizes freely from any handle and clamps to the image', () => {
    expect(dragRect(start, 'e', 40, 0, bounds, null)).toEqual({ x: 20, y: 10, w: 140, h: 50 })
    expect(dragRect(start, 'w', -40, 0, bounds, null)).toEqual({ x: 0, y: 10, w: 120, h: 50 })
    expect(dragRect(start, 'se', 999, 999, bounds, null)).toEqual({ x: 20, y: 10, w: 180, h: 90 })
    expect(dragRect(start, 'nw', -999, -999, bounds, null)).toEqual({ x: 0, y: 0, w: 120, h: 60 })
  })

  it('never shrinks below a few pixels', () => {
    const r = dragRect(start, 'e', -999, 0, bounds, null)
    expect(r.w).toBe(4)
    expect(dragRect(start, 'n', 0, 999, bounds, null).h).toBe(4)
  })

  it('keeps the aspect ratio from a corner, anchored on the opposite corner', () => {
    const r = dragRect({ x: 50, y: 25, w: 80, h: 40 }, 'se', 20, 0, bounds, 2)
    expect(r.w / r.h).toBeCloseTo(2, 1)
    expect(r.x).toBe(50)
    expect(r.y).toBe(25)
    const nw = dragRect({ x: 50, y: 25, w: 80, h: 40 }, 'nw', -20, 0, bounds, 2)
    expect(nw.x + nw.w).toBe(130)
    expect(nw.y + nw.h).toBe(65)
  })

  it('keeps the ratio on an edge handle, growing around the centre, and stays inside', () => {
    const r = dragRect({ x: 50, y: 25, w: 100, h: 50 }, 'e', 40, 0, bounds, 2)
    expect(r.w / r.h).toBeCloseTo(2, 1)
    expect(r.x).toBe(50)
    expect(r.x + r.w).toBeLessThanOrEqual(200)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.y + r.h).toBeLessThanOrEqual(100)
  })

  it('cannot grow a locked rectangle past the image', () => {
    const r = dragRect({ x: 0, y: 0, w: 100, h: 100 }, 'se', 999, 999, { w: 200, h: 100 }, 1)
    expect(r).toEqual({ x: 0, y: 0, w: 100, h: 100 })
  })
})
