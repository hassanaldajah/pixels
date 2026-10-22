import { create } from 'zustand'
import { uploadImage } from '../api/client'
import type { Layer } from '../engine/types'
import { MAX_LAYERS } from '../engine/types'
import { loadPixels } from '../lib/imageLoader'
import { committedState, useEdit } from './edit'
import { useImage } from './image'
import { useJobs } from './jobs'

/** The pictures behind the layers (keyed by their Security-Gate-approved image id). The layers themselves live in the EditState. */
export interface LayerPicture {
  bitmap: ImageBitmap
  blob: Blob
  width: number
  height: number
}

interface PictureStore {
  pictures: Record<string, LayerPicture>
  loading: Record<string, true>
  selected: string | null
  error: string | null
  select: (id: string | null) => void
  /** Load a layer's picture from the backend if it is not here yet (opening a project, undo across sessions). */
  ensure: (imageId: string) => Promise<void>
  add: (file: File) => Promise<void>
  clearError: () => void
}

const newLayerId = (): string => crypto.randomUUID().replaceAll('-', '').slice(0, 10)

export const useLayerPictures = create<PictureStore>((set, get) => ({
  pictures: {},
  loading: {},
  selected: null,
  error: null,
  select: (selected) => set({ selected }),
  clearError: () => set({ error: null }),

  ensure: async (imageId) => {
    const { pictures, loading } = get()
    if (pictures[imageId] || loading[imageId]) return
    set({ loading: { ...loading, [imageId]: true } })
    try {
      const pixels = await loadPixels(`/api/images/${imageId}`)
      set((s) => ({
        pictures: {
          ...s.pictures,
          [imageId]: {
            bitmap: pixels.bitmap,
            blob: pixels.blob,
            width: pixels.bitmap.width,
            height: pixels.bitmap.height,
          },
        },
      }))
    } catch {
      set({ error: 'A layer picture could not be loaded from the backend.' })
    } finally {
      set((s) => {
        const next = { ...s.loading }
        delete next[imageId]
        return { loading: next }
      })
    }
  },

  add: async (file) => {
    const base = useImage.getState().current
    if (!base) return
    const state = committedState()
    if ((state.layers?.length ?? 0) >= MAX_LAYERS) {
      set({ error: `A picture can hold at most ${MAX_LAYERS} layers.` })
      return
    }
    const jobId = crypto.randomUUID().replaceAll('-', '')
    const jobs = useJobs.getState()
    jobs.upsert({ id: jobId, name: file.name, status: 'uploading', progress: 0, label: 'Uploading layer' })
    try {
      // the layer picture goes through the same Security Gate as any opened image
      const result = await uploadImage(file, { jobId })
      await get().ensure(result.id)
      const fit = Math.min(1, base.width / result.width, base.height / result.height)
      const layer: Layer = {
        id: newLayerId(),
        image_id: result.id,
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 64) || 'Layer',
        visible: true,
        opacity: 100,
        blend: 'normal',
        scale: fit,
        x: Math.round((base.width - result.width * fit) / 2),
        y: Math.round((base.height - result.height * fit) / 2),
      }
      useEdit.getState().commit('Add layer', { ...state, layers: [...(state.layers ?? []), layer] })
      set({ selected: layer.id, error: null })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'The layer picture could not be added.' })
      jobs.upsert({ id: jobId, status: 'failed', progress: 1 })
    }
  },
}))

type Patch = Partial<Omit<Layer, 'id' | 'image_id'>>
const layersOf = (): Layer[] => committedState().layers ?? []
const write = (label: string, layers: Layer[]) => {
  const state = committedState()
  useEdit.getState().commit(label, { ...state, layers })
}

/** Change one layer while dragging (no history entry). */
export function previewLayer(id: string, patch: Patch): void {
  const state = committedState()
  useEdit
    .getState()
    .preview({ ...state, layers: layersOf().map((l) => (l.id === id ? { ...l, ...patch } : l)) })
}
export function commitLayer(label: string, id: string, patch: Patch): void {
  write(
    label,
    layersOf().map((l) => (l.id === id ? { ...l, ...patch } : l)),
  )
}
export function removeLayer(id: string): void {
  write(
    'Delete layer',
    layersOf().filter((l) => l.id !== id),
  )
  if (useLayerPictures.getState().selected === id) useLayerPictures.getState().select(null)
}
/** Move a layer one step up (toward the top of the stack) or down. The list is bottom to top. */
export function moveLayer(id: string, direction: 'up' | 'down'): void {
  const list = [...layersOf()]
  const i = list.findIndex((l) => l.id === id)
  const j = direction === 'up' ? i + 1 : i - 1
  if (i < 0 || j < 0 || j >= list.length) return
  const [item] = list.splice(i, 1)
  list.splice(j, 0, item as Layer)
  write('Reorder layers', list)
}
