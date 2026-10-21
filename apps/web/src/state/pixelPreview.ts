import { create } from 'zustand'
import type { PixelPreview } from '../api/edit'

interface PixelPreviewState {
  /** The latest pixel-art picture from the server (an object URL), drawn over the image. */
  url: string | null
  info: PixelPreview['info'] | null
  loading: boolean
  error: string | null
  begin: () => void
  show: (preview: PixelPreview) => void
  fail: (message: string) => void
  clear: () => void
}

const release = (url: string | null) => {
  if (url) URL.revokeObjectURL(url)
}

export const usePixelPreview = create<PixelPreviewState>((set, get) => ({
  url: null,
  info: null,
  loading: false,
  error: null,
  begin: () => set({ loading: true, error: null }),
  show: (preview) => {
    release(get().url)
    set({ url: preview.url, info: preview.info, loading: false, error: null })
  },
  fail: (message) => set({ loading: false, error: message }),
  clear: () => {
    release(get().url)
    set({ url: null, info: null, loading: false, error: null })
  },
}))
