import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { Icon } from '../../components/Icon'
import { takesText } from '../../lib/shortcuts'
import { outputColors } from '../../tokens'
import {
  addMedia,
  ASPECTS,
  clipEnd,
  makeClip,
  newId,
  projectDuration,
  removeClip,
  split,
  type Aspect,
  type Project,
} from '../model'
import { Player } from '../player'
import { committedProject, currentProject, useProject, useVideo, VIDEO_ACCEPT } from '../store'
import { ExportDialog } from './ExportDialog'
import { RecentPanel } from '../../components/RecentPanel'
import { useFirstTour } from '../../components/Tour'
import { Inspector } from './Inspector'
import { PLATFORMS, SafeZones, type Platform } from './SafeZones'
import { SupportNotice } from './SupportNotice'
import { Timeline } from './Timeline'
import '../../styles/video.css'

const readPref = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const writePref = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* a preference only */
  }
}

export const formatTime = (t: number, fps = 30): string => {
  const total = Math.max(0, t)
  const m = Math.floor(total / 60)
  const s = Math.floor(total % 60)
  const f = Math.floor((total % 1) * fps)
  return `${m}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`
}

/** Add a title clip at the playhead, on the first text track (made if there is none). */
export function addTitle(text: string): void {
  let p = committedProject()
  let track = p.tracks.find((t) => t.kind === 'text')
  if (!track) {
    track = { id: newId(), kind: 'text', muted: false, hidden: false }
    p = { ...p, tracks: [...p.tracks, track] }
  }
  const clip = {
    ...makeClip('text', track.id, useVideo.getState().playhead, 4),
    text: {
      text,
      font: 'arabic' as const,
      size: Math.round(p.height / 12),
      color: outputColors.white,
      bold: true,
      italic: false,
      align: 'center' as const,
      shadow: { blur: 16, distance: 4, color: `${outputColors.black}99` },
    },
    animIn: 'rise' as const,
    animOut: 'fade' as const,
  }
  const busy = p.clips.filter((c) => c.track === track.id)
  const free = busy.every((c) => clipEnd(c) <= clip.start || c.start >= clip.start + clip.duration)
  if (!free) clip.start = Math.max(clip.start, ...busy.map(clipEnd))
  useVideo.getState().commit('Add title', { ...p, clips: [...p.clips, clip] })
  useVideo.getState().set({ selected: clip.id })
}

