import { create } from 'zustand'
import {
  defaultAdjust,
  MAX_DABS,
  MAX_LOCAL,
  type Adjust,
  type LocalAdjust,
  type Stroke,
} from '../engine/types'
import { committedState, useEdit } from './edit'

export type BrushMode = 'dodge' | 'burn' | 'eyes' | 'teeth' | 'warm' | 'soft' | 'blur'

interface Preset {
  label: string
  hint: string
  /** What the brush does at 100% strength (scaled by the Strength slider). */
  adjust: Partial<
    Pick<
      Adjust,
      'exposure' | 'contrast' | 'highlights' | 'shadows' | 'temperature' | 'saturation' | 'vibrance' | 'blur'
    >
  >
}

export const PRESETS: Record<BrushMode, Preset> = {
  dodge: {
    label: 'Dodge (lighten)',
    hint: 'Lift light where you paint.',
    adjust: { exposure: 0.7, shadows: 15 },
  },
  burn: {
    label: 'Burn (darken)',
    hint: 'Deepen shadows where you paint.',
    adjust: { exposure: -0.7, contrast: 10 },
  },
  eyes: {
    label: 'Brighten eyes',
    hint: 'Paint over the whites and irises: a little light and contrast.',
    adjust: { exposure: 0.45, contrast: 18, highlights: 10 },
  },
  teeth: {
    label: 'Whiten teeth',
    hint: 'Paint over the teeth: less yellow, a touch brighter.',
    adjust: { saturation: -55, exposure: 0.3, temperature: -12 },
  },
  warm: {
    label: 'Warm glow',
    hint: 'Warmer, brighter colour where you paint.',
    adjust: { temperature: 35, exposure: 0.25, vibrance: 15 },
  },
  blur: {
    label: 'Blur',
    hint: 'Blur where you paint: a soft background, hidden detail.',
    adjust: { blur: 6 },
  },
  soft: {
    label: 'Soften',
    hint: 'Lower the contrast where you paint.',
    adjust: { contrast: -35, highlights: -15 },
  },
}

interface BrushStore {
  mode: BrushMode
  size: number
  hardness: number
  flow: number
  strength: number
  /** The painted adjustment strokes are added to (null: the next stroke starts a new one). */
  target: string | null
  set: (patch: Partial<Omit<BrushStore, 'set'>>) => void
}

export const useBrush = create<BrushStore>((set) => ({
  mode: 'dodge',
  size: 60,
  hardness: 0.4,
  flow: 0.35,
  strength: 100,
  target: null,
  set: (patch) => set(patch),
}))

const newId = (): string => crypto.randomUUID().replaceAll('-', '').slice(0, 10)
/** The id of an adjustment being created by the stroke in progress (so every preview frame reuses one GPU mask). */
let pendingId: string | null = null
export const endStroke = (): void => {
  pendingId = null
}

export function presetAdjust(mode: BrushMode, strength: number): Adjust {
  const adjust = defaultAdjust()
  for (const [key, value] of Object.entries(PRESETS[mode].adjust))
    (adjust as unknown as Record<string, number>)[key] = Math.round(value * (strength / 100) * 100) / 100
  return adjust
}

/** The painted adjustment strokes go to: the chosen one, or a fresh one made from the current preset. */
export function paintedTarget(local: LocalAdjust[]): { item: LocalAdjust; created: boolean } | null {
  const { target, mode, strength } = useBrush.getState()
  const existing = local.find((l) => l.id === target && l.paint)
  if (existing) return { item: existing, created: false }
  if (local.length >= MAX_LOCAL) return null
  return {
    item: {
      id: (pendingId ??= newId()),
      name: PRESETS[mode].label,
      visible: true,
      paint: { strokes: [] },
      adjust: presetAdjust(mode, strength),
    },
    created: true,
  }
}

const dabsIn = (item: LocalAdjust): number => item.paint?.strokes.reduce((n, s) => n + s.pts.length, 0) ?? 0

/** Show the strokes while painting (no history entry), or commit them as one history step. */
export function applyStroke(stroke: Stroke, commit: boolean): boolean {
  const state = committedState()
  const local = state.local ?? []
  const picked = paintedTarget(local)
  if (!picked) return false
  const { item, created } = picked
  if (dabsIn(item) + stroke.pts.length > MAX_DABS) return false
  const updated: LocalAdjust = { ...item, paint: { strokes: [...(item.paint?.strokes ?? []), stroke] } }
  const next = created ? [...local, updated] : local.map((l) => (l.id === item.id ? updated : l))
  if (commit) {
    useEdit
      .getState()
      .commit(stroke.erase ? 'Brush (erase)' : `Brush: ${updated.name}`, { ...state, local: next })
    useBrush.getState().set({ target: updated.id })
    endStroke()
  } else useEdit.getState().preview({ ...state, local: next })
  return true
}
