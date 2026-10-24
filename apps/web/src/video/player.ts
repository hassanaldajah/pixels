/**
 * Preview playback. The audio clock (Web Audio) is the master: the picture follows it, so sound and picture
 * stay together even when a slow device drops frames. Frames are fetched for the visible clips only, at the
 * preview's size, and a frame is skipped rather than queued when decoding falls behind.
 */
import { clipEnd, gainAt, projectDuration, sourceTime, visibleAt, type Clip, type Project } from './model'
import { audioBuffers, frameSourceFor, loadStill, pruneSources } from './media'
import { drawFrame, titleFor, type Drawable } from './render'

const AUDIO_LEAD = 0.12 // seconds of sound scheduled ahead of the picture

/** The pictures of every clip visible at `t`, at the size they will be drawn on a W x H output. */
export async function gather(
  p: Project,
  t: number,
  W: number,
  H: number,
  keep?: Set<string>,
): Promise<Map<string, Drawable>> {
  const frames = new Map<string, Drawable>()
  await Promise.all(
    visibleAt(p, t).map(async (v) => {
      const c = v.clip
      if (c.kind === 'text') {
        const title = await titleFor(c)
        if (title) frames.set(c.id, { source: title, width: title.width, height: title.height })
        return
      }
      const media = c.mediaId ? p.media[c.mediaId] : undefined
      if (!media) return
      if (c.kind === 'image') {
        const bitmap = await loadStill(media)
        frames.set(c.id, { source: bitmap, width: bitmap.width, height: bitmap.height })
        return
      }
      // decode no larger than it is drawn (fitted to the frame), never larger than the source
      const fit = Math.min(1, Math.max(W / media.width, H / media.height) * Math.max(1, c.transform.scale))
      const fw = Math.max(2, Math.round(media.width * fit))
      const fh = Math.max(2, Math.round(media.height * fit))
      keep?.add(`${c.id}:${fw}x${fh}`)
      const source = await frameSourceFor(c.id, media, fw, fh)
      if (!source) return
      const end = Math.max(0, media.duration - 1 / 120)
      const frame = await source.frameAt(Math.min(end, Math.max(0, sourceTime(c, t))))
      if (frame)
        frames.set(c.id, { source: frame.canvas, width: frame.canvas.width, height: frame.canvas.height })
    }),
  )
  return frames
}

export class Player {
  private ctx: CanvasRenderingContext2D
  private audio: AudioContext | null = null
  private nodes: AudioScheduledSourceNode[] = []
  private startedAt = 0 // audio clock when playback started
  private from = 0 // timeline time when playback started
  private raf = 0
  private busy = false
  private pending: { p: Project; t: number } | null = null
  onTime: (t: number) => void = () => {}
  onEnd: () => void = () => {}

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
    if (!ctx) throw new Error('2D canvas is not available.')
    this.ctx = ctx
  }

  /** Draw the frame at `t`. While a frame is being prepared, only the newest request is kept. */
  async show(p: Project, t: number): Promise<void> {
    this.pending = { p, t }
    if (this.busy) return
    this.busy = true
    try {
      while (this.pending) {
        const job = this.pending
        this.pending = null
        const keep = new Set<string>()
        const frames = await gather(job.p, job.t, this.canvas.width, this.canvas.height, keep)
        drawFrame(this.ctx, job.p, job.t, frames, this.canvas.width, this.canvas.height)
        if (!this.raf) pruneSources(keep)
      }
    } finally {
      this.busy = false
    }
  }

  get playing(): boolean {
    return this.raf !== 0
  }

  play(p: Project, from: number): void {
    this.stop()
    const end = projectDuration(p)
    if (end <= 0) return
    this.audio ??= new AudioContext({ latencyHint: 'playback' })
    void this.audio.resume()
    this.from = from >= end - 0.05 ? 0 : from
    this.startedAt = this.audio.currentTime + AUDIO_LEAD
    this.scheduleAudio(p, this.from)
    const tick = () => {
      const t = this.now()
      if (t >= end) {
        this.onTime(end)
        void this.show(p, end)
        this.stop()
        this.onEnd()
        return
      }
      this.onTime(t)
      if (!this.busy) void this.show(p, t) // a slow frame is skipped, the clock keeps going
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  now(): number {
    return this.audio ? this.from + Math.max(0, this.audio.currentTime - this.startedAt) : this.from
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    for (const n of this.nodes) {
      try {
        n.stop()
      } catch {
        /* already stopped */
      }
    }
    this.nodes = []
  }

  /** Schedule every clip's sound from `from` on: decoded in chunks as it goes, faded and mixed by Web Audio. */
  private scheduleAudio(p: Project, from: number): void {
    const audio = this.audio
    if (!audio) return
    const generation = this.startedAt
    const clips = p.clips.filter(
      (c) => (c.kind === 'video' || c.kind === 'audio') && clipEnd(c) > from && audibleClip(p, c),
    )
    for (const c of clips) {
      const media = p.media[c.mediaId as string]
      if (!media) continue
      const begin = Math.max(from, c.start)
      void (async () => {
        const gain = audio.createGain()
        gain.connect(audio.destination)
        // the clip's volume and fades as an automation curve on the audio clock
        const at = (t: number) => this.startedAt + (t - from)
        const steps = Math.max(2, Math.ceil((clipEnd(c) - begin) * 20))
        for (let i = 0; i <= steps; i++) {
          const t = begin + ((clipEnd(c) - begin) * i) / steps
          gain.gain.setValueAtTime(gainAt(c, t - c.start), Math.max(audio.currentTime, at(t)))
        }
        const buffers = await audioBuffers(media, sourceTime(c, begin), sourceTime(c, clipEnd(c)))
        if (!buffers) return
        for await (const { buffer, timestamp } of buffers) {
          if (this.startedAt !== generation || !this.raf) return
          const node = audio.createBufferSource()
          node.buffer = buffer
          node.playbackRate.value = c.speed
          node.connect(gain)
          const timelineT = c.start + (timestamp - c.in) / c.speed
          const when = at(timelineT)
          const skip = Math.max(0, audio.currentTime - when) * c.speed
          if (skip >= buffer.duration) continue
          node.start(Math.max(audio.currentTime, when), skip)
          this.nodes.push(node)
        }
      })()
    }
  }

  dispose(): void {
    this.stop()
    void this.audio?.close()
    this.audio = null
  }
}

/** A clip makes sound if its file has sound, its volume is above zero and its track is not muted. */
function audibleClip(p: Project, c: Clip): boolean {
  const media = c.mediaId ? p.media[c.mediaId] : undefined
  return !!media?.hasAudio && c.volume > 0 && !p.tracks.find((t) => t.id === c.track)?.muted
}
