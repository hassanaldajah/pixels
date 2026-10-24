import { create } from 'zustand'
import { RejectionError, uploadImage, uploadMedia } from '../api/client'
import type { Rejection } from '../api/types'
import { useJobs } from '../state/jobs'
import { saveRecent } from '../lib/recent'
import { addMedia, emptyProject, newId, projectDuration, type MediaRef, type Project } from './model'

/** Video and audio files the media gate accepts (the server checks the real bytes again). */
export const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.qt', '.webm', '.mkv', '.3gp']
export const AUDIO_EXTENSIONS = ['.m4a', '.mp3', '.wav', '.wave']
export const STILL_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.heic',
  '.heif',
  '.avif',
  '.bmp',
  '.tif',
  '.tiff',
]
export const VIDEO_ACCEPT = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...STILL_EXTENSIONS].join(',')

const SAVE_KEY = 'pixels.video.project'
const MAX_HISTORY = 200

function loadSaved(): Project {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as Project | null
    if (saved && saved.version === 1 && Array.isArray(saved.clips))
      return saved.id ? saved : { ...saved, id: newId() }
  } catch {
    /* unreadable: start fresh */
  }
  return emptyProject()
}

let saveTimer = 0
function autosave(p: Project): void {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(p))
    } catch {
      /* storage full or blocked: the project still lives in this tab */
    }
    if (p.id && p.clips.length > 0)
      void saveRecent({
        key: `video:${p.id}`,
        kind: 'video',
        name: p.name,
        project: p,
        duration: projectDuration(p),
        updatedAt: Date.now(),
      })
  }, 400)
}

export interface HistoryEntry {
  label: string
  project: Project
}

interface VideoStore {
  history: HistoryEntry[]
  index: number
  /** A change being dragged (no history entry yet); shown instead of the committed project. */
  live: Project | null
  playhead: number
  playing: boolean
  selected: string | null
  zoom: number // timeline pixels per second
  exportOpen: boolean
  importing: number
  rejections: Rejection[]
  commit: (label: string, project: Project) => void
  preview: (project: Project | null) => void
  undo: () => void
  redo: () => void
  set: (patch: Partial<Pick<VideoStore, 'playhead' | 'playing' | 'selected' | 'zoom' | 'exportOpen'>>) => void
  dismissRejection: (index: number) => void
  importFiles: (files: File[]) => Promise<void>
  /** Start a new project, or open one (from the recent list); the current one stays in the recent list. */
  open: (project: Project, label?: string) => void
}

const start = loadSaved()
let lastLabel = ''
let lastAt = 0

export const useVideo = create<VideoStore>((set, get) => ({
  history: [{ label: 'Open', project: start }],
  index: 0,
  live: null,
  playhead: 0,
  playing: false,
  selected: null,
  zoom: 80,
  exportOpen: false,
  importing: 0,
  rejections: [],

  commit: (label, project) => {
    const { history, index } = get()
    const current = history[index]?.project
    if (current && JSON.stringify(current) === JSON.stringify(project)) {
      set({ live: null })
      return
    }
    // the same kind of change in quick succession (a colour being picked) is one step, not dozens
    const now = Date.now()
    const merge = label === lastLabel && now - lastAt < 800 && index > 0
    lastLabel = label
    lastAt = now
    const kept = history.slice(0, merge ? index : index + 1)
    const next = [...kept, { label, project }].slice(-MAX_HISTORY)
    set({ history: next, index: next.length - 1, live: null })
    autosave(project)
  },
  preview: (live) => set({ live }),
  undo: () => {
    const { index, history } = get()
    if (index > 0) {
      set({ index: index - 1, live: null })
      autosave((history[index - 1] as HistoryEntry).project)
    }
  },
  redo: () => {
    const { index, history } = get()
    if (index < history.length - 1) {
      set({ index: index + 1, live: null })
      autosave((history[index + 1] as HistoryEntry).project)
    }
  },
  set: (patch) => set(patch),
  open: (project, label = 'Open') => {
    set({ history: [{ label, project }], index: 0, live: null, selected: null, playhead: 0, playing: false })
    autosave(project)
  },
  dismissRejection: (i) => set((s) => ({ rejections: s.rejections.filter((_, j) => j !== i) })),

  importFiles: async (files) => {
    for (const file of files) {
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
      const still = STILL_EXTENSIONS.includes(ext)
      if (!still && !VIDEO_EXTENSIONS.includes(ext) && !AUDIO_EXTENSIONS.includes(ext)) {
        set((s) => ({
          rejections: [
            ...s.rejections,
            {
              code: 'precheck',
              step: 'size',
              message: `“${file.name}”: ${ext || 'this'} files are not accepted.`,
              steps: [],
            },
          ],
        }))
        continue
      }
      const jobId = crypto.randomUUID().replaceAll('-', '')
      const jobs = useJobs.getState()
      jobs.upsert({ id: jobId, name: file.name, status: 'uploading', progress: 0, label: 'Uploading' })
      set((s) => ({ importing: s.importing + 1 }))
      try {
        const onUploadProgress = (f: number) =>
          useJobs.getState().upsert({ id: jobId, status: 'uploading', label: 'Uploading', progress: f * 0.5 })
        let media: MediaRef
        if (still) {
          const r = await uploadImage(file, { jobId, onUploadProgress })
          media = {
            id: r.id,
            kind: 'image',
            url: r.url,
            name: r.name,
            duration: 0,
            width: r.width,
            height: r.height,
            hasVideo: true,
            hasAudio: false,
          }
        } else {
          const r = await uploadMedia(file, { jobId, onUploadProgress })
          const hasVideo = r.video_codecs.length > 0
          media = {
            id: r.id,
            kind: hasVideo ? 'video' : 'audio',
            url: r.url,
            name: r.name,
            duration: r.duration,
            width: r.width,
            height: r.height,
            hasVideo,
            hasAudio: r.audio_codecs.length > 0,
          }
        }
        const current = get().history[get().index]?.project ?? emptyProject()
        const { project, clip } = addMedia(current, media)
        get().commit(`Add ${media.name}`, project)
        set({ selected: clip.id })
      } catch (error) {
        const rejection =
          error instanceof RejectionError
            ? error.rejection
            : {
                code: 'load_failed',
                step: 'size',
                steps: [],
                message: error instanceof Error ? error.message : 'The file could not be opened.',
              }
        useJobs.getState().upsert({ id: jobId, status: 'failed', progress: 1, error: rejection.message })
        set((s) => ({
          rejections: [...s.rejections, { ...rejection, message: `${file.name}: ${rejection.message}` }],
        }))
      } finally {
        set((s) => ({ importing: s.importing - 1 }))
      }
    }
  },
}))

/** The project on screen: the change being dragged, or the current history entry. */
export const currentProject = (): Project => {
  const s = useVideo.getState()
  return s.live ?? (s.history[s.index] as HistoryEntry).project
}
export const committedProject = (): Project => {
  const s = useVideo.getState()
  return (s.history[s.index] as HistoryEntry).project
}
export function useProject(): Project {
  return useVideo((s) => s.live ?? (s.history[s.index] as HistoryEntry).project)
}
