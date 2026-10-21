import { create } from 'zustand'
import type { Point, View } from './math'

/**
 * The view the renderer is drawing right now (it eases toward `useView().target`). Rulers and the
 * mini-map follow this so they never drift from what is on screen.
 */
let live: View = { zoom: 1, panX: 0, panY: 0 }
const listeners = new Set<() => void>()

export const getLiveView = (): View => live

export function setLiveView(view: View): void {
  live = view
  for (const listener of listeners) listener()
}

export function subscribeLiveView(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Cursor position over the image, for the HUD. */
export const useCursor = create<{ image: Point | null; set: (p: Point | null) => void }>((set) => ({
  image: null,
  set: (image) => set({ image }),
}))
