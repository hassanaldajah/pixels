/**
 * Timeline pictures: small frames along video clips and the loudness outline of sound. Both are made once per
 * file in the background, kept in memory, and drawn by the clips at whatever zoom the timeline has.
 */
import { AudioBufferSink, CanvasSink } from 'mediabunny'
import type { MediaRef } from './model'
import { openMedia } from './media'

export const THUMB_HEIGHT = 40
const THUMB_STEP = 1 // seconds between thumbnails
const MAX_THUMBS = 600
export const PEAKS_PER_SECOND = 50

export interface Thumbs {
  step: number
  frames: (ImageBitmap | null)[]
}

const thumbs = new Map<string, Promise<Thumbs>>()
const peaks = new Map<string, Promise<Float32Array | null>>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())
export const onThumbsChanged = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** One small frame per second (fewer for long files), filled in as they decode. */
export function thumbnails(m: MediaRef): Promise<Thumbs> {
  let p = thumbs.get(m.id)
  if (!p) {
    p = (async () => {
      const { video } = await openMedia(m)
      const step = Math.max(THUMB_STEP, m.duration / MAX_THUMBS)
      const count = Math.max(1, Math.ceil(m.duration / step))
      const result: Thumbs = { step, frames: new Array<ImageBitmap | null>(count).fill(null) }
      if (!video) return result
      const width = Math.max(2, Math.round((THUMB_HEIGHT * m.width) / Math.max(1, m.height)))
      const sink = new CanvasSink(video, { width, height: THUMB_HEIGHT, fit: 'cover', poolSize: 2 })
      const times = Array.from({ length: count }, (_, i) => Math.min(m.duration - 0.01, i * step + step / 2))
      void (async () => {
        let i = 0
        for await (const frame of sink.canvasesAtTimestamps(times)) {
          if (frame) result.frames[i] = await createImageBitmap(frame.canvas)
          i++
          if (i % 8 === 0) changed()
        }
        changed()
      })()
      return result
    })()
    thumbs.set(m.id, p)
    p.catch(() => thumbs.delete(m.id))
  }
  return p
}

/** The loudest sample in every 1/50 s of the file, 0..1 (both channels together). */
export function waveform(m: MediaRef): Promise<Float32Array | null> {
  let p = peaks.get(m.id)
  if (!p) {
    p = (async () => {
      const { audio } = await openMedia(m)
      if (!audio) return null
      const out = new Float32Array(Math.max(1, Math.ceil(m.duration * PEAKS_PER_SECOND)))
      for await (const { buffer, timestamp } of new AudioBufferSink(audio).buffers()) {
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
        const perPeak = buffer.sampleRate / PEAKS_PER_SECOND
        for (let s = 0; s < buffer.length; s++) {
          const bin = Math.floor((timestamp + s / buffer.sampleRate) * PEAKS_PER_SECOND)
          if (bin < 0 || bin >= out.length) continue
          let v = 0
          for (const ch of channels) v = Math.max(v, Math.abs(ch[s] as number))
          if (v > (out[bin] as number)) out[bin] = v
          s += perPeak > 64 ? 3 : 0 // long bins: every 4th sample is plenty for a picture
        }
      }
      changed()
      return out
    })()
    peaks.set(m.id, p)
    p.catch(() => peaks.delete(m.id))
  }
  return p
}
