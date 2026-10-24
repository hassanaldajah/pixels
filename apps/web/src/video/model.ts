/**
 * The video project: tracks of clips on a timeline, and the pure functions that edit it.
 * Everything here is plain data (saved in projects and history) and is unit-tested; nothing touches the DOM.
 *
 * Times are seconds. The first video track is the main track: it is magnetic, so its clips always sit
 * back to back from 0 (cutting or removing a clip closes the gap). Other tracks place clips freely.
 */
import type { TextOptions } from '../lib/makeShape'
import { outputColors } from '../tokens'

export const MIN_CLIP = 0.1 // shortest clip, seconds
export const IMAGE_DEFAULT = 4 // a still picture or a title starts this long
export const MAX_STILL = 3600

export interface MediaRef {
  id: string // the Security Gate id (video/audio: /api/media, picture: /api/images)
  kind: 'video' | 'audio' | 'image'
  url: string
  name: string
  duration: number // seconds (0 for pictures)
  width: number
  height: number
  hasVideo: boolean
  hasAudio: boolean
}

export type TrackKind = 'video' | 'audio' | 'text'

export interface Track {
  id: string
  kind: TrackKind
  muted: boolean
  hidden: boolean
}

export type TransitionKind = 'fade' | 'dip' | 'wipe' | 'slide' | 'zoom'
export type AnimKind = 'none' | 'fade' | 'rise' | 'pop' | 'slide'
export type KeyProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity'
export type Ease = 'linear' | 'ease'

export interface Keyframe {
  t: number // seconds from the clip's start
  v: number
  ease: Ease
}

export interface Transform {
  x: number // offset of the centre from the frame centre, project pixels
  y: number
  scale: number // 1 = fitted to the frame
  rotation: number // degrees
  opacity: number // 0..1
}

export interface ClipColor {
  exposure: number // EV
  contrast: number // -100..100
  saturation: number // -100..100
  temperature: number // -100..100
  vignette: number // 0..100
}

export interface Clip {
  id: string
  track: string
  kind: 'video' | 'image' | 'audio' | 'text'
  mediaId?: string
  start: number // on the timeline
  duration: number // on the timeline
  in: number // where it starts in the source, seconds (video and audio)
  speed: number // 0.25..4
  volume: number // 0..2
  fadeIn: number // sound, seconds
  fadeOut: number
  fit: 'contain' | 'cover'
  transform: Transform
  color: ClipColor
  filter: string // a named look, 'none' for none
  transitionIn: { kind: TransitionKind; duration: number } | null // from the previous clip (main track)
  text?: TextOptions
  animIn: AnimKind
  animOut: AnimKind
  keys: Partial<Record<KeyProp, Keyframe[]>>
}

export interface Project {
  version: 1
  /** Identifies the project in the recent list (older saves get one when they are opened). */
  id?: string
  name: string
  width: number
  height: number
  fps: number
  background: string
  tracks: Track[]
  clips: Clip[]
  media: Record<string, MediaRef>
}

export const ASPECTS = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '4:3': [1440, 1080],
  '21:9': [2560, 1080],
} as const
export type Aspect = keyof typeof ASPECTS

export const newId = (): string => crypto.randomUUID().replaceAll('-', '').slice(0, 12)

export function emptyProject(name = 'Untitled video', aspect: Aspect = '16:9'): Project {
  const [width, height] = ASPECTS[aspect]
  return {
    version: 1,
    id: newId(),
    name,
    width,
    height,
    fps: 30,
    background: outputColors.black,
    tracks: [
      { id: 'main', kind: 'video', muted: false, hidden: false },
      { id: 'audio1', kind: 'audio', muted: false, hidden: false },
    ],
    clips: [],
    media: {},
  }
}

export const neutralColor = (): ClipColor => ({
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  vignette: 0,
})
export const neutralTransform = (): Transform => ({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 })

export function makeClip(
  kind: Clip['kind'],
  track: string,
  start: number,
  duration: number,
  mediaId?: string,
): Clip {
  return {
    id: newId(),
    track,
    kind,
    mediaId,
    start,
    duration,
    in: 0,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    fit: 'contain',
    transform: neutralTransform(),
    color: neutralColor(),
    filter: 'none',
    transitionIn: null,
    animIn: 'none',
    animOut: 'none',
    keys: {},
  }
}

export const clipEnd = (c: Clip): number => c.start + c.duration
export const mainTrack = (p: Project): Track | undefined => p.tracks.find((t) => t.kind === 'video')
export const isMain = (p: Project, trackId: string): boolean => mainTrack(p)?.id === trackId
export const clipsOn = (p: Project, trackId: string): Clip[] =>
  p.clips.filter((c) => c.track === trackId).sort((a, b) => a.start - b.start)
