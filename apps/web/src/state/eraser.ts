import { create } from 'zustand'
import { eraseObject } from '../api/edit'
import { RejectionError } from '../api/client'
import { clearMask, maskIsEmpty, packedMask, undoDepth, undoStroke } from '../lib/eraserMask'
import { committedState } from './edit'
import { useImage } from './image'

interface EraserState {
  /** Brush diameter in picture pixels. */
  brush: number
  paint: boolean
  quality: 'fast' | 'high'
  grow: number
  feather: number
  hasMask: boolean
  undoable: number
  busy: boolean
  error: string | null
  set: (patch: Partial<Pick<EraserState, 'brush' | 'paint' | 'quality' | 'grow' | 'feather'>>) => void
  /** The mask canvas changed: refresh what the buttons depend on. */
  sync: () => void
  undoStroke: () => void
  clear: () => void
  run: () => Promise<void>
}

export const useEraser = create<EraserState>((set, get) => ({
  brush: 48,
  paint: true,
  quality: 'high',
  grow: 6,
  feather: 3,
  hasMask: false,
  undoable: 0,
  busy: false,
  error: null,
  set: (patch) => set(patch),
  sync: () => set({ hasMask: !maskIsEmpty(), undoable: undoDepth() }),
  undoStroke: () => {
    undoStroke()
    get().sync()
  },
  clear: () => {
    clearMask()
    get().sync()
  },
  run: async () => {
    const image = useImage.getState().current
    if (!image || get().busy || maskIsEmpty()) return
    const mask = packedMask()
    set({ busy: true, error: null })
    try {
      const result = await eraseObject(image.id, {
        state: committedState(),
        mask_w: mask.width,
        mask_h: mask.height,
        mask_bits: mask.bits,
        quality: get().quality,
        grow: get().grow,
        feather: get().feather,
      })
      await useImage.getState().openDerived(result)
      set({ hasMask: false, undoable: 0 })
    } catch (error) {
      set({
        error:
          error instanceof RejectionError
            ? error.rejection.message
            : error instanceof Error
              ? error.message
              : 'The removal failed.',
      })
    } finally {
      set({ busy: false })
    }
  },
}))
