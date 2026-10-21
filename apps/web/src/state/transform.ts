import { create } from 'zustand'

export type TransformTab = 'crop' | 'rotate' | 'perspective' | 'canvas'
export type Rect = { x: number; y: number; w: number; h: number }
export type Quad = [number, number][]
export type Unit = 'px' | 'cm' | 'in'

/** Aspect ratio as width / height; null = free. */
export const RATIOS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: 'original', label: 'Original', ratio: -1 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '2:3', label: '2:3', ratio: 2 / 3 },
  { id: 'a4', label: 'A4', ratio: 210 / 297 },
  { id: 'custom', label: 'Custom', ratio: -2 },
]

interface TransformState {
  tab: TransformTab
  /** The crop rectangle in the displayed picture's pixels, or null when the tool is idle. */
  crop: Rect | null
  ratioId: string
  customRatio: [number, number]
  landscape: boolean
  unit: Unit
  dpi: number
  quad: Quad | null
  horizon: { a: [number, number]; b: [number, number] } | null
  drawingHorizon: boolean
  set: (patch: Partial<Omit<TransformState, 'set'>>) => void
}

export const useTransform = create<TransformState>((set) => ({
  tab: 'crop',
  crop: null,
  ratioId: 'free',
  customRatio: [1, 1],
  landscape: true,
  unit: 'px',
  dpi: 300,
  quad: null,
  horizon: null,
  drawingHorizon: false,
  set: (patch) => set(patch),
}))

/** Resolve the ratio lock to a number (w / h) for an image of the given size, or null for free. */
export function resolveRatio(
  id: string,
  custom: [number, number],
  landscape: boolean,
  imageW: number,
  imageH: number,
): number | null {
  const entry = RATIOS.find((r) => r.id === id)
  if (!entry || entry.ratio === null) return null
  let ratio = entry.ratio
  if (entry.ratio === -1) return imageW / imageH
  if (entry.ratio === -2) ratio = custom[0] / custom[1]
  else if (entry.id !== '1:1') {
    // presets are written in their natural orientation; honour the landscape toggle
    const naturalLandscape = ratio >= 1
    if (naturalLandscape !== landscape) ratio = 1 / ratio
  }
  return ratio
}

const PX_PER_UNIT = { px: 1, in: 1, cm: 1 / 2.54 }

export const toUnit = (px: number, unit: Unit, dpi: number): number =>
  unit === 'px' ? px : px / dpi / PX_PER_UNIT[unit]
export const fromUnit = (value: number, unit: Unit, dpi: number): number =>
  unit === 'px' ? value : value * PX_PER_UNIT[unit] * dpi

/** Largest rectangle with the given aspect ratio that fits in w x h, centred. */
export function fitRatio(ratio: number, w: number, h: number): Rect {
  let rw = w
  let rh = rw / ratio
  if (rh > h) {
    rh = h
    rw = rh * ratio
  }
  return { x: Math.round((w - rw) / 2), y: Math.round((h - rh) / 2), w: Math.round(rw), h: Math.round(rh) }
}