export const projectDuration = (p: Project): number => p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)

/** Where in its source a clip is at timeline time `t`. */
export const sourceTime = (c: Clip, t: number): number => c.in + (t - c.start) * c.speed

/** The longest a clip can be: what is left of its source at its speed (stills and titles: an hour). */
export function maxDuration(c: Clip, media?: MediaRef): number {
  if (c.kind === 'image' || c.kind === 'text' || !media || media.duration <= 0) return MAX_STILL
  return Math.max(MIN_CLIP, (media.duration - c.in) / c.speed)
}

/** The main track's clips back to back from 0, in their current order. Every edit ends with this. */
export function pack(p: Project): Project {
  const main = mainTrack(p)
  if (!main) return p
  let t = 0
  const moved = new Map<string, number>()
  for (const c of clipsOn(p, main.id)) {
    moved.set(c.id, t)
    t += c.duration
  }
  return {
    ...p,
    clips: p.clips.map((c) => (moved.has(c.id) ? { ...c, start: moved.get(c.id) as number } : c)),
  }
}

const replace = (p: Project, id: string, f: (c: Clip) => Clip): Project => ({
  ...p,
  clips: p.clips.map((c) => (c.id === id ? f(c) : c)),
})

export function updateClip(p: Project, id: string, patch: Partial<Clip>): Project {
  return pack(replace(p, id, (c) => ({ ...c, ...patch })))
}

/** Cut a clip in two at timeline time `t`. Keyframes after the cut move to the second half. */
export function split(p: Project, id: string, t: number): Project {
  const c = p.clips.find((x) => x.id === id)
  if (!c || t <= c.start + MIN_CLIP || t >= clipEnd(c) - MIN_CLIP) return p
  const firstLen = t - c.start
  const keysFirst: Clip['keys'] = {}
  const keysSecond: Clip['keys'] = {}
  for (const [prop, list] of Object.entries(c.keys) as [KeyProp, Keyframe[]][]) {
    keysFirst[prop] = list.filter((k) => k.t <= firstLen)
    keysSecond[prop] = list.filter((k) => k.t > firstLen).map((k) => ({ ...k, t: k.t - firstLen }))
  }
  const first: Clip = { ...c, duration: firstLen, fadeOut: 0, animOut: 'none', keys: keysFirst }
  const second: Clip = {
    ...c,
    id: newId(),
    start: t,
    duration: clipEnd(c) - t,
    in: c.kind === 'video' || c.kind === 'audio' ? sourceTime(c, t) : c.in,
    fadeIn: 0,
    animIn: 'none',
    transitionIn: null,
    keys: keysSecond,
  }
  return pack({ ...p, clips: p.clips.flatMap((x) => (x.id === id ? [first, second] : [x])) })
}

export function removeClip(p: Project, id: string): Project {
  return pack({ ...p, clips: p.clips.filter((c) => c.id !== id) })
}

/** Move the start edge (trim the head) to timeline time `t`, keeping the end where it is. */
export function trimStart(p: Project, id: string, t: number): Project {
  const c = p.clips.find((x) => x.id === id)
  if (!c) return p
  const hasSource = c.kind === 'video' || c.kind === 'audio'
  const earliest = hasSource ? c.start - c.in / c.speed : clipEnd(c) - MAX_STILL
  const start = Math.min(clipEnd(c) - MIN_CLIP, Math.max(earliest, isMain(p, c.track) ? -Infinity : 0, t))
  const delta = start - c.start
  const next: Clip = {
    ...c,
    start,
    duration: clipEnd(c) - start,
    in: hasSource ? Math.max(0, c.in + delta * c.speed) : c.in,
  }
  return pack(replace(p, id, () => next))
}

/** Move the end edge to timeline time `t`, within what the source allows. */
export function trimEnd(p: Project, id: string, t: number): Project {
  const c = p.clips.find((x) => x.id === id)
  if (!c) return p
  const limit = maxDuration(c, c.mediaId ? p.media[c.mediaId] : undefined)
  const duration = Math.min(limit, Math.max(MIN_CLIP, t - c.start))
  return pack(replace(p, id, (x) => ({ ...x, duration })))
}

