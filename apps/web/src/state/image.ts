import { create } from 'zustand'
import { RejectionError, createBatch, uploadImage } from '../api/client'
import { openProject } from '../api/edit'
import type { Rejection, UploadResult } from '../api/types'
import { DEFAULT_MAX_BATCH, DEFAULT_MAX_BYTES, precheck } from '../lib/precheck'
import { loadPixels, type LoadedPixels } from '../lib/imageLoader'
import { useEdit, type Snapshot } from './edit'
import { useJobs } from './jobs'
import { useView } from './view'

export interface OpenImage extends LoadedPixels {
  id: string
  name: string
  width: number
  height: number
  hasAlpha: boolean
  report: UploadResult
}

/** An earlier version of the picture (before a removal), kept so the removal can be undone. */
interface Version {
  image: OpenImage
  history: Snapshot[]
  index: number
}
const MAX_VERSIONS = 5

interface ImageState {
  current: OpenImage | null
  versions: Version[]
  rejections: Rejection[]
  notices: string[]
  importing: boolean
  limits: { maxBytes: number; maxBatch: number }
  setLimits: (maxBytes: number, maxBatch: number) => void
  dismissRejection: (index: number) => void
  clearRejections: () => void
  clearNotices: () => void
  importFiles: (files: File[]) => Promise<void>
  close: () => void
  /** Continue with a new working copy made from the current one (an erase); the old one stays for undo. */
  openDerived: (result: UploadResult) => Promise<void>
  restorePrevious: () => void
}

const newJobId = (): string => crypto.randomUUID().replaceAll('-', '')

/** The same advice (for example that ClamAV is not running) is shown once per session, not on every picture. */
const shownNotices = new Set<string>()
function freshNotices(notices: string[]): string[] {
  const fresh = notices.filter((n) => !shownNotices.has(n))
  for (const n of fresh) shownNotices.add(n)
  return fresh
}

