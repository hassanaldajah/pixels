import { describe, expect, it } from 'vitest'
import {
  addMedia,
  audibleAt,
  clipsOn,
  emptyProject,
  freeStart,
  makeClip,
  moveClip,
  projectDuration,
  removeClip,
  setKeyframe,
  setSpeed,
  snap,
  split,
  trimEnd,
  trimStart,
  valueAt,
  visibleAt,
  type MediaRef,
  type Project,
} from './model'

const video = (id: string, duration: number): MediaRef => ({
  id,
  kind: 'video',
  url: `/api/media/${id}`,
  name: `${id}.mp4`,
  duration,
  width: 1920,
  height: 1080,
  hasVideo: true,
  hasAudio: true,
})

function twoClips(): Project {
  let p = emptyProject()
  p = addMedia(p, video('a', 10)).project
  p = addMedia(p, video('b', 6)).project
  return p
}

describe('the main track is magnetic', () => {
  it('adds clips back to back', () => {
    const p = twoClips()
    expect(clipsOn(p, 'main').map((c) => [c.start, c.duration])).toEqual([
      [0, 10],
      [10, 6],
    ])
    expect(projectDuration(p)).toBe(16)
  })

  it('removing a clip closes the gap', () => {
    const p = twoClips()
    const first = clipsOn(p, 'main')[0]!
    const after = removeClip(p, first.id)
    expect(clipsOn(after, 'main')[0]!.start).toBe(0)
  })

  it('moving a clip reorders the track', () => {
    const p = twoClips()
    const [a, b] = clipsOn(p, 'main')
    const moved = moveClip(p, b!.id, 0, 'main')
    expect(clipsOn(moved, 'main').map((c) => c.id)).toEqual([b!.id, a!.id])
    expect(clipsOn(moved, 'main')[1]!.start).toBe(6)
  })
})

describe('cutting and trimming', () => {
  it('split keeps the source continuous', () => {
    const p = twoClips()
    const a = clipsOn(p, 'main')[0]!
    const cut = split(p, a.id, 4)
    const [x, y] = clipsOn(cut, 'main')
    expect([x!.duration, y!.start, y!.in, y!.duration]).toEqual([4, 4, 4, 6])
    expect(split(p, a.id, 0.05)).toBe(p) // too close to the edge
  })

  it('split at double speed reads twice as far into the source', () => {
    const p = twoClips()
    const a = clipsOn(p, 'main')[0]!
    const fast = setSpeed(p, a.id, 2)
    expect(clipsOn(fast, 'main')[0]!.duration).toBe(5)
    expect(clipsOn(split(fast, a.id, 2), 'main')[1]!.in).toBe(4)
  })

  it('trims stay inside the source', () => {
    const p = twoClips()
    const a = clipsOn(p, 'main')[0]!
    expect(clipsOn(trimEnd(p, a.id, 50), 'main')[0]!.duration).toBe(10)
    const head = trimStart(p, a.id, 3)
    expect([clipsOn(head, 'main')[0]!.in, clipsOn(head, 'main')[0]!.duration]).toEqual([3, 7])
    const back = trimStart(head, a.id, -5)
    expect(clipsOn(back, 'main')[0]!.in).toBe(0)
  })
})

describe('free tracks', () => {
  it('a clip slides to the nearest gap that fits', () => {
    const busy = [makeClip('text', 't', 2, 3), makeClip('text', 't', 8, 2)]
    expect(freeStart(busy, 3, 2)).toBe(5) // the gap after the first clip is nearer than the one before it
    expect(freeStart(busy, 1, 2)).toBe(0)
    expect(freeStart(busy, 6, 2)).toBe(6)
    expect(freeStart(busy, 9, 4)).toBe(10)
  })

  it('snaps to nearby edges', () => {
    expect(snap(4.96, [0, 5, 10], 0.1)).toBe(5)
    expect(snap(4.7, [0, 5, 10], 0.1)).toBe(4.7)
  })
})

describe('keyframes and what is visible', () => {
  it('interpolates between keyframes and holds at the ends', () => {
    let p = twoClips()
    const a = clipsOn(p, 'main')[0]!
    p = setKeyframe(p, a.id, 'scale', 0, 1)
    p = setKeyframe(p, a.id, 'scale', 2, 2)
    const c = p.clips.find((x) => x.id === a.id)!
    expect(valueAt(c, 'scale', -1)).toBe(1)
    expect(valueAt(c, 'scale', 1)).toBe(1.5) // halfway (smoothstep at 0.5 is 0.5)
    expect(valueAt(c, 'scale', 5)).toBe(2)
    expect(valueAt(c, 'opacity', 1)).toBe(1) // no keys: the static value
  })

  it('a transition shows both clips around the cut', () => {
    let p = twoClips()
    const b = clipsOn(p, 'main')[1]!
    p = {
      ...p,
      clips: p.clips.map((c) => (c.id === b.id ? { ...c, transitionIn: { kind: 'fade', duration: 1 } } : c)),
    }
    expect(visibleAt(p, 9).length).toBe(1)
    const both = visibleAt(p, 10)
    expect(both.length).toBe(2)
    expect(both.find((v) => v.clip.id === b.id)!.transition).toEqual({
      kind: 'fade',
      progress: 0.5,
      incoming: true,
    })
  })

  it('fades shape the volume and muted tracks are silent', () => {
    let p = twoClips()
    const a = clipsOn(p, 'main')[0]!
    p = { ...p, clips: p.clips.map((c) => (c.id === a.id ? { ...c, fadeIn: 2, volume: 0.8 } : c)) }
    expect(audibleAt(p, 1)[0]!.gain).toBeCloseTo(0.4)
    p = { ...p, tracks: p.tracks.map((t) => ({ ...t, muted: true })) }
    expect(audibleAt(p, 1)).toEqual([])
  })
})
