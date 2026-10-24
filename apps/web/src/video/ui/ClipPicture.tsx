import { useEffect, useRef, useState } from 'react'
import type { Clip, MediaRef } from '../model'
import { onThumbsChanged, PEAKS_PER_SECOND, thumbnails, waveform, type Thumbs } from '../thumbs'

/** Frames along a video clip and the sound's outline along the bottom, drawn for the clip's current size. */
export function ClipPicture({
  clip,
  media,
  width,
  height,
}: {
  clip: Clip
  media: MediaRef
  width: number
  height: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [tick, setTick] = useState(0)
  const [thumbs, setThumbs] = useState<Thumbs | null>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)

  useEffect(() => onThumbsChanged(() => setTick((n) => n + 1)), [])
  useEffect(() => {
    let alive = true
    if (media.kind === 'video') void thumbnails(media).then((t) => alive && setThumbs(t))
    if (media.hasAudio) void waveform(media).then((p) => alive && setPeaks(p))
    return () => {
      alive = false
    }
  }, [media])

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.round(width * dpr))
    const h = Math.max(1, Math.round(height * dpr))
    if (el.width !== w || el.height !== h) {
      el.width = w
      el.height = h
    }
    ctx.clearRect(0, 0, w, h)
    const seconds = clip.duration
    const toSource = (x: number) => clip.in + (x / w) * seconds * clip.speed
    if (thumbs) {
      const first = thumbs.frames.find(Boolean)
      const tw = first ? (first.width / first.height) * h : h * 1.6
      ctx.globalAlpha = 0.85
      for (let x = 0; x < w; x += tw) {
        const frame =
          thumbs.frames[Math.min(thumbs.frames.length - 1, Math.floor(toSource(x + tw / 2) / thumbs.step))]
        if (frame) ctx.drawImage(frame, x, 0, tw, h)
      }
      ctx.globalAlpha = 1
    }
    if (peaks) {
      const band = media.kind === 'audio' ? h : h * 0.38
      const mid = h - band / 2
      ctx.fillStyle = media.kind === 'audio' ? 'rgba(255, 255, 255, 0.55)' : 'rgba(255, 255, 255, 0.45)'
      for (let x = 0; x < w; x++) {
        const a = Math.floor(toSource(x) * PEAKS_PER_SECOND)
        const b = Math.max(a + 1, Math.floor(toSource(x + 1) * PEAKS_PER_SECOND))
        let v = 0
        for (let i = a; i < b && i < peaks.length; i++) v = Math.max(v, peaks[i] as number)
        const bar = Math.max(1, v * clip.volume * band)
        ctx.fillRect(x, mid - bar / 2, 1, bar)
      }
    }
  }, [thumbs, peaks, tick, clip.in, clip.duration, clip.speed, clip.volume, width, height, media.kind])

  return <canvas ref={canvas} className="v-clip-picture" style={{ width, height }} aria-hidden="true" />
}
