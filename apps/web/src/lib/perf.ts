/**
 * Frame-time monitor. Decorative effects (glass shimmer, logo glow animation) switch off when the
 * canvas cannot hold a 16 ms frame and come back once it recovers.
 */
const WINDOW = 45
const SLOW_MS = 18
const FAST_MS = 13

export class FrameMonitor {
  private samples: number[] = []
  private slowWindows = 0
  private fastWindows = 0

  constructor(private readonly onChange: (reduced: boolean) => void) {}

  /** Feed the duration of a frame that actually rendered. Returns true when state flipped. */
  record(ms: number): void {
    this.samples.push(ms)
    if (this.samples.length < WINDOW) return
    const average = this.samples.reduce((a, b) => a + b, 0) / this.samples.length
    this.samples = []
    if (average > SLOW_MS) {
      this.slowWindows++
      this.fastWindows = 0
      if (this.slowWindows >= 2) this.onChange(true)
    } else if (average < FAST_MS) {
      this.fastWindows++
      this.slowWindows = 0
      if (this.fastWindows >= 6) this.onChange(false)
    } else {
      this.slowWindows = 0
      this.fastWindows = 0
    }
  }
}
