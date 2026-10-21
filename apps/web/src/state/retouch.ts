import { create } from 'zustand'
import { RejectionError } from '../api/client'
import { retouchImage, type RetouchKind } from '../api/edit'
import { committedState } from './edit'
import { useImage } from './image'

interface RetouchState {
  busy: RetouchKind | null
  error: string | null
  /** Run one of the retouch operations on the current picture; the result becomes the working copy. */
  run: (kind: RetouchKind, options: Record<string, number | boolean | string | null>) => Promise<void>
}

export const useRetouch = create<RetouchState>((set, get) => ({
  busy: null,
  error: null,
  run: async (kind, options) => {
    const image = useImage.getState().current
    if (!image || get().busy) return
    set({ busy: kind, error: null })
    try {
      const result = await retouchImage(image.id, kind, committedState(), options)
      await useImage.getState().openDerived(result)
    } catch (error) {
      set({
        error:
          error instanceof RejectionError
            ? error.rejection.message
            : error instanceof Error
              ? error.message
              : 'That did not work.',
      })
    } finally {
      set({ busy: null })
    }
  },
}))
