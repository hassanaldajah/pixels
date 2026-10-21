/**
 * Design tokens: the single source of truth for every colour, radius, blur, glow, duration and
 * easing in Pixels. `vite.tokens.ts` turns this file into CSS variables (`--px-*`); components,
 * Tailwind and the WebGL shaders all read those variables. Nothing else may hard-code a colour.
 *
 * The palette is deliberately small and ordered:
 *   bg0 < bg1 < bg2 < bg3      surfaces, from the page up to the highest hover state
 *   line < lineStrong          borders
 *   text1 > text2 > text3      primary, secondary, disabled text
 *   accent / accentDeep        the logo blue (focus, selection, active) and its darker step
 *   accentSoft / accentGlow    lighter and more saturated steps of the same blue (highlights, glow)
 *   rail*                      the blue tool rail (the only large blue surface in the dark theme)
 *   success / warning / danger status only
 */

export type ThemeName = 'dark' | 'light'

export interface Palette {
  bg0: string
  bg1: string
  bg2: string
  bg3: string
  canvas: string
  line: string
  lineStrong: string
  text1: string
  text2: string
  text3: string
  accent: string
  accentDeep: string
  accentSoft: string
  accentGlow: string
  success: string
  warning: string
  danger: string
  checkA: string
  checkB: string
  glass: string
  shadow: string
  railTop: string
  railBottom: string
  railText: string
  railTextDim: string
  railActive: string
}

export const themes: Record<ThemeName, Palette> = {
  dark: {
    bg0: '#030406', // near black: the interface is dark, the blue is reserved for the rail and accents
    bg1: '#090c11',
    bg2: '#10151d',
    bg3: '#19212d',
    canvas: '#010203',
    line: '#1b2330',
    lineStrong: '#344258',
    text1: '#eef3fb',
    text2: '#aab6c8',
    text3: '#7f8da3',
    accent: '#0089f5', // the logo blue
    accentDeep: '#0059c9',
    accentSoft: '#5cb8ff',
    accentGlow: '#0a6dff',
    success: '#2ee6a6',
    warning: '#ffc857',
    danger: '#ff6b87',
    checkA: '#12161d',
    checkB: '#1c222c',
    glass: 'rgba(9, 12, 17, 0.78)',
    shadow: 'rgba(0, 0, 0, 0.6)',
    railTop: '#0850b8',
    railBottom: '#052f78',
    railText: '#ffffff',
    railTextDim: '#cfe0fb',
    railActive: 'rgba(255, 255, 255, 0.2)',
  },
  light: {
    bg0: '#eaf0f9',
    bg1: '#f7f9fe',
    bg2: '#ffffff',
    bg3: '#dfe7f4',
    canvas: '#d8e0ef',
    line: '#cdd8ec',
    lineStrong: '#8fa2c6',
    text1: '#0a1530',
    text2: '#3a4a6c',
    text3: '#5f7096',
    accent: '#0067c7',
    accentDeep: '#00479f',
    accentSoft: '#1a7fe0',
    accentGlow: '#0a6dff',
    success: '#0b7a55',
    warning: '#8a5a00',
    danger: '#c0304f',
    checkA: '#ffffff',
    checkB: '#e6ecf7',
    glass: 'rgba(247, 249, 254, 0.78)',
    shadow: 'rgba(20, 40, 90, 0.2)',
    railTop: '#0850b8',
    railBottom: '#052f78',
    railText: '#ffffff',
    railTextDim: '#cfe0fb',
    railActive: 'rgba(255, 255, 255, 0.2)',
  },
}

/** The eight colour bands of the HSL tool, as the hues they stand for (identical in both themes). */
export const hslSwatches = [
  '#e5484d',
  '#f76b15',
  '#f5d90a',
  '#30a46c',
  '#12a594',
  '#0090ff',
  '#8e4ec6',
  '#d6409f',
] as const

/** Defaults for colours that end up inside exported files, not in the interface. */
export const outputColors = { white: '#ffffff', black: '#000000' } as const

export const shared = {
  radius: { sm: '8px', md: '12px', lg: '20px', pill: '999px' },
  blur: { panel: '18px', overlay: '8px' },
  glow: { soft: 0.35, strong: 0.7 },
  duration: { fast: '120ms', base: '200ms', slow: '420ms', wipe: '900ms' },
  ease: {
    out: 'cubic-bezier(0.22, 1, 0.36, 1)',
    inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  font: {
    ui: "'Inter Variable', system-ui, sans-serif",
    display: "'Space Grotesk Variable', 'Inter Variable', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
} as const

const kebab = (key: string): string => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

export function paletteVars(palette: Palette): Record<string, string> {
  return Object.fromEntries(Object.entries(palette).map(([k, v]) => [`--px-${kebab(k)}`, v]))
}

export function sharedVars(): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(shared.radius)) vars[`--px-radius-${k}`] = v
  for (const [k, v] of Object.entries(shared.blur)) vars[`--px-blur-${k}`] = v
  for (const [k, v] of Object.entries(shared.glow)) vars[`--px-glow-${k}`] = String(v)
  for (const [k, v] of Object.entries(shared.duration)) vars[`--px-duration-${k}`] = v
  for (const [k, v] of Object.entries(shared.ease)) vars[`--px-ease-${kebab(k)}`] = v
  for (const [k, v] of Object.entries(shared.font)) vars[`--px-font-${k}`] = v
  return vars
}

const block = (selector: string, vars: Record<string, string>): string =>
  `${selector} {\n${Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')}\n}\n`

/** The CSS served as `virtual:tokens.css`. Dark is the default; light applies on [data-theme]. */
export function tokensCss(): string {
  return [
    block(':root', { ...sharedVars(), ...paletteVars(themes.dark), 'color-scheme': 'dark' }),
    block(':root[data-theme="light"]', { ...paletteVars(themes.light), 'color-scheme': 'light' }),
  ].join('\n')
}
