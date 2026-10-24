/**
 * Reading gated media in the browser with mediabunny: containers are parsed in JavaScript and frames are
 * decoded by the platform's own WebCodecs decoders (hardware where available, sandboxed by the browser).
 * Files are read with ranged requests from /api/media, so only the parts that play are fetched.
 */
import {
  ALL_FORMATS,
  AudioBufferSink,
  CanvasSink,
  Input,
  UrlSource,
  type InputAudioTrack,
  type InputVideoTrack,
  type WrappedCanvas,
} from 'mediabunny'
import { mediaHeaders } from '../api/client'
import type { MediaRef } from './model'
import { markUndecodable } from './support'

export interface OpenMedia {
  input: Input
  video: InputVideoTrack | null
  audio: InputAudioTrack | null
}

const opened = new Map<string, Promise<OpenMedia>>()

export function openMedia(m: MediaRef): Promise<OpenMedia> {
  let p = opened.get(m.id)
  if (!p) {
    p = (async () => {
      const input = new Input({
        formats: ALL_FORMATS,
        source: new UrlSource(m.url, { requestInit: { headers: mediaHeaders() } }),
      })
      const video = m.hasVideo ? await input.getPrimaryVideoTrack() : null
      const audio = m.hasAudio ? await input.getPrimaryAudioTrack() : null
      const playable = !!video && (await video.canDecode())
      if (video && !playable) markUndecodable(m.id) // the editor explains how to fix it
      return {
        video: playable ? video : null,
        audio: audio && (await audio.canDecode()) ? audio : null,
        input,
      }
    })()
    opened.set(m.id, p)
    p.catch(() => opened.delete(m.id))
  }
  return p
}

const stills = new Map<string, Promise<ImageBitmap>>()

/** A picture clip's pixels (already a sanitised PNG from the image gate). */
export function loadStill(m: MediaRef): Promise<ImageBitmap> {
  let p = stills.get(m.id)
  if (!p) {
    p = fetch(m.url, { headers: mediaHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error(`The picture could not be loaded (HTTP ${r.status}).`)
        return r.blob()
      })
      .then((b) => createImageBitmap(b))
    stills.set(m.id, p)
    p.catch(() => stills.delete(m.id))
  }
  return p
}

/**
 * Frames of one video at one size. While playing, frames come from one running decoder (fast, in order);
 * a jump backwards or far ahead restarts it at the new time. Calls are serialised; the newest request wins.
 */
export class FrameSource {
  private sink: CanvasSink
  private iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null
  private current: WrappedCanvas | null = null
  private upcoming: WrappedCanvas | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private wanted = 0

  constructor(track: InputVideoTrack, width: number, height: number) {
    // a pool of four canvases: the shown frame, the next one, and room for the decoder to work ahead
    this.sink = new CanvasSink(track, { width, height, fit: 'contain', poolSize: 4 })
  }

  /** The frame on screen at source time `t` (seconds), or null past the end. */
  frameAt(t: number): Promise<WrappedCanvas | null> {
    this.wanted = t
    const run = this.queue.then(() => (this.wanted === t ? this.advance(t) : this.current))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async advance(t: number): Promise<WrappedCanvas | null> {
    const inCurrent = (w: WrappedCanvas | null) => !!w && t >= w.timestamp && t < w.timestamp + w.duration
    if (inCurrent(this.current)) return this.current
    const close = this.current && t > this.current.timestamp && t - this.current.timestamp < 1.5
    if (!this.iterator || !close) {
      await this.iterator?.return()
      this.iterator = this.sink.canvases(Math.max(0, t))
      this.current = (await this.iterator.next()).value ?? null
      this.upcoming = (await this.iterator.next()).value ?? null
      return this.current
    }
    while (this.upcoming && this.upcoming.timestamp <= t) {
      this.current = this.upcoming
      this.upcoming = (await this.iterator.next()).value ?? null
    }
    return this.current
  }

  async close(): Promise<void> {
    await this.iterator?.return()
    this.iterator = null
  }
}

const sources = new Map<string, FrameSource>()

/** One running frame source per clip (two clips of the same file play at different times). */
export async function frameSourceFor(
  clipId: string,
  m: MediaRef,
  width: number,
  height: number,
): Promise<FrameSource | null> {
  const key = `${clipId}:${width}x${height}`
  const existing = sources.get(key)
  if (existing) return existing
  const media = await openMedia(m)
  if (!media.video) return null
  const source = new FrameSource(media.video, width, height)
  sources.set(key, source)
  return source
}

let pruneLocked = false
/** While an export runs, the preview must not close the decoders the export is reading from. */
export function lockSources(locked: boolean): void {
  pruneLocked = locked
}

/** Drop the sources no clip uses any more (after a cut, a delete, a resize of the preview). */
export function pruneSources(keep: Set<string>): void {
  if (pruneLocked) return
  for (const [key, source] of sources) {
    if (!keep.has(key)) {
      void source.close()
      sources.delete(key)
    }
  }
}

/** Decoded sound of one file between two source times, for playback and export. */
export async function audioBuffers(m: MediaRef, from: number, to: number) {
  const media = await openMedia(m)
  if (!media.audio) return null
  return new AudioBufferSink(media.audio).buffers(from, to)
}
