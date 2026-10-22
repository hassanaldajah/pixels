import { create } from 'zustand'
import { MAX_CLONE, MAX_DABS, type CloneStroke } from '../engine/types'
import { committedState, useEdit } from './edit'

interface CloneStore {
  size: number
  hardness: number
  flow: number
  /** The place being copied from (Alt+click), in picture pixels. */
  source: { x: number; y: number } | null
  /** Fixed by the first stroke after the source is set; later strokes keep the same offset (aligned). */
  offset: { dx: number; dy: number } | null
  set: (patch: Partial<Omit<CloneStore, 'set'>>) => void
}

export const useClone = create<CloneStore>((set) => ({
  size: 50,
  hardness: 0.5,
  flow: 0.8,
  source: null,
  offset: null,
  set: (patch) => set(patch),
}))

const totalDabs = (strokes: CloneStroke[]) => strokes.reduce((n, s) => n + s.pts.length, 0)

/** Show the stroke while painting (no history entry), or commit it as one history step. Returns false at the limits. */
export function applyCloneStroke(stroke: CloneStroke, commit: boolean): boolean {
  const state = committedState()
  const current = state.clone ?? []
  if (current.length >= MAX_CLONE || totalDabs(current) + stroke.pts.length > MAX_DABS) return false
  const next = { ...state, clone: [...current, stroke] }
  if (commit) useEdit.getState().commit('Clone stamp', next)
  else useEdit.getState().preview(next)
  return true
}
