import { describe, expect, it } from 'vitest'
import { pathBounds, svgPath, type PathOptions } from './penPath'

const style = { fill: '#ff0000', stroke: null, width: 0 }

describe('pen paths', () => {
  it('bounds include the nodes, the handles and the outline', () => {
    const o: PathOptions = {
      ...style,
      closed: true,
      nodes: [
        { x: 10, y: 10 },
        { x: 50, y: 10, out: [20, 30] },
        { x: 30, y: 40 },
      ],
    }
    expect(pathBounds(o)).toEqual({ x: 8, y: 8, w: 64, h: 34 })
    expect(pathBounds({ ...o, stroke: '#000000', width: 10 })).toEqual({ x: 3, y: 3, w: 74, h: 44 })
    expect(pathBounds({ ...o, nodes: [] })).toBeNull()
  })

  it('straight segments become lines and curved ones Béziers; a closed path ends with Z', () => {
    const o: PathOptions = {
      ...style,
      closed: true,
      nodes: [
        { x: 0, y: 0 },
        { x: 10, y: 0, out: [5, 5] },
        { x: 10, y: 10 },
      ],
    }
    const d = svgPath(o, (x, y) => [x, y])
    expect(d).toBe('M 0.0 0.0 L 10.0 0.0 C 15.0 5.0 10.0 10.0 10.0 10.0 L 0.0 0.0 Z')
  })
})
