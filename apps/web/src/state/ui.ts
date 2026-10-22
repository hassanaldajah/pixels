import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ThemeName } from '../tokens'

export type Quality = 'low' | 'medium' | 'high' | 'original'

export const QUALITY: Record<Quality, { label: string; maxEdge: number | null; hint: string }> = {
  low: { label: 'Low', maxEdge: 1024, hint: 'Fast drafts, up to 1024 px' },
  medium: { label: 'Medium', maxEdge: 2048, hint: 'Up to 2048 px' },
  high: { label: 'High', maxEdge: 4096, hint: 'Up to 4096 px' },
  original: { label: 'Original', maxEdge: null, hint: 'Native resolution, no downscaling' },
}

/** localStorage can be missing or throw (private windows, blocked storage): never let it break the UI. */
const safeStorage = createJSONStorage(() => ({
  getItem: (key) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* ignore */
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}))

interface UiState {
  theme: ThemeName
  quality: Quality
  tool: string
  rightOpen: boolean
  rightWidth: number
  dockOpen: boolean
  dockHeight: number
  rulers: boolean
  thirds: boolean
  gridCols: number
  gridRows: number
  customGrid: boolean
  reduceEffects: boolean
  paletteOpen: boolean
  helpOpen: boolean
  guideOpen: boolean
  exportOpen: boolean
  set: (patch: Partial<Omit<UiState, 'set'>>) => void
}

export const RIGHT_WIDTH = { min: 260, max: 460, default: 320 }
export const DOCK_HEIGHT = { min: 160, max: 380, default: 250 }

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: 'dark',
      quality: 'high',
      tool: 'select',
      rightOpen: true,
      rightWidth: RIGHT_WIDTH.default,
      dockOpen: false,
      dockHeight: DOCK_HEIGHT.default,
      rulers: true,
      thirds: false,
      gridCols: 4,
      gridRows: 4,
      customGrid: false,
      reduceEffects: false,
      paletteOpen: false,
      helpOpen: false,
      guideOpen: false,
      exportOpen: false,
      set: (patch) => set(patch),
    }),
    {
      name: 'pixels.ui',
      storage: safeStorage,
      partialize: (s) => ({
        theme: s.theme,
        quality: s.quality,
        rightOpen: s.rightOpen,
        rightWidth: s.rightWidth,
        dockOpen: s.dockOpen,
        dockHeight: s.dockHeight,
        rulers: s.rulers,
        thirds: s.thirds,
        gridCols: s.gridCols,
        gridRows: s.gridRows,
        customGrid: s.customGrid,
      }),
    },
  ),
)
