import { create } from 'zustand'
import type { Layer, LayerSource } from '../engine/types'
import { renderPath, type PathOptions, type PenNode } from '../lib/penPath'
import { outputColors } from '../tokens'
import { useLayerPictures } from './layers'

/**
 * The Pen tool: click to place corner points, click and drag for curves, click the first point to close.
 * The path stays editable (drag points, undo the last one) until it is added as a layer; a path layer keeps
 * its nodes, so selecting it later brings them back for editing.
 */
interface PenStore extends PathOptions {
  /** The path layer being edited, if any. */
  editing: string | null
  busy: boolean
  set: (patch: Partial<Omit<PenStore, 'set' | 'commit' | 'loadLayer' | 'reset'>>) => void
  reset: () => void
  loadLayer: (layer: Layer) => void
  commit: (asNew?: boolean) => Promise<void>
}

const empty = { nodes: [] as PenNode[], closed: false, editing: null }

export const usePen = create<PenStore>((set, get) => ({
  ...empty,
  fill: outputColors.white,
  stroke: null,
  width: 6,
  busy: false,
  set: (patch) => set(patch),
  reset: () => set(empty),

  /** Bring a path layer's nodes back, following any move or resize of the layer since it was drawn. */
  loadLayer: (layer) => {
    const o = layer.source?.options as
      (PathOptions & { origin?: [number, number]; scale?: number }) | undefined
    if (layer.source?.kind !== 'path' || !o || !Array.isArray(o.nodes)) return
    const [ox, oy] = o.origin ?? [layer.x, layer.y]
    const k = layer.scale / (o.scale ?? layer.scale)
    const move = (n: PenNode): PenNode => ({
      x: layer.x + (n.x - ox) * k,
      y: layer.y + (n.y - oy) * k,
      in: n.in ? [n.in[0] * k, n.in[1] * k] : null,
      out: n.out ? [n.out[0] * k, n.out[1] * k] : null,
    })
    set({
      nodes: o.nodes.map(move),
      closed: !!o.closed,
      fill: o.fill ?? null,
      stroke: o.stroke ?? null,
      width: (o.width ?? 6) * k,
      editing: layer.id,
    })
  },

  commit: async (asNew = false) => {
    const { nodes, closed, fill, stroke, width, editing, busy } = get()
    if (busy || nodes.length < 2) return
    const drawn = renderPath({ nodes, closed, fill, stroke, width })
    if (!drawn) return
    set({ busy: true })
    try {
      const blob = await new Promise<Blob | null>((resolve) => drawn.canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('The path could not be drawn.')
      const file = new File([blob], 'path.png', { type: 'image/png' })
      const place = { x: drawn.x, y: drawn.y, scale: drawn.scale }
      const source: LayerSource = {
        kind: 'path',
        options: { nodes, closed, fill, stroke, width, origin: [drawn.x, drawn.y], scale: drawn.scale },
      }
      const pictures = useLayerPictures.getState()
      if (editing && !asNew) await pictures.replacePicture(editing, file, source, place)
      else await pictures.add(file, place, source)
      set(empty)
    } finally {
      set({ busy: false })
    }
  },
}))