export const useImage = create<ImageState>((set, get) => ({
  current: null,
  versions: [],
  rejections: [],
  notices: [],
  importing: false,
  limits: { maxBytes: DEFAULT_MAX_BYTES, maxBatch: DEFAULT_MAX_BATCH },
  setLimits: (maxBytes, maxBatch) => set({ limits: { maxBytes, maxBatch } }),
  dismissRejection: (index) => set((s) => ({ rejections: s.rejections.filter((_, i) => i !== index) })),
  clearRejections: () => set({ rejections: [], notices: [] }),
  clearNotices: () => set({ notices: [] }),
  openDerived: async (result) => {
    const pixels = await loadPixels(result.url)
    const previous = get().current
    const edit = useEdit.getState()
    const kept = previous
      ? [...get().versions, { image: previous, history: edit.history, index: edit.index }]
      : get().versions
    for (const dropped of kept.slice(0, -MAX_VERSIONS)) dropped.image.bitmap.close()
    set({
      current: {
        ...pixels,
        id: result.id,
        name: result.name,
        width: result.width,
        height: result.height,
        hasAlpha: result.has_alpha,
        report: result,
      },
      versions: kept.slice(-MAX_VERSIONS),
    })
    useEdit.getState().reset()
    useView.getState().setImage({ w: result.width, h: result.height })
  },
  restorePrevious: () => {
    const kept = get().versions
    const last = kept[kept.length - 1]
    if (!last) return
    get().current?.bitmap.close()
    set({ current: last.image, versions: kept.slice(0, -1) })
    useEdit.getState().reset(last.history, last.index)
    useView.getState().setImage({ w: last.image.width, h: last.image.height })
  },
  close: () => {
    get().current?.bitmap.close()
    for (const v of get().versions) v.image.bitmap.close()
    set({ current: null, versions: [] })
    useEdit.getState().reset()
    useView.getState().setImage(null)
  },

  importFiles: async (files) => {
    if (files.length === 0) return
    const projects = files.filter((f) => f.name.toLowerCase().endsWith('.pxe'))
    files = files.filter((f) => !projects.includes(f))
    for (const project of projects) await openProjectFile(project, set)
    if (files.length === 0) return
    const { limits } = get()
    const rejections: Rejection[] = []
    const reject = (message: string, code = 'precheck') =>
      rejections.push({ code, step: 'size', message, steps: [] })

    if (files.length > limits.maxBatch) {
      reject(
        `You selected ${files.length} files; a batch can hold at most ${limits.maxBatch}.`,
        'batch_too_large',
      )
      set({ rejections })
      return
    }

    const accepted: File[] = []
    for (const file of files) {
      const result = await precheck(file, { maxBytes: limits.maxBytes })
      if (result.ok) accepted.push(file)
      else reject(result.reason)
    }
    set({ rejections, notices: [], importing: accepted.length > 0 })
    if (accepted.length === 0) return

    const jobs = useJobs.getState()
    const entries = accepted.map((file) => ({ file, jobId: newJobId() }))
    for (const { file, jobId } of entries)
      jobs.upsert({ id: jobId, name: file.name, status: 'uploading', progress: 0, label: 'Waiting' })

    let batchId: string | undefined
    try {
      if (accepted.length > 1) batchId = await createBatch(accepted.length)
    } catch (error) {
      if (error instanceof RejectionError) set((s) => ({ rejections: [...s.rejections, error.rejection] }))
      for (const { jobId } of entries) jobs.upsert({ id: jobId, status: 'failed', progress: 1 })
      set({ importing: false })
      return
    }

    let opened = false
    for (const { file, jobId } of entries) {
      try {
        const result = await uploadImage(file, {
          jobId,
          batchId,
          onUploadProgress: (f) =>
            useJobs
              .getState()
              .upsert({ id: jobId, status: 'uploading', label: 'Uploading', progress: f * 0.15 }),
        })
        if (!opened) {
          opened = true
          const pixels = await loadPixels(result.url)
          get().current?.bitmap.close()
          for (const v of get().versions) v.image.bitmap.close()
          set({
            versions: [],
            current: {
              ...pixels,
              id: result.id,
              name: result.name,
              width: result.width,
              height: result.height,
              hasAlpha: result.has_alpha,
              report: result,
            },
            notices: freshNotices(result.gate.notices),
          })
          useEdit.getState().reset()
          useView.getState().setImage({ w: result.width, h: result.height })
        }
      } catch (error) {
        const rejection =
          error instanceof RejectionError
            ? error.rejection
            : {
                code: 'load_failed',
                step: 'size',
                steps: [],
                message: error instanceof Error ? error.message : 'The image could not be opened.',
              }
        useJobs.getState().upsert({ id: jobId, status: 'failed', progress: 1, error: rejection.message })
        set((s) => ({
          rejections: [...s.rejections, { ...rejection, message: `${file.name}: ${rejection.message}` }],
        }))
      }
    }
    set({ importing: false })
  },
}))

type Setter = (partial: Partial<ImageState> | ((s: ImageState) => Partial<ImageState>)) => void

/** Open a .pxe project: its image goes through the whole Security Gate again on the server. */
async function openProjectFile(file: File, set: Setter): Promise<void> {
  const jobId = newJobId()
  const jobs = useJobs.getState()
  jobs.upsert({ id: jobId, name: file.name, status: 'uploading', progress: 0, label: 'Opening project' })
  set({ importing: true })
  try {
    const result = await openProject(file, jobId)
    const pixels = await loadPixels(result.url)
    useImage.getState().current?.bitmap.close()
    set({
      current: {
        ...pixels,
        id: result.id,
        name: result.project.name || result.name,
        width: result.width,
        height: result.height,
        hasAlpha: result.has_alpha,
        report: result,
      },
      notices: freshNotices(result.gate.notices),
    })
    useEdit.getState().reset(result.project.history, result.project.index)
    useView.getState().setImage({ w: result.width, h: result.height })
  } catch (error) {
    const rejection =
      error instanceof RejectionError
        ? error.rejection
        : {
            code: 'load_failed',
            step: 'size',
            steps: [],
            message: error instanceof Error ? error.message : 'The project could not be opened.',
          }
    jobs.upsert({ id: jobId, status: 'failed', progress: 1, error: rejection.message })
    set((s) => ({
      rejections: [...s.rejections, { ...rejection, message: `${file.name}: ${rejection.message}` }],
    }))
  } finally {
    set({ importing: false })
  }
}
