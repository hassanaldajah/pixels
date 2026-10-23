import { guide } from './ar/guide'
import { server, serverPatterns } from './ar/server'
import { ui } from './ar/ui'

/** English text -> Arabic (Modern Standard Arabic). The three parts are split by where the text comes from. */
const BANDS: Record<string, string> = {
  red: 'الأحمر',
  orange: 'البرتقالي',
  yellow: 'الأصفر',
  green: 'الأخضر',
  aqua: 'السماوي',
  blue: 'الأزرق',
  purple: 'البنفسجي',
  magenta: 'الأرجواني',
}
/** The eight colour bands of the HSL controls: "red hue", "red saturation", "red luminance" and so on. */
const hsl: Record<string, string> = {}
for (const [en, name] of Object.entries(BANDS)) {
  hsl[en] = name
  hsl[`${en} hue`] = `تدرّج ${name}`
  hsl[`${en} saturation`] = `تشبّع ${name}`
  hsl[`${en} luminance`] = `إضاءة ${name}`
}

/** A bracket holding only Latin text, numbers or file endings, like "(.zip)" or "(Ctrl+Z)", is kept as one left-to-right piece. */
const isolate = (text: string): string => text.replace(/\([^()؀-ۿ]*[A-Za-z0-9.][^()؀-ۿ]*\)/g, (m) => `⁦${m}⁩`)

export const ar: Record<string, string> = Object.fromEntries(
  Object.entries({ ...server, ...guide, ...ui, ...hsl }).map(([en, arabic]) => [en, isolate(arabic)]),
)

/** Texts with values inside them: [pattern, Arabic with $1, $2 for the captured parts (translated when known)]. */
export const arPatterns: Array<[RegExp, string]> = serverPatterns