function MediaBin() {
  const t = useT()
  const project = useProject()
  const importing = useVideo((s) => s.importing)
  const input = useRef<HTMLInputElement>(null)
  const media = Object.values(project.media)
  return (
    <aside className="v-bin glass" aria-label={t('Media')}>
      <div className="panel-head">
        <span>{t('Media')}</span>
      </div>
      <div className="v-bin-actions">
        <button type="button" className="button button-primary" onClick={() => input.current?.click()}>
          <Icon name="upload" size={15} /> {importing ? t('Checking…') : t('Import')}
        </button>
        <button type="button" className="button" onClick={() => addTitle(t('Your title'))}>
          <Icon name="text" size={15} /> {t('Title')}
        </button>
        <input
          ref={input}
          type="file"
          accept={VIDEO_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            void useVideo.getState().importFiles([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
      </div>
      <p className="hint">
        {t('Video, music, voice and pictures. Every file is checked before it is used.')}
      </p>
      <ul className="v-bin-list">
        {media.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              className="v-bin-item"
              draggable
              onDragStart={(e) => e.dataTransfer.setData('application/x-pixels-media', m.id)}
              onClick={() => {
                const { project: next, clip } = addMedia(committedProject(), m)
                useVideo.getState().commit(`Add ${m.name}`, next)
                useVideo.getState().set({ selected: clip.id })
              }}
              title={t('Add to the timeline')}
            >
              <Icon name={m.kind === 'audio' ? 'music' : m.kind === 'image' ? 'image' : 'film'} size={16} />
              <span className="v-bin-name" dir="auto">
                {m.name}
              </span>
              {m.duration > 0 && <span className="v-bin-dur">{formatTime(m.duration)}</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="v-bin-recent">
        <RecentPanel kind="video" limit={4} />
      </div>
    </aside>
  )
}

function Preview({ player }: { player: React.MutableRefObject<Player | null> }) {
  const t = useT()
  const project = useProject()
  const playhead = useVideo((s) => s.playhead)
  const playing = useVideo((s) => s.playing)
  const canvas = useRef<HTMLCanvasElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 640, h: 360, cssW: 320, cssH: 180 })
  const duration = projectDuration(project)
  const [phone, setPhone] = useState(() => readPref('pixels.video.phone') === '1')
  const [zones, setZones] = useState<Platform | 'none'>(
    () => (readPref('pixels.video.zones') as Platform) || 'none',
  )

  // the canvas matches the space available (capped at 2x pixel density), in the project's shape
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const k = Math.min((el.clientWidth - 20) / project.width, (el.clientHeight - 20) / project.height) // minus the padding
      const cssW = Math.max(2, Math.floor(project.width * k))
      const cssH = Math.max(2, Math.floor(project.height * k))
      setSize({ w: Math.round(cssW * dpr), h: Math.round(cssH * dpr), cssW, cssH })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [project.width, project.height])

  useEffect(() => {
    if (!canvas.current) return
    const p = new Player(canvas.current)
    p.onTime = (time) => useVideo.getState().set({ playhead: time })
    p.onEnd = () => useVideo.getState().set({ playing: false })
    player.current = p
    return () => {
      p.dispose()
      player.current = null
    }
  }, [player])

  useEffect(() => {
    if (!playing) void player.current?.show(project, playhead)
  }, [project, playhead, playing, size, player])

  const toggle = () => {
    const p = player.current
    if (!p) return
    if (useVideo.getState().playing) {
      p.stop()
      useVideo.getState().set({ playing: false })
    } else {
      p.play(currentProject(), useVideo.getState().playhead)
      useVideo.getState().set({ playing: true })
    }
  }
  useEffect(() => {
    const onToggle = () => toggle()
    window.addEventListener('pixels-video-toggle', onToggle)
    return () => window.removeEventListener('pixels-video-toggle', onToggle)
  })

  const aspect = (Object.entries(ASPECTS).find(
    ([, [w, h]]) => w === project.width && h === project.height,
  )?.[0] ?? 'custom') as Aspect | 'custom'

  return (
    <section className="v-preview glass" aria-label={t('Preview')}>
      <div className="v-preview-head">
        <label className="select-wrap" title={t('Frame shape')}>
          <span className="sr-only">{t('Frame shape')}</span>
          <select
            value={aspect}
            onChange={(e) => {
              const [w, h] = ASPECTS[e.target.value as Aspect]
              useVideo.getState().commit('Frame shape', { ...committedProject(), width: w, height: h })
            }}
          >
            {Object.keys(ASPECTS).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
            {aspect === 'custom' && <option value="custom">{`${project.width}×${project.height}`}</option>}
          </select>
        </label>
        <label className="select-wrap" title={t('Frames per second')}>
          <span className="sr-only">{t('Frames per second')}</span>
          <select
            value={project.fps}
            onChange={(e) =>
              useVideo.getState().commit('Frame rate', { ...committedProject(), fps: Number(e.target.value) })
            }
          >
            {[24, 25, 30, 50, 60].map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button"
          aria-pressed={phone}
          data-active={phone}
          onClick={() => {
            setPhone(!phone)
            writePref('pixels.video.phone', phone ? '0' : '1')
          }}
          title={t('See the video inside a phone, as viewers will')}
        >
          <Icon name="phone" size={15} /> {t('Phone')}
        </button>
        <label className="select-wrap" title={t("Where the app's buttons and captions cover the video")}>
          <span className="sr-only">{t('Safe zones')}</span>
          <select
            value={zones}
            onChange={(e) => {
              setZones(e.target.value as Platform | 'none')
              writePref('pixels.video.zones', e.target.value === 'none' ? '' : e.target.value)
            }}
          >
            <option value="none">{t('No safe zones')}</option>
            {(Object.keys(PLATFORMS) as Platform[]).map((k) => (
              <option key={k} value={k}>
                {PLATFORMS[k].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <SupportNotice />
      <div ref={frame} className="v-stage" data-portrait={project.height > project.width}>
        <div className="v-device" data-phone={phone} style={{ width: size.cssW, height: size.cssH }}>
          <canvas
            ref={canvas}
            width={size.w}
            height={size.h}
            className="v-canvas"
            style={{ width: size.cssW, height: size.cssH }}
          />
          {zones !== 'none' && <SafeZones platform={zones} />}
        </div>
        {project.clips.length === 0 && (
          <div className="v-empty">
            <Icon name="film" size={34} />
            <p>{t('Import a video, a song or pictures to start. Drop files anywhere.')}</p>
          </div>
        )}
      </div>
      <div className="v-transport" dir="ltr">
        <button
          type="button"
          className="icon-button"
          aria-label={t('To the start')}
          onClick={() => useVideo.getState().set({ playhead: 0 })}
        >
          <Icon name="skipBack" size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('One frame back')}
          onClick={() => useVideo.getState().set({ playhead: Math.max(0, playhead - 1 / project.fps) })}
        >
          <Icon name="chevronRight" size={16} className="flip-x" />
        </button>
        <button
          type="button"
          className="v-play"
          aria-label={playing ? t('Pause') : t('Play')}
          onClick={toggle}
        >
          <Icon name={playing ? 'pause' : 'play'} size={20} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('One frame forward')}
          onClick={() =>
            useVideo.getState().set({ playhead: Math.min(duration, playhead + 1 / project.fps) })
          }
        >
          <Icon name="chevronRight" size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('To the end')}
          onClick={() => useVideo.getState().set({ playhead: duration })}
        >
          <Icon name="skipForward" size={16} />
        </button>
        <span className="v-time">
          {formatTime(playhead, project.fps)} / {formatTime(duration, project.fps)}
        </span>
      </div>
    </section>
  )
}

/** The video editor: media, preview, inspector and timeline. */
export function VideoWorkspace() {
  const player = useRef<Player | null>(null)
  const exportOpen = useVideo((s) => s.exportOpen)
  useFirstTour('video', true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (takesText(e.target)) return
      const v = useVideo.getState()
      const ctrl = e.ctrlKey || e.metaKey
      const p = committedProject()
      if (e.code === 'Space') {
        e.preventDefault()
        window.dispatchEvent(new Event('pixels-video-toggle'))
      } else if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) v.redo()
        else v.undo()
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        v.redo()
      } else if (!ctrl && (e.key === 's' || e.key === 'S') && v.selected) {
        v.commit('Split', split(p, v.selected, v.playhead))
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && v.selected) {
        e.preventDefault()
        v.commit('Delete clip', removeClip(p, v.selected))
        v.set({ selected: null })
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const step = (e.shiftKey ? 1 : 1 / p.fps) * (e.key === 'ArrowLeft' ? -1 : 1)
        v.set({ playhead: Math.min(projectDuration(p), Math.max(0, v.playhead + step)) })
      } else if (e.key === 'Home') v.set({ playhead: 0 })
      else if (e.key === 'End') v.set({ playhead: projectDuration(p) })
    }
    window.addEventListener('keydown', onKey)
    // files dropped anywhere on the editor are imported
    const over = (e: DragEvent) => e.dataTransfer?.types.includes('Files') && e.preventDefault()
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return
      e.preventDefault()
      void useVideo.getState().importFiles([...e.dataTransfer.files])
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  return (
    <div className="v-workspace">
      <MediaBin />
      <Preview player={player} />
      <Inspector />
      <Timeline player={player} />
      {exportOpen && <ExportDialog onClose={() => useVideo.getState().set({ exportOpen: false })} />}
    </div>
  )
}

export type { Project }
