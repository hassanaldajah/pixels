import { create } from 'zustand'
import { emptyState, isEmptyState, withDefaults, type EditState } from '../engine/types'

export interface Snapshot {
  label: string
  state: EditState
}

export type CompareMode = 'off' | 'split' | 'side'

const MAX_HISTORY = 500
const clone = <T>(v: T): T => structuredClone(v)
const same = (a: EditState, b: EditState): boolean => JSON.stringify(a) === JSON.stringify(b)

interface EditStore {
  history: Snapshot[]
  index: number
  /** A state being dragged (slider, handle). It previews without entering the history. */
  live: EditState | null
  compare: { mode: CompareMode; split: number; hold: boolean }
  /** Start over with a new image (or a loaded project). */
  reset: (history?: Snapshot[], index?: number) => void
  commit: (label: string, state: EditState) => void
  preview: (state: EditState | null) => void
  undo: () => void
  redo: () => void
  jump: (index: number) => void
  setCompare: (patch: Partial<EditStore['compare']>) => void
}

export const useEdit = create<EditStore>((set, get) => ({
  history: [{ label: 'Open', state: emptyState() }],
  index: 0,
  live: null,
  compare: { mode: 'off', split: 0.5, hold: false },

  reset: (history, index) =>
    set({
      history:
        history && history.length > 0
          ? history.map((h) => ({ ...h, state: withDefaults(h.state) }))
          : [{ label: 'Open', state: emptyState() }],
      index: index ?? (history ? history.length - 1 : 0),
      live: null,
    }),

  commit: (label, state) => {
    state = withDefaults(state)
    const { history, index } = get()
    const current = history[index]
    if (current && same(current.state, state)) {
      set({ live: null })
      return
    }
    const next = [...history.slice(0, index + 1), { label, state: clone(state) }].slice(-MAX_HISTORY)
    set({ history: next, index: next.length - 1, live: null })
  },

  preview: (live) => set({ live: live ? clone(withDefaults(live)) : null }),
  undo: () => set((s) => ({ index: Math.max(0, s.index - 1), live: null })),
  redo: () => set((s) => ({ index: Math.min(s.history.length - 1, s.index + 1), live: null })),
  jump: (i) => set((s) => ({ index: Math.min(s.history.length - 1, Math.max(0, i)), live: null })),
  setCompare: (patch) => set((s) => ({ compare: { ...s.compare, ...patch } })),
}))

export const committedState = (): EditState => {
  const { history, index } = useEdit.getState()
  return history[index]?.state ?? emptyState()
}

/** The state to draw right now: the one being dragged, or the committed one. */
export const displayedState = (): EditState => useEdit.getState().live ?? committedState()

/** Subscribe to the state being shown (the dragged one, or the committed one). */
export const useDisplayedState = (): EditState =>
  useEdit((s) => s.live ?? s.history[s.index]?.state ?? emptyState())

export const hasEdits = (): boolean => !isEmptyState(committedState())
export const canUndo = (): boolean => useEdit.getState().index > 0
export const canRedo = (): boolean => {
  const { index, history } = useEdit.getState()
  return index < history.length - 1
}
