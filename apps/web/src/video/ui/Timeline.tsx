import { useRef } from 'react'
import { useT } from '../../i18n'
import { Icon } from '../../components/Icon'
import {
  addMedia,
  isMain,
  moveClip,
  newId,
  projectDuration,
  snap,
  snapTimes,
  split,
  trimEnd,
  trimStart,
  type Clip,
  type MediaRef,
  type Project,
  type Track,
  type TrackKind,
} from '../model'
import type { Player } from '../player'
import { committedProject, useProject, useVideo } from '../store'
import { ClipPicture } from './ClipPicture'
import { formatTime } from './Workspace'

const HEADER = 120 // track header width, px
const SNAP_PX = 8

type Gesture =
  | { kind: 'move'; id: string; grab: number; startX: number; startY: number }
  | { kind: 'trim-start' | 'trim-end'; id: string }
  | { kind: 'scrub' }

/** Display order: overlay tracks above the main track, sound tracks at the bottom. */
function ordered(p: Project): Track[] {
  const visual = p.tracks.filter((t) => t.kind !== 'audio')
  return [...visual.reverse(), ...p.tracks.filter((t) => t.kind === 'audio')]
}

function tickStep(zoom: number): number {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (s * zoom >= 70) return s
  return 600
}

export function Timeline({ player }: { player: React.MutableRefObject<Player | null> }) {
  const t = useT()
  const project = useProject()
  const { playhead, zoom, selected } = useVideo()
  const lanes = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const duration = projectDuration(project)
  const width = Math.max(duration + 10, 30) * zoom
  const step = tickStep(zoom)

  const timeAt = (clientX: number) => {
    const rect = lanes.current?.getBoundingClientRect()
    return Math.max(0, (clientX - (rect?.left ?? 0)) / zoom)
  }
  const trackAt = (clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY)?.closest('[data-track]')
    return el?.getAttribute('data-track') ?? null
  }
  const stopPlayback = () => {
    if (useVideo.getState().playing) {
      player.current?.stop()
      useVideo.getState().set({ playing: false })
    }
  }

  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const base = committedProject()
    const times = snapTimes(base, useVideo.getState().playhead, g.kind === 'scrub' ? undefined : g.id)
    const at = (x: number) => snap(x, times, SNAP_PX / zoom)
    if (g.kind === 'scrub') {
      useVideo.getState().set({ playhead: Math.min(projectDuration(base), timeAt(e.clientX)) })
      return
    }
    const c = base.clips.find((x) => x.id === g.id)
    if (!c) return
    if (g.kind === 'move') {
      if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 4) return
      let start = timeAt(e.clientX) - g.grab
      const snappedStart = at(start)
      const snappedEnd = at(start + c.duration) - c.duration
      start = Math.abs(snappedStart - start) <= Math.abs(snappedEnd - start) ? snappedStart : snappedEnd
      const track = trackAt(e.clientX, e.clientY) ?? c.track
      useVideo.getState().preview(moveClip(base, c.id, start, track))
    } else if (g.kind === 'trim-start')
      useVideo.getState().preview(trimStart(base, c.id, at(timeAt(e.clientX))))
    else useVideo.getState().preview(trimEnd(base, c.id, at(timeAt(e.clientX))))
  }
  const onUp = () => {
    const g = gesture.current
    gesture.current = null
    const live = useVideo.getState().live
    if (!g || g.kind === 'scrub' || !live) {
      useVideo.getState().preview(null)
      return
    }
    useVideo.getState().commit(g.kind === 'move' ? 'Move clip' : 'Trim clip', live)
  }

  const addTrack = (kind: TrackKind) =>
    useVideo.getState().commit('Add track', {
      ...committedProject(),
      tracks: [...committedProject().tracks, { id: newId(), kind, muted: false, hidden: false }],
    })
  const patchTrack = (id: string, patch: Partial<Track>) =>
    useVideo.getState().commit('Track', {
      ...committedProject(),
      tracks: committedProject().tracks.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })

  const clipLabel = (c: Clip) =>
    c.kind === 'text'
      ? (c.text?.text ?? t('Title'))
      : (project.media[c.mediaId ?? '']?.name ?? t('Missing file'))

  return (
    <section className="v-timeline glass" aria-label={t('Timeline')}>
      <div className="v-tl-bar">
        <button
          type="button"
          className="button"
          disabled={!selected}
          onClick={() =>
            selected && useVideo.getState().commit('Split', split(committedProject(), selected, playhead))
          }
          title={t('Split at the playhead (S)')}
        >
          <Icon name="scissors" size={15} /> {t('Split')}
        </button>
        <button type="button" className="button" onClick={() => addTrack('video')}>
          <Icon name="plus" size={14} /> {t('Video track')}
        </button>
        <button type="button" className="button" onClick={() => addTrack('text')}>
          <Icon name="plus" size={14} /> {t('Text track')}
        </button>
        <button type="button" className="button" onClick={() => addTrack('audio')}>
          <Icon name="plus" size={14} /> {t('Audio track')}
        </button>
        <span className="topbar-spacer" />
        <label className="v-zoom" title={t('Zoom the timeline')}>
          <Icon name="minus" size={13} />
          <input
            type="range"
            min={10}
            max={400}
            value={zoom}
            aria-label={t('Zoom the timeline')}
            onChange={(e) => useVideo.getState().set({ zoom: Number(e.target.value) })}
          />
          <Icon name="plus" size={13} />
        </label>
      </div>
      {/* time always runs left to right, also in the Arabic interface */}
      <div
        className="v-tl-scroll"
        dir="ltr"
        onWheel={(e) => {
          if (!e.ctrlKey) return
          e.preventDefault()
          useVideo
            .getState()
            .set({ zoom: Math.min(400, Math.max(10, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) })
        }}
        onDragOver={(e) => e.dataTransfer.types.includes('application/x-pixels-media') && e.preventDefault()}
        onDrop={(e) => {
          const id = e.dataTransfer.getData('application/x-pixels-media')
          const media = committedProject().media[id]
          if (!media) return
          e.preventDefault()
          e.stopPropagation()
          const track = trackAt(e.clientX, e.clientY) ?? undefined
          const { project: next, clip } = addMedia(
            committedProject(),
            media,
            track ? { track, start: timeAt(e.clientX) } : undefined,
          )
          useVideo.getState().commit(`Add ${media.name}`, next)
          useVideo.getState().set({ selected: clip.id })
        }}
      >
        <div className="v-tl-grid" style={{ width: width + HEADER }}>
          <div className="v-tl-corner" />
          <div
            className="v-ruler"
            ref={lanes}
            style={{ width }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              stopPlayback()
              gesture.current = { kind: 'scrub' }
              useVideo.getState().set({ playhead: Math.min(duration, timeAt(e.clientX)) })
            }}
            onPointerMove={onMove}
            onPointerUp={onUp}
          >
            {Array.from({ length: Math.ceil(width / zoom / step) + 1 }, (_, i) => (
              <span key={i} className="v-tick" style={{ left: i * step * zoom }}>
                {formatTime(i * step).replace(/\.\d+$/, '')}
              </span>
            ))}
          </div>
          {ordered(project).map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              main={isMain(project, track.id)}
              clips={project.clips.filter((c) => c.track === track.id)}
              zoom={zoom}
              width={width}
              selected={selected}
              label={clipLabel}
              media={(c) => (c.mediaId ? project.media[c.mediaId] : undefined)}
              onPatch={(patch) => patchTrack(track.id, patch)}
              onGesture={(e, g) => {
                e.stopPropagation()
                e.currentTarget.setPointerCapture(e.pointerId)
                stopPlayback()
                gesture.current = g
                if (g.kind !== 'scrub') useVideo.getState().set({ selected: g.id })
              }}
              onMove={onMove}
              onUp={onUp}
              timeAt={timeAt}
            />
          ))}
          <div className="v-playhead" style={{ left: HEADER + playhead * zoom }} />
        </div>
      </div>
    </section>
  )
}

