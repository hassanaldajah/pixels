import { create } from 'zustand'
import { MAX_DABS, type Paint, type Stroke } from '../engine/types'
import { committedState } from './edit'
import { commitLayer, previewLayer } from './layers'

/** Painting a layer's mask: hide parts of the selected layer, or bring hidden parts back. */
interface LayerMaskStore {
  painting: boolean
  reveal: boolean
  size: number // image pixels
  hardness: number
  flow: number
  set: (patch: Partial<Omit<LayerMaskStore, 'set'>>) => void
}

export const useLayerMask = create<LayerMaskStore>((set) => ({
  painting: false,
  reveal: false,
  size: 80,
  hardness: 0.5,
  flow: 0.8,
  set: (patch) => set(patch),
}))

const dabs = (p: Paint | null | undefined): number => p?.strokes.reduce((n, s) => n + s.pts.length, 0) ?? 0

/** Show a stroke on the selected layer while painting, or commit it as one history step. */
export function applyMaskStroke(layerId: string, stroke: Stroke, commit: boolean): boolean {
  const layer = (committedState().layers ?? []).find((l) => l.id === layerId)
  if (!layer) return false
  if (dabs(layer.hide) + stroke.pts.length > MAX_DABS) return false
  const hide: Paint = { strokes: [...(layer.hide?.strokes ?? []), stroke] }
  if (commit) commitLayer(stroke.erase ? 'Reveal part of layer' : 'Hide part of layer', layerId, { hide })
  else previewLayer(layerId, { hide })
  return true
}

export function clearMask(layerId: string): void {
  commitLayer('Clear layer mask', layerId, { hide: null })
}
