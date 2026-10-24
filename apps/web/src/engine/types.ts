import { outputColors } from '../tokens'

/** The edit model. Mirrors server/pipeline/ops.py field for field (it is sent to the server as-is). */

export type Anchor = 'tl' | 'tc' | 'tr' | 'ml' | 'c' | 'mr' | 'bl' | 'bc' | 'br'

export type GeoOp =
  | { type: 'rotate90'; turns: 1 | 2 | 3 }
  | { type: 'flip'; axis: 'h' | 'v' }
  | { type: 'rotate'; angle: number; expand: boolean }
  | { type: 'straighten'; angle: number }
  | { type: 'crop'; x: number; y: number; w: number; h: number }
  | { type: 'skew'; x: number; y: number }
  | { type: 'perspective'; quad: [number, number][] }
  | { type: 'resize'; w: number; h: number }
  | { type: 'canvas'; w: number; h: number; anchor: Anchor; fill: string | null }

export type CurvePoints = [number, number][]

export interface Adjust {
  exposure: number
  temperature: number
  tint: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  vibrance: number
  saturation: number
  levels: { black: number; white: number; gamma: number }
  hsl: { hue: number[]; sat: number[]; lum: number[] }
  curves: { master: CurvePoints; r: CurvePoints; g: CurvePoints; b: CurvePoints }
  noise_reduction: number
  blur: number
  /** Older saves lack these: a Gaussian blur. */
  blur_kind?: BlurKind
  blur_angle?: number
  sharpen: { amount: number; radius: number; threshold: number }
  vignette: { amount: number; midpoint: number; feather: number }
  grain: { amount: number; size: number; seed: number }
}

export type BlurKind = 'gaussian' | 'motion' | 'lens' | 'spin'

export type PixelPalette = 'auto' | 'gameboy' | 'pico8' | 'nes' | 'c64' | 'cga' | 'endesga32' | 'custom'
export type Dither = 'none' | 'bayer2' | 'bayer4' | 'bayer8' | 'floyd' | 'atkinson'

/** Turns the picture into pixel art. Applied last, on the server (the GPU engine ignores it). */
export interface PixelArt {
  pixel_size: number
  smooth: number
  palette: PixelPalette
  colors: number
  custom_palette: string[]
  dither: Dither
  dither_strength: number
  outline: boolean
  outline_color: string
  scale: number
}

export const defaultPixelArt = (): PixelArt => ({
  pixel_size: 6,
  smooth: 30,
  palette: 'auto',
  colors: 16,
  custom_palette: [],
  dither: 'none',
  dither_strength: 0.7,
  outline: false,
  outline_color: outputColors.black,
  scale: 0,
})

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'soft-light'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
/** The order is the shader's u_mode number: append new modes at the end. */
export const BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'difference',
  'soft-light',
  'color-dodge',
  'color-burn',
  'hard-light',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]
export const MAX_LAYERS = 16

export interface LayerMask {
  kind: 'linear' | 'radial'
  x0: number
  y0: number
  x1: number
  y1: number
  invert: boolean
}

export interface Selection {
  /** wand: x, y is the clicked point */
  kind: 'rect' | 'ellipse' | 'polygon' | 'wand'
  x: number
  y: number
  w: number
  h: number
  points: [number, number][]
  feather: number
  invert: boolean
  /** wand: how far the colour may drift (percent) and whether only the connected area counts */
  tolerance?: number
  contiguous?: boolean
}
export const MAX_SELECTION_POINTS = 128

/** A picture placed above the edited image (bottom to top). `image_id` is a Security-Gate-approved working copy. */
export interface Layer {
  id: string
  image_id: string
  name: string
  visible: boolean
  opacity: number // percent
  blend: BlendMode
  x: number
  y: number
  scale: number
  mask?: LayerMask | null
  /** Brush strokes that hide parts of the layer, in its own pixels (an erase stroke shows them again). */
  hide?: Paint | null
  /** How the picture was made (text layers), so it can be edited and drawn again. */
  source?: LayerSource | null
}

export interface LayerSource {
  kind: 'text' | 'path'
  options: Record<string, unknown>
}

/** One smudge stroke: drags colour along the dabs at pts (canvas pixels, after geometry). */
export interface SmudgeStroke {
  r: number
  hardness: number
  strength: number
  pts: [number, number][]
}
export const MAX_SMUDGE = 60