/** Change speed; the clip shows the same part of its source, so its length changes. */
export function setSpeed(p: Project, id: string, speed: number): Project {
  const c = p.clips.find((x) => x.id === id)
  if (!c) return p
  const s = Math.min(4, Math.max(0.25, speed))
  const sourceLen = c.duration * c.speed
  return pack(replace(p, id, (x) => ({ ...x, speed: s, duration: Math.max(MIN_CLIP, sourceLen / s) })))
}

/**
 * Move a clip to `start` on `trackId`. On the main track it is inserted before the first clip whose middle is
 * after `start`; elsewhere it keeps its length and slides to the nearest free gap.
 */
export function moveClip(p: Project, id: string, start: number, trackId: string): Project {
  const c = p.clips.find((x) => x.id === id)
  const track = p.tracks.find((t) => t.id === trackId)
  if (!c || !track || !accepts(track.kind, c.kind)) return p
  const others = p.clips.filter((x) => x.id !== id)
  if (isMain(p, trackId)) {
    const main = clipsOn({ ...p, clips: others }, trackId)
    const index = main.findIndex((x) => x.start + x.duration / 2 > start)
    const order = [...main]
    order.splice(index < 0 ? order.length : index, 0, { ...c, track: trackId })
    let t = 0
    const placed = order.map((x) => {
      const y = { ...x, start: t }
      t += x.duration
      return y
    })
    const rest = others.filter((x) => x.track !== trackId)
    return pack({ ...p, clips: [...rest, ...placed] })
  }
  const busy = others.filter((x) => x.track === trackId).sort((a, b) => a.start - b.start)
  const free = freeStart(busy, Math.max(0, start), c.duration)
  return pack({ ...p, clips: [...others, { ...c, track: trackId, start: free }] })
}

/** The start nearest to `want` where `length` fits between the clips in `busy` (sorted). */
export function freeStart(busy: Clip[], want: number, length: number): number {
  const gaps: [number, number][] = []
  let t = 0
  for (const b of busy) {
    if (b.start - t >= length - 1e-9) gaps.push([t, b.start - length])
    t = Math.max(t, clipEnd(b))
  }
  gaps.push([t, Infinity])
  let best = t
  let bestDist = Infinity
  for (const [lo, hi] of gaps) {
    const s = Math.min(hi, Math.max(lo, want))
    const d = Math.abs(s - want)
    if (d < bestDist) {
      best = s
      bestDist = d
    }
  }
  return best
}

export const accepts = (track: TrackKind, clip: Clip['kind']): boolean =>
  track === 'video'
    ? clip === 'video' || clip === 'image' || clip === 'text'
    : track === 'audio'
      ? clip === 'audio'
      : clip === 'text'

/** Add a clip from the media bin: on the main track at the end, or at `at` on another track. */
export function addMedia(
  p: Project,
  media: MediaRef,
  at?: { track: string; start: number },
): { project: Project; clip: Clip } {
  const withMedia = { ...p, media: { ...p.media, [media.id]: media } }
  const kind: Clip['kind'] = media.kind === 'audio' ? 'audio' : media.kind === 'image' ? 'image' : 'video'
  const duration = media.kind === 'image' ? IMAGE_DEFAULT : Math.max(MIN_CLIP, media.duration)
  let track = at?.track
  if (!track || !accepts(p.tracks.find((t) => t.id === track)?.kind ?? 'audio', kind)) {
    track =
      kind === 'audio'
        ? (p.tracks.find((t) => t.kind === 'audio')?.id ?? 'audio1')
        : (mainTrack(p)?.id ?? 'main')
  }
  const clip = makeClip(kind, track, 0, duration, media.id)
  if (!withMedia.tracks.some((t) => t.id === track))
    withMedia.tracks = [
      ...withMedia.tracks,
      { id: track, kind: kind === 'audio' ? 'audio' : 'video', muted: false, hidden: false },
    ]
  const start = isMain(withMedia, track) ? Infinity : (at?.start ?? 0)
  const placed = moveClip({ ...withMedia, clips: [...withMedia.clips, clip] }, clip.id, start, track)
  return { project: placed, clip: placed.clips.find((c) => c.id === clip.id) as Clip }
}

/** Times worth snapping to: 0, the playhead, and every clip edge (except the clip being moved). */
export function snapTimes(p: Project, playhead: number, except?: string): number[] {
  const times = new Set<number>([0, playhead])
  for (const c of p.clips) {
    if (c.id === except) continue
    times.add(c.start)
    times.add(clipEnd(c))
  }
  return [...times]
}

export function snap(t: number, times: number[], within: number): number {
  let best = t
  let dist = within
  for (const s of times) {
    const d = Math.abs(s - t)
    if (d < dist) {
      best = s
      dist = d
    }
  }
  return best
}

