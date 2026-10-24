/**
 * Export: every frame is drawn with the same drawFrame() as the preview, at the chosen size, and encoded with
 * the platform's encoder through WebCodecs (Intel Quick Sync, NVIDIA, AMD or Apple hardware when present).
 * Sound is mixed with Web Audio in short chunks, so a long video never needs all its sound in memory.
 * When the browser can write files directly, the video streams to disk instead of filling memory.
 */
import {
  AudioBufferSource,
  BufferTarget,
  canEncodeAudio,
  canEncodeVideo,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_VERY_HIGH,
  StreamTarget,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny'
import { clipEnd, gainAt, projectDuration, sourceTime, type Project } from './model'
import { audioBuffers } from './media'
import { gather } from './player'
import { drawFrame } from './render'

export const RESOLUTIONS = [
  { id: '720', label: '720p', short: 720 },
  { id: '1080', label: '1080p (Full HD)', short: 1080 },
  { id: '1440', label: '1440p (2K)', short: 1440 },
  { id: '2160', label: '2160p (4K)', short: 2160 },
] as const
export type ResolutionId = (typeof RESOLUTIONS)[number]['id']

const even = (v: number) => Math.max(2, Math.round(v / 2) * 2)

/** The output size for a resolution: its shorter side is `short`, in the project's shape. */
export function outputSize(p: Project, short: number): { width: number; height: number } {
  const k = short / Math.min(p.width, p.height)
  return { width: even(p.width * k), height: even(p.height * k) }
}

/** Which resolutions this device can encode (checked with the real encoder, not guessed). */
export async function supported(p: Project): Promise<Record<ResolutionId, VideoCodec | null>> {
  const result = {} as Record<ResolutionId, VideoCodec | null>
  for (const r of RESOLUTIONS) {
    const { width, height } = outputSize(p, r.short)
    let codec: VideoCodec | null = null
    for (const c of ['avc', 'hevc'] as VideoCodec[]) {
      if (await canEncodeVideo(c, { width, height, quality: QUALITY_VERY_HIGH })) {
        codec = c
        break
      }
    }
    result[r.id] = codec
  }
  return result
}

export interface ExportJob {
  cancel: () => Promise<void>
  done: Promise<void>
}

const SAMPLE_RATE = 48000
const CHUNK = 10 // seconds of sound mixed at a time

/** Mix the sound of [from, to) into one stereo buffer. */
async function mixAudio(p: Project, from: number, to: number): Promise<AudioBuffer> {
  const length = Math.max(1, Math.round((to - from) * SAMPLE_RATE))
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE)
  const clips = p.clips.filter((c) => {
    const media = c.mediaId ? p.media[c.mediaId] : undefined
    const track = p.tracks.find((x) => x.id === c.track)
    return (
      (c.kind === 'video' || c.kind === 'audio') &&
      !!media?.hasAudio &&
      c.volume > 0 &&
      !track?.muted &&
      c.start < to &&
      clipEnd(c) > from
    )
  })
  for (const c of clips) {
    const media = p.media[c.mediaId as string]!
    const begin = Math.max(from, c.start)
    const end = Math.min(to, clipEnd(c))
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    const steps = Math.max(2, Math.ceil((end - begin) * 50))
    for (let i = 0; i <= steps; i++) {
      const t = begin + ((end - begin) * i) / steps
      gain.gain.setValueAtTime(gainAt(c, t - c.start), t - from)
    }
    const buffers = await audioBuffers(media, sourceTime(c, begin), sourceTime(c, end))
    if (!buffers) continue
    for await (const { buffer, timestamp } of buffers) {
      const node = ctx.createBufferSource()
      node.buffer = buffer
      node.playbackRate.value = c.speed
      node.connect(gain)
      const at = c.start + (timestamp - c.in) / c.speed - from
      const skip = Math.max(0, -at) * c.speed
      if (skip >= buffer.duration) continue
      node.start(Math.max(0, at), skip)
      // stop at the clip's end, so a source that runs on is cut where the clip ends
      node.stop(Math.max(0, end - from))
    }
  }
  return ctx.startRendering()
}

export function exportVideo(
  p: Project,
  options: { short: number; codec: VideoCodec; file?: FileSystemFileHandle | null },
  onProgress: (fraction: number) => void,
): ExportJob {
  const { width, height } = outputSize(p, options.short)
  const fps = p.fps
  const duration = projectDuration(p)
  const frames = Math.max(1, Math.ceil(duration * fps))
  let cancelled = false
  let output: Output | null = null

  const done = (async () => {
    const writable = options.file ? await options.file.createWritable() : null
    const target = writable ? new StreamTarget(writable, { chunked: true }) : new BufferTarget()
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: writable ? false : 'in-memory' }),
      target,
    })
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('2D canvas is not available.')
    const video = new CanvasSource(canvas, {
      codec: options.codec,
      bitrate: QUALITY_VERY_HIGH,
      keyFrameInterval: 2,
      latencyMode: 'quality',
      hardwareAcceleration: 'prefer-hardware',
    })
    output.addVideoTrack(video, { frameRate: fps })
    const hasSound = p.clips.some((c) => c.mediaId && p.media[c.mediaId]?.hasAudio)
    let audio: AudioBufferSource | null = null
    if (hasSound) {
      const codec: AudioCodec | null = (await canEncodeAudio('aac', {
        sampleRate: SAMPLE_RATE,
        numberOfChannels: 2,
      }))
        ? 'aac'
        : (await canEncodeAudio('opus', { sampleRate: SAMPLE_RATE, numberOfChannels: 2 }))
          ? 'opus'
          : null
      if (codec) {
        audio = new AudioBufferSource({ codec, bitrate: QUALITY_VERY_HIGH })
        output.addAudioTrack(audio)
      }
    }
    await output.start()
    try {
      let mixedTo = 0
      for (let i = 0; i < frames; i++) {
        if (cancelled) return
        const t = i / fps
        if (audio && t >= mixedTo && mixedTo < duration) {
          const to = Math.min(duration, mixedTo + CHUNK)
          await audio.add(await mixAudio(p, mixedTo, to))
          mixedTo = to
        }
        const pictures = await gather(p, t, width, height)
        drawFrame(ctx, p, t, pictures, width, height)
        await video.add(t, 1 / fps)
        onProgress((i + 1) / frames)
      }
      await output.finalize()
      if (!writable && target instanceof BufferTarget && target.buffer) {
        const blob = new Blob([target.buffer], { type: 'video/mp4' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${p.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'video'}.mp4`
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
      }
    } catch (error) {
      if (output.state !== 'canceled') await output.cancel()
      throw error
    }
  })()

  return {
    done,
    cancel: async () => {
      cancelled = true
      if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel()
    },
  }
}
