import { describe, expect, it } from 'vitest'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  constrainPan,
  fitView,
  formatZoom,
  imageToScreen,
  rulerStep,
  screenToImage,
  snapGuide,
  stepZoom,
  zoomAt,
} from './math'

const viewport = { w: 1000, h: 600 }

describe('coordinate transforms', () => {
  it('round-trips between screen and image space', () => {
    const view = { zoom: 2, panX: 300, panY: 200 }
    const p = { x: 123, y: 456 }
    for (const dpr of [1, 1.5, 2]) {
      const back = imageToScreen(screenToImage(p, view, viewport, dpr), view, viewport, dpr)
      expect(back.x).toBeCloseTo(p.x)
      expect(back.y).toBeCloseTo(p.y)
    }
  })

  it('puts the pan point at the centre of the viewport', () => {
    const c = imageToScreen({ x: 300, y: 200 }, { zoom: 3, panX: 300, panY: 200 }, viewport, 2)
    expect(c).toEqual({ x: 500, y: 300 })
  })

  it('treats 100% as one image pixel per physical pixel', () => {
    const a = imageToScreen({ x: 0, y: 0 }, { zoom: 1, panX: 0, panY: 0 }, viewport, 2)
    const b = imageToScreen({ x: 100, y: 0 }, { zoom: 1, panX: 0, panY: 0 }, viewport, 2)
    expect(b.x - a.x).toBe(50) // 100 image px = 100 device px = 50 CSS px on a 2x display
  })
})

describe('zoomAt', () => {
  it('keeps the image point under the cursor fixed', () => {
    const view = { zoom: 1, panX: 500, panY: 400 }
    const anchor = { x: 820, y: 130 }
    const before = screenToImage(anchor, view, viewport, 1.25)
    const zoomed = zoomAt(view, 4.5, anchor, viewport, 1.25)
    const after = screenToImage(anchor, zoomed, viewport, 1.25)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(zoomed.zoom).toBe(4.5)
  })

  it('clamps to 10%..1000%', () => {
    expect(zoomAt({ zoom: 1, panX: 0, panY: 0 }, 99, { x: 0, y: 0 }, viewport, 1).zoom).toBe(MAX_ZOOM)
    expect(clampZoom(0.001)).toBe(MIN_ZOOM)
  })
})

describe('fit and constrain', () => {
  it('fits a wide image by width and centres it', () => {
    const v = fitView({ w: 2000, h: 500 }, viewport, 1)
    expect(v.zoom).toBeCloseTo((1000 / 2000) * 0.92)
    expect([v.panX, v.panY]).toEqual([1000, 250])
  })

  it('never lets the image leave the screen entirely', () => {
    const far = constrainPan({ zoom: 1, panX: 99999, panY: -99999 }, { w: 800, h: 600 }, viewport, 1)
    expect(far.panX).toBeLessThan(800 + 1000)
    expect(far.panY).toBeGreaterThan(-600)
  })
})

describe('zoom presets', () => {
  it('steps through round values in both directions', () => {
    expect(stepZoom(1, 1)).toBe(1.5)
    expect(stepZoom(1, -1)).toBeCloseTo(0.6667)
    expect(stepZoom(10, 1)).toBe(10)
    expect(stepZoom(0.1, -1)).toBe(0.1)
    expect(stepZoom(0.73, 1)).toBe(1)
  })

  it('formats percentages', () => {
    expect(formatZoom(1)).toBe('100%')
    expect(formatZoom(0.1667)).toBe('16.7%')
    expect(formatZoom(10)).toBe('1000%')
  })
})

describe('guides and rulers', () => {
  it('snaps to edges, centre and thirds within tolerance only', () => {
    const targets = [0, 100, 150, 200, 300]
    expect(snapGuide(103, targets, 5)).toBe(100)
    expect(snapGuide(112, targets, 5)).toBe(112)
    expect(snapGuide(112.4, [], 5)).toBe(112)
  })

  it('picks 1-2-5 ruler steps', () => {
    expect(rulerStep(1)).toBe(100)
    expect(rulerStep(10)).toBe(10)
    expect(rulerStep(0.1)).toBe(1000)
  })
})
