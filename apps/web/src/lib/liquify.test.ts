import { describe, expect, it } from 'vitest'
import { liquifyField } from './liquify'

describe('liquify field (mirrors server/pipeline/liquify.py)', () => {
  it('push drags to the right, far pixels stay still', () => {
    const d = liquifyField(
      [
        {
          mode: 'push',
          r: 10,
          strength: 1,
          pts: [
            [16.5, 20.5],
            [20.5, 20.5],
          ],
        },
      ],
      40,
      40,
    )
    expect(d[(20 * 40 + 18) * 2] as number).toBeGreaterThan(2)
    expect(Math.abs(d[(20 * 40 + 18) * 2 + 1] as number)).toBeLessThan(1e-6)
    expect(d[0]).toBe(0)
  })

  it('bloat and pinch are opposite', () => {
    const b = liquifyField([{ mode: 'bloat', r: 12, strength: 0.8, pts: [[20.5, 20.5]] }], 40, 40)
    const p = liquifyField([{ mode: 'pinch', r: 12, strength: 0.8, pts: [[20.5, 20.5]] }], 40, 40)
    for (let i = 0; i < b.length; i++) expect((b[i] as number) + (p[i] as number)).toBeCloseTo(0, 6)
  })

  it('matches the server value at a probe point', () => {
    const d = liquifyField(
      [
        {
          mode: 'push',
          r: 10,
          strength: 1,
          pts: [
            [16.5, 20.5],
            [20.5, 20.5],
          ],
        },
      ],
      40,
      40,
    )
    expect(d[(20 * 40 + 18) * 2] as number).toBeCloseTo(3.5840001106262207, 5) // printed by the numpy version
  })
})
