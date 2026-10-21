import { create } from 'zustand'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  constrainPan,
  fitView,
  stepZoom,
  zoomAt,
  type Point,
  type Size,
  type View,
} from '../viewport/math'

export interface Guides {
  x: number[] // vertical guides, image px
  y: number[] // horizontal guides, image px
}

interface ViewState {
  /** Where the viewport is heading. The renderer eases its own current view toward this. */
  target: View
  /** 'anchor': zoom around a screen point. 'free': ease zoom and pan independently. */
  mode: 'anchor' | 'free'
  anchor: Point | null
  image: Size | null
  viewport: Size
  dpr: number
  guides: Guides
  setViewport: (size: Size, dpr: number) => void
  setImage: (size: Size | null) => void
  /** The shown picture changed size (an edit): keep guides, refit only if the size really changed. */
  resizeImage: (size: Size) => void
  fit: () => void
  actualSize: () => void
  zoomTo: (zoom: number, anchor?: Point) => void
  zoomBy: (factor: number, anchor: Point) => void
  step: (direction: 1 | -1) => void
  panBy: (dxCss: number, dyCss: number) => void
  panTo: (x: number, y: number) => void
  addGuide: (axis: 'x' | 'y', value: number) => void
  moveGuide: (axis: 'x' | 'y', index: number, value: number) => void
  removeGuide: (axis: 'x' | 'y', index: number) => void
  clearGuides: () => void
}

const CENTRE_FALLBACK: View = { zoom: 1, panX: 0, panY: 0 }

export const useView = create<ViewState>((set, get) => ({
  target: CENTRE_FALLBACK,
  mode: 'free',
  anchor: null,
  image: null,
  viewport: { w: 1, h: 1 },
  dpr: 1,
  guides: { x: [], y: [] },

  setViewport: (viewport, dpr) => {
    set({ viewport, dpr })
    const { image, target } = get()
    if (image && target.zoom === CENTRE_FALLBACK.zoom && target.panX === 0) get().fit()
  },
  setImage: (image) => {
    set({ image, guides: { x: [], y: [] } })
    if (image) get().fit()
  },
  resizeImage: (size) => {
    const previous = get().image
    set({ image: size })
    if (!previous || previous.w !== size.w || previous.h !== size.h) get().fit()
  },
  fit: () => {
    const { image, viewport, dpr } = get()
    if (image) set({ target: fitView(image, viewport, dpr), mode: 'free', anchor: null })
  },
  actualSize: () => {
    const { image, target } = get()
    if (!image) return
    set({ target: { ...target, zoom: 1 }, mode: 'free', anchor: null })
  },
  zoomTo: (zoom, anchor) => {
    const { target, viewport, dpr, image } = get()
    const point = anchor ?? { x: viewport.w / 2, y: viewport.h / 2 }
    const next = zoomAt(target, zoom, point, viewport, dpr)
    set({
      target: image ? constrainPan(next, image, viewport, dpr) : next,
      mode: 'anchor',
      anchor: point,
    })
  },
  zoomBy: (factor, anchor) => get().zoomTo(clampZoom(get().target.zoom * factor), anchor),
  step: (direction) => get().zoomTo(stepZoom(get().target.zoom, direction)),
  panBy: (dx, dy) => {
    const { target, dpr, image, viewport } = get()
    const scale = target.zoom / dpr
    const next = { ...target, panX: target.panX - dx / scale, panY: target.panY - dy / scale }
    set({
      target: image ? constrainPan(next, image, viewport, dpr) : next,
      mode: 'free',
      anchor: null,
    })
  },
  panTo: (x, y) => {
    const { target, image, viewport, dpr } = get()
    const next = { ...target, panX: x, panY: y }
    set({ target: image ? constrainPan(next, image, viewport, dpr) : next, mode: 'free', anchor: null })
  },
  addGuide: (axis, value) => set((s) => ({ guides: { ...s.guides, [axis]: [...s.guides[axis], value] } })),
  moveGuide: (axis, index, value) =>
    set((s) => ({
      guides: { ...s.guides, [axis]: s.guides[axis].map((v, i) => (i === index ? value : v)) },
    })),
  removeGuide: (axis, index) =>
    set((s) => ({ guides: { ...s.guides, [axis]: s.guides[axis].filter((_, i) => i !== index) } })),
  clearGuides: () => set({ guides: { x: [], y: [] } }),
}))

export { MAX_ZOOM, MIN_ZOOM }