/** One liquify stroke (canvas pixels, after geometry): see server/pipeline/liquify.py. */
export interface LiquifyStroke {
  mode: 'push' | 'bloat' | 'pinch' | 'restore'
  r: number
  strength: number
  pts: [number, number][]
}
export const MAX_LIQUIFY = 80

export const MAX_LOCAL = 8
export const MAX_CLONE = 60

/** One clone-stamp stroke: copies from (x + dx, y + dy) onto the dabs at `pts`. */
export interface CloneStroke {
  dx: number
  dy: number
  r: number
  hardness: number
  flow: number
  pts: [number, number][]
}

export interface Stroke {
  r: number
  hardness: number
  flow: number
  erase: boolean
  pts: [number, number][]
}
export interface Paint {
  strokes: Stroke[]
}
export const MAX_DABS = 40_000

/** Adjustments that apply only where a gradient is opaque (a graduated or radial filter). */
/** The order is the shader's u_tone number. */
export const TONES = ['all', 'shadows', 'midtones', 'highlights'] as const
export type ToneRange = (typeof TONES)[number]

export interface LocalAdjust {
  id: string
  name: string
  visible: boolean
  /** A gradient... */
  mask?: LayerMask | null
  /** ...or brush strokes (exactly one of the two). */
  paint?: Paint | null
  adjust: Adjust
  /** Which tones it reaches (older saves lack it: all). */
  tone?: ToneRange
}

export interface EditState {
  geometry: GeoOp[]
  adjust: Adjust
  pixelart?: PixelArt | null
  selection?: Selection | null
  local?: LocalAdjust[]
  clone?: CloneStroke[]
  smudge?: SmudgeStroke[]
  liquify?: LiquifyStroke[]
  layers?: Layer[]
}

export const HSL_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const
export const HSL_CENTERS = [0, 30, 60, 120, 180, 240, 270, 300] as const
export const MAX_CURVE_POINTS = 16

const identityCurve = (): CurvePoints => [
  [0, 0],
  [1, 1],
]

export function defaultAdjust(): Adjust {
  return {
    exposure: 0,
    temperature: 0,
    tint: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    vibrance: 0,
    saturation: 0,
    levels: { black: 0, white: 1, gamma: 1 },
    hsl: { hue: Array<number>(8).fill(0), sat: Array<number>(8).fill(0), lum: Array<number>(8).fill(0) },
    curves: { master: identityCurve(), r: identityCurve(), g: identityCurve(), b: identityCurve() },
    noise_reduction: 0,
    blur: 0,
    blur_kind: 'gaussian',
    blur_angle: 0,
    sharpen: { amount: 0, radius: 1, threshold: 0 },
    vignette: { amount: 0, midpoint: 50, feather: 50 },
    grain: { amount: 0, size: 1, seed: 1 },
  }
}

/**
 * States saved by older versions (history, projects) lack fields added later (blur, layers...). Fill them with
 * their defaults wherever a state enters the app, so every panel can rely on them.
 */
export function withDefaults(state: EditState): EditState {
  return { ...state, adjust: { ...defaultAdjust(), ...state.adjust } }
}

export const emptyState = (): EditState => ({ geometry: [], adjust: defaultAdjust() })

export const isIdentityCurve = (points: CurvePoints): boolean =>
  points.length === 2 &&
  points[0]?.[0] === 0 &&
  points[0][1] === 0 &&
  points[1]?.[0] === 1 &&
  points[1][1] === 1

export function adjustEquals(a: Adjust, b: Adjust): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export const isIdentityAdjust = (a: Adjust): boolean => adjustEquals(a, defaultAdjust())

export const isEmptyState = (s: EditState): boolean =>
  s.geometry.length === 0 &&
  isIdentityAdjust(s.adjust) &&
  !s.pixelart &&
  !(s.layers?.length ?? 0) &&
  !(s.local?.length ?? 0) &&
  !(s.clone?.length ?? 0) &&
  !(s.smudge?.length ?? 0) &&
  !(s.liquify?.length ?? 0)

export const hasPointAdjustments = (a: Adjust): boolean => {
  const base = defaultAdjust()
  return !adjustEquals(
    {
      ...a,
      noise_reduction: 0,
      blur: 0,
      blur_kind: base.blur_kind,
      blur_angle: base.blur_angle,
      sharpen: base.sharpen,
      vignette: base.vignette,
      grain: base.grain,
    },
    base,
  )
}