function TrackRow(props: {
  track: Track
  main: boolean
  clips: Clip[]
  zoom: number
  width: number
  selected: string | null
  label: (c: Clip) => string
  media: (c: Clip) => MediaRef | undefined
  onPatch: (patch: Partial<Track>) => void
  onGesture: (e: React.PointerEvent<HTMLElement>, g: Gesture) => void
  onMove: (e: React.PointerEvent) => void
  onUp: () => void
  timeAt: (clientX: number) => number
}) {
  const t = useT()
  const { track, zoom } = props
  const name = props.main
    ? t('Main')
    : track.kind === 'audio'
      ? t('Sound')
      : track.kind === 'text'
        ? t('Text')
        : t('Overlay')
  return (
    <>
      <div className="v-track-head" data-kind={track.kind}>
        <span>{name}</span>
        {track.kind === 'audio' ? (
          <button
            type="button"
            className="icon-button"
            aria-pressed={track.muted}
            aria-label={track.muted ? t('Unmute track') : t('Mute track')}
            onClick={() => props.onPatch({ muted: !track.muted })}
          >
            <Icon name={track.muted ? 'mute' : 'volume'} size={14} />
          </button>
        ) : (
          <button
            type="button"
            className="icon-button"
            aria-pressed={track.hidden}
            aria-label={track.hidden ? t('Show track') : t('Hide track')}
            onClick={() => props.onPatch({ hidden: !track.hidden })}
          >
            <Icon name={track.hidden ? 'eyeOff' : 'eye'} size={14} />
          </button>
        )}
      </div>
      <div className="v-lane" data-track={track.id} data-kind={track.kind} style={{ width: props.width }}>
        {props.clips.map((c) => (
          <div
            key={c.id}
            className="v-clip"
            data-kind={c.kind}
            data-selected={c.id === props.selected}
            style={{ left: c.start * zoom, width: Math.max(4, c.duration * zoom) }}
            onPointerDown={(e) =>
              props.onGesture(e, {
                kind: 'move',
                id: c.id,
                grab: props.timeAt(e.clientX) - c.start,
                startX: e.clientX,
                startY: e.clientY,
              })
            }
            onPointerMove={props.onMove}
            onPointerUp={props.onUp}
            title={`${props.label(c)} · ${formatTime(c.duration)}`}
          >
            {props.media(c) && (c.kind === 'video' || c.kind === 'audio') && (
              <ClipPicture
                clip={c}
                media={props.media(c)!}
                width={Math.max(4, c.duration * zoom)}
                height={40}
              />
            )}
            {c.transitionIn && <span className="v-clip-transition" title={t('Transition')} />}
            <span className="v-clip-name" dir="auto">
              {props.label(c)}
            </span>
            {c.speed !== 1 && <span className="v-clip-badge">{`${c.speed}x`}</span>}
            <span
              className="v-trim v-trim-start"
              onPointerDown={(e) => props.onGesture(e, { kind: 'trim-start', id: c.id })}
            />
            <span
              className="v-trim v-trim-end"
              onPointerDown={(e) => props.onGesture(e, { kind: 'trim-end', id: c.id })}
            />
          </div>
        ))}
        {props.clips.length === 0 && <span className="v-lane-empty">{clipEndHint(track.kind, t)}</span>}
      </div>
    </>
  )
}

const clipEndHint = (kind: TrackKind, t: (s: string) => string) =>
  kind === 'audio'
    ? t('Drop music or a voice-over here')
    : kind === 'text'
      ? t('Titles go here')
      : t('Drop clips here')