// ------------------------------------------------------------------------------------------ keyframes
const smooth = (u: number) => u * u * (3 - 2 * u)

/** A property's value at `t` seconds into the clip: its keyframes if it has any, else the static value. */
export function valueAt(c: Clip, prop: KeyProp, t: number): number {
  const keys = c.keys[prop]
  const base = c.transform[prop]
  if (!keys || keys.length === 0) return base
  const sorted = [...keys].sort((a, b) => a.t - b.t)
  const first = sorted[0] as Keyframe
  const last = sorted[sorted.length - 1] as Keyframe
  if (t <= first.t) return first.v
  if (t >= last.t) return last.v
  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i] as Keyframe
    if (t <= b.t) {
      const a = sorted[i - 1] as Keyframe
      const u = (t - a.t) / Math.max(b.t - a.t, 1e-9)
      return a.v + (b.v - a.v) * (b.ease === 'ease' ? smooth(u) : u)
    }
  }
  return last.v
}

export function setKeyframe(p: Project, id: string, prop: KeyProp, t: number, v: number): Project {
  return replace(p, id, (c) => {
    const list = (c.keys[prop] ?? []).filter((k) => Math.abs(k.t - t) > 1e-3)
    return {
      ...c,
      keys: { ...c.keys, [prop]: [...list, { t, v, ease: 'ease' as Ease }].sort((a, b) => a.t - b.t) },
    }
  })
}

export function removeKeyframe(p: Project, id: string, prop: KeyProp, t: number): Project {
  return replace(p, id, (c) => ({
    ...c,
    keys: { ...c.keys, [prop]: (c.keys[prop] ?? []).filter((k) => Math.abs(k.t - t) > 1e-3) },
  }))
}

// ------------------------------------------------------------------------------------------ what shows at t
export interface Visible {
  clip: Clip
  local: number // seconds into the clip (may run past its ends inside a transition)
  /** 0..1 while a transition into this clip runs; null otherwise. */
  transition: { kind: TransitionKind; progress: number; incoming: boolean } | null
}

/**
 * Everything on screen at time `t`, bottom track first. A transition into clip B (main track) runs over
 * [B.start - d/2, B.start + d/2]: the outgoing clip keeps playing past its end and B starts early.
 */
export function visibleAt(p: Project, t: number): Visible[] {
  const out: Visible[] = []
  const tracks = p.tracks.filter((tr) => tr.kind !== 'audio' && !tr.hidden)
  for (const track of tracks) {
    const clips = clipsOn(p, track.id)
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i] as Clip
      if (c.kind === 'audio') continue
      const next = clips[i + 1]
      const tIn = c.transitionIn && i > 0 ? c.transitionIn : null
      const tOut = next?.transitionIn && isMain(p, track.id) ? next.transitionIn : null
      const from = c.start - (tIn ? tIn.duration / 2 : 0)
      const to = clipEnd(c) + (tOut ? tOut.duration / 2 : 0)
      if (t < from || t >= to) continue
      let transition: Visible['transition'] = null
      if (tIn && t < c.start + tIn.duration / 2)
        transition = { kind: tIn.kind, progress: (t - from) / tIn.duration, incoming: true }
      else if (tOut && next && t >= next.start - tOut.duration / 2)
        transition = {
          kind: tOut.kind,
          progress: (t - (next.start - tOut.duration / 2)) / tOut.duration,
          incoming: false,
        }
      out.push({ clip: c, local: t - c.start, transition })
    }
  }
  return out
}

/** Clips with sound at `t` (video and audio), with their effective volume (fades, mute, track mute). */
export function audibleAt(p: Project, t: number): { clip: Clip; local: number; gain: number }[] {
  const out: { clip: Clip; local: number; gain: number }[] = []
  for (const c of p.clips) {
    if ((c.kind !== 'video' && c.kind !== 'audio') || t < c.start || t >= clipEnd(c)) continue
    const media = c.mediaId ? p.media[c.mediaId] : undefined
    const track = p.tracks.find((x) => x.id === c.track)
    if (!media?.hasAudio || c.volume <= 0 || track?.muted) continue
    out.push({ clip: c, local: t - c.start, gain: gainAt(c, t - c.start) })
  }
  return out
}

export function gainAt(c: Clip, local: number): number {
  let g = c.volume
  if (c.fadeIn > 0 && local < c.fadeIn) g *= local / c.fadeIn
  const left = c.duration - local
  if (c.fadeOut > 0 && left < c.fadeOut) g *= Math.max(0, left / c.fadeOut)
  return g
}
