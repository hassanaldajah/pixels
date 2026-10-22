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
  sharpen: { amount: number; radius: number; threshold: number }
  vignette: { amount: number; midpoint: number; feather: number }
  grain: { amount: number; size: number; seed: number }
}

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
  'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'difference' | 'soft-light'
export const BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'difference',
  'soft-light',
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
}

export interface EditState {
  geometry: GeoOp[]
  adjust: Adjust
  pixelart?: PixelArt | null
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
    sharpen: { amount: 0, radius: 1, threshold: 0 },
    vignette: { amount: 0, midpoint: 50, feather: 50 },
    grain: { amount: 0, size: 1, seed: 1 },
  }
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
  s.geometry.length === 0 && isIdentityAdjust(s.adjust) && !s.pixelart && !(s.layers?.length ?? 0)

export const hasPointAdjustments = (a: Adjust): boolean => {
  const base = defaultAdjust()
  return !adjustEquals(
    { ...a, noise_reduction: 0, sharpen: base.sharpen, vignette: base.vignette, grain: base.grain },
    base,
  )
}
