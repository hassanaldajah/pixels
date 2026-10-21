import { describe, expect, it } from 'vitest'
import { FrameMonitor } from './perf'

const feed = (m: FrameMonitor, ms: number, frames: number) => {
  for (let i = 0; i < frames; i++) m.record(ms)
}

describe('FrameMonitor', () => {
  it('reduces effects after two consecutive slow windows', () => {
    const calls: boolean[] = []
    const m = new FrameMonitor((r) => calls.push(r))
    feed(m, 30, 45)
    expect(calls).toEqual([])
    feed(m, 30, 45)
    expect(calls).toEqual([true])
  })

  it('does not flap on an occasional slow frame', () => {
    const calls: boolean[] = []
    const m = new FrameMonitor((r) => calls.push(r))
    for (let w = 0; w < 5; w++) {
      feed(m, 8, 44)
      m.record(60)
    }
    expect(calls).toEqual([])
  })

  it('restores effects only after a sustained fast period', () => {
    const calls: boolean[] = []
    const m = new FrameMonitor((r) => calls.push(r))
    feed(m, 30, 90)
    feed(m, 8, 45 * 5)
    expect(calls.at(-1)).toBe(true)
    feed(m, 8, 45)
    expect(calls.at(-1)).toBe(false)
  })
})
