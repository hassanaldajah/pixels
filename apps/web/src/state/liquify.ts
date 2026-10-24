import { create } from 'zustand'
import { MAX_DABS, MAX_LIQUIFY, type LiquifyStroke } from '../engine/types'
import { committedState, useEdit } from './edit'

export type LiquifyMode = LiquifyStroke['mode']

export const LIQUIFY_MODES: Record<LiquifyMode, { label: string; hint: string }> = {
  push: {
    label: 'Push',
    hint: 'Drag the picture along with the brush: reshape a smile, a jaw line, a curve.',
  },
  bloat: {
    label: 'Bloat',
    hint: 'Make the part under the brush bigger. Hold the mouse still to grow it more.',
  },
  pinch: { label: 'Pinch', hint: 'Make the part under the brush smaller.' },
  restore: { label: 'Restore', hint: 'Paint back toward the original shape.' },
}

interface LiquifyStore {
  mode: LiquifyMode
  size: number // image pixels
  strength: number // 0..1
  set: (patch: Partial<Omit<LiquifyStore, 'set'>>) => void
}

export const useLiquify = create<LiquifyStore>((set) => ({
  mode: 'push',
  size: 160,
  strength: 0.5,
  set: (patch) => set(patch),
}))

/** Show a stroke while dragging (no history entry), or commit it as one history step. */
export function applyLiquifyStroke(stroke: LiquifyStroke, commit: boolean): boolean {
  const state = committedState()
  const list = state.liquify ?? []
  const dabs = list.reduce((n, s) => n + s.pts.length, 0)
  if (list.length >= MAX_LIQUIFY || dabs + stroke.pts.length > MAX_DABS) return false
  const next = { ...state, liquify: [...list, stroke] }
  if (commit) useEdit.getState().commit(`Liquify: ${LIQUIFY_MODES[stroke.mode].label}`, next)
  else useEdit.getState().preview(next)
  return true
}
