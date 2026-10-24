/**
 * Colour maths for the colour picker: parsing, HSV/HSL conversions and the palettes.
 * Colours are passed around as CSS hex strings: `#rrggbb`, or `#rrggbbaa` when not fully opaque.
 */

export interface Rgba {
  r: number // 0..255
  g: number
  b: number
  a: number // 0..1
}

export interface Hsv {
  h: number // 0..360
  s: number // 0..1
  v: number // 0..1
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const byte = (v: number): string =>
  Math.round(clamp(v, 0, 255))
    .toString(16)
    .padStart(2, '0')

export function toHex({ r, g, b, a }: Rgba): string {
  const alpha = Math.round(clamp(a, 0, 1) * 255)
  return `#${byte(r)}${byte(g)}${byte(b)}${alpha < 255 ? byte(alpha) : ''}`
}

/** Reads #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() and rgba(). Anything else: null. */
export function parseColor(text: string): Rgba | null {
  const v = text.trim().toLowerCase()
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v)
  if (hex) {
    let h = hex[1] as string
    if (h.length <= 4) h = [...h].map((c) => c + c).join('')
    const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v)
  if (fn) {
    const alpha =
      fn[4] === undefined ? 1 : fn[4].endsWith('%') ? Number.parseFloat(fn[4]) / 100 : Number(fn[4])
    return {
      r: clamp(Number(fn[1]), 0, 255),
      g: clamp(Number(fn[2]), 0, 255),
      b: clamp(Number(fn[3]), 0, 255),
      a: clamp(alpha, 0, 1),
    }
  }
  return null
}

export function rgbToHsv({ r, g, b }: Rgba): Hsv {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const d = max - Math.min(R, G, B)
  let h = 0
  if (d > 0) {
    if (max === R) h = ((G - B) / d) % 6
    else if (max === G) h = (B - R) / d + 2
    else h = (R - G) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToRgb({ h, s, v }: Hsv, a = 1): Rgba {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255
  }
  return { r: f(5), g: f(3), b: f(1), a }
}

export function hslToRgb(h: number, s: number, l: number): Rgba {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255
  }
  return { r: f(0), g: f(8), b: f(4), a: 1 }
}

/** The hex with any alpha removed (for <input type="color"> and solid swatches). */
export const opaqueHex = (hex: string): string => {
  const c = parseColor(hex)
  return c ? toHex({ ...c, a: 1 }) : hex
}

/** A grid of hues from light to dark, plus a row of greys: every everyday colour within two clicks. */
export function paletteGrid(): string[][] {
  const hues = [0, 15, 30, 45, 60, 90, 120, 150, 175, 195, 215, 240, 265, 285, 310, 335]
  const levels = [0.92, 0.82, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2]
  const rows = levels.map((l) => hues.map((h) => toHex(hslToRgb(h, l > 0.85 ? 0.8 : 0.85, l))))
  const greys = hues.map((_, i) => toHex(hslToRgb(0, 0, 1 - i / (hues.length - 1))))
  return [greys, ...rows]
}

export interface NamedColour {
  /** A CSS colour keyword or an rgb() value: what the swatch paints. */
  css: string
  en: string
  ar: string
}

/** Colours by name, in English and Arabic: the CSS named colours plus common everyday names. */
export const NAMED_COLOURS: NamedColour[] = [
  { css: 'white', en: 'White', ar: 'أبيض' },
  { css: 'snow', en: 'Snow', ar: 'ثلجي' },
  { css: 'ivory', en: 'Ivory', ar: 'عاجي' },
  { css: 'rgb(250, 249, 246)', en: 'Off-white', ar: 'أوف وايت' },
  { css: 'rgb(255, 253, 208)', en: 'Cream', ar: 'كريمي' },
  { css: 'linen', en: 'Linen', ar: 'كتّاني' },
  { css: 'beige', en: 'Beige', ar: 'بيج' },
  { css: 'rgb(247, 231, 206)', en: 'Champagne', ar: 'شمبانيا' },
  { css: 'wheat', en: 'Wheat', ar: 'قمحي' },
  { css: 'rgb(194, 178, 128)', en: 'Sand', ar: 'رملي' },
  { css: 'tan', en: 'Tan', ar: 'بني فاتح' },
  { css: 'rgb(193, 154, 107)', en: 'Camel', ar: 'جملي' },
  { css: 'khaki', en: 'Khaki', ar: 'كاكي' },
  { css: 'darkkhaki', en: 'Dark khaki', ar: 'كاكي داكن' },
  { css: 'silver', en: 'Silver', ar: 'فضي' },
  { css: 'lightgray', en: 'Light grey', ar: 'رمادي فاتح' },
  { css: 'gray', en: 'Grey', ar: 'رمادي' },
  { css: 'dimgray', en: 'Dim grey', ar: 'رمادي خافت' },
  { css: 'rgb(54, 69, 79)', en: 'Charcoal', ar: 'فحمي' },
  { css: 'black', en: 'Black', ar: 'أسود' },
  { css: 'red', en: 'Red', ar: 'أحمر' },
  { css: 'crimson', en: 'Crimson', ar: 'قرمزي' },
  { css: 'rgb(224, 17, 95)', en: 'Ruby', ar: 'ياقوتي' },
  { css: 'darkred', en: 'Dark red', ar: 'أحمر داكن' },
  { css: 'rgb(128, 0, 32)', en: 'Burgundy', ar: 'عنّابي' },
  { css: 'rgb(114, 47, 55)', en: 'Wine', ar: 'خمري' },
  { css: 'maroon', en: 'Maroon', ar: 'كستنائي' },
  { css: 'firebrick', en: 'Brick red', ar: 'طوبي' },
  { css: 'indianred', en: 'Indian red', ar: 'أحمر هندي' },
  { css: 'tomato', en: 'Tomato', ar: 'طماطمي' },
  { css: 'coral', en: 'Coral', ar: 'مرجاني' },
  { css: 'salmon', en: 'Salmon', ar: 'سلموني' },
  { css: 'rgb(226, 114, 91)', en: 'Terracotta', ar: 'تيراكوتا' },
  { css: 'orangered', en: 'Orange red', ar: 'أحمر برتقالي' },
  { css: 'orange', en: 'Orange', ar: 'برتقالي' },
  { css: 'darkorange', en: 'Dark orange', ar: 'برتقالي داكن' },
  { css: 'rgb(255, 191, 0)', en: 'Amber', ar: 'كهرماني' },
  { css: 'peachpuff', en: 'Peach', ar: 'خوخي' },
  { css: 'rgb(204, 119, 34)', en: 'Ochre', ar: 'أوكر' },
  { css: 'rgb(184, 115, 51)', en: 'Copper', ar: 'نحاسي' },
  { css: 'rgb(205, 127, 50)', en: 'Bronze', ar: 'برونزي' },
  { css: 'gold', en: 'Gold', ar: 'ذهبي' },
  { css: 'rgb(183, 110, 121)', en: 'Rose gold', ar: 'ذهبي وردي' },
  { css: 'goldenrod', en: 'Goldenrod', ar: 'ذهبي عسلي' },
  { css: 'rgb(225, 173, 1)', en: 'Mustard', ar: 'خردلي' },
  { css: 'yellow', en: 'Yellow', ar: 'أصفر' },
  { css: 'lemonchiffon', en: 'Lemon', ar: 'ليموني فاتح' },
  { css: 'lightyellow', en: 'Light yellow', ar: 'أصفر فاتح' },
  { css: 'rgb(175, 111, 51)', en: 'Caramel', ar: 'كراميل' },
  { css: 'chocolate', en: 'Chocolate', ar: 'شوكولاتة' },
  { css: 'rgb(111, 78, 55)', en: 'Coffee', ar: 'قهوة' },
  { css: 'rgb(110, 58, 36)', en: 'Date brown', ar: 'تمري' },
  { css: 'brown', en: 'Brown', ar: 'بني' },
  { css: 'saddlebrown', en: 'Saddle brown', ar: 'بني جلدي' },
  { css: 'sienna', en: 'Sienna', ar: 'بني محمر' },
  { css: 'peru', en: 'Light brown', ar: 'بني فاتح دافئ' },
  { css: 'sandybrown', en: 'Sandy brown', ar: 'بني رملي' },
  { css: 'burlywood', en: 'Wood', ar: 'خشبي' },
  { css: 'rosybrown', en: 'Rosy brown', ar: 'بني وردي' },
  { css: 'green', en: 'Green', ar: 'أخضر' },
  { css: 'darkgreen', en: 'Dark green', ar: 'أخضر داكن' },
  { css: 'forestgreen', en: 'Forest green', ar: 'أخضر غابي' },
  { css: 'rgb(80, 200, 120)', en: 'Emerald', ar: 'زمردي' },
  { css: 'rgb(0, 168, 107)', en: 'Jade', ar: 'يشمي' },
  { css: 'seagreen', en: 'Sea green', ar: 'أخضر بحري' },
  { css: 'olive', en: 'Olive', ar: 'زيتوني' },
  { css: 'darkolivegreen', en: 'Dark olive', ar: 'زيتوني داكن' },
  { css: 'olivedrab', en: 'Olive drab', ar: 'زيتوني باهت' },
  { css: 'rgb(147, 197, 114)', en: 'Pistachio', ar: 'فستقي' },
  { css: 'rgb(141, 182, 0)', en: 'Apple green', ar: 'تفاحي' },
  { css: 'lime', en: 'Lime', ar: 'أخضر ليموني' },
  { css: 'limegreen', en: 'Lime green', ar: 'أخضر زاهٍ' },
  { css: 'lawngreen', en: 'Grass green', ar: 'أخضر عشبي' },
  { css: 'chartreuse', en: 'Chartreuse', ar: 'أخضر مصفر' },
  { css: 'yellowgreen', en: 'Yellow green', ar: 'أخضر أصفر' },
  { css: 'rgb(57, 255, 20)', en: 'Neon green', ar: 'أخضر نيون' },
  { css: 'rgb(152, 255, 152)', en: 'Mint', ar: 'نعناعي' },
  { css: 'mintcream', en: 'Mint cream', ar: 'نعناعي كريمي' },
  { css: 'palegreen', en: 'Pale green', ar: 'أخضر شاحب' },
  { css: 'lightgreen', en: 'Light green', ar: 'أخضر فاتح' },
  { css: 'springgreen', en: 'Spring green', ar: 'أخضر ربيعي' },
  { css: 'darkseagreen', en: 'Sage', ar: 'مريمية' },
  { css: 'teal', en: 'Teal', ar: 'أزرق مخضر' },
  { css: 'rgb(0, 95, 106)', en: 'Petrol', ar: 'بترولي' },
  { css: 'darkcyan', en: 'Dark cyan', ar: 'سماوي داكن' },
  { css: 'lightseagreen', en: 'Light sea green', ar: 'أخضر بحري فاتح' },
  { css: 'turquoise', en: 'Turquoise', ar: 'فيروزي' },
  { css: 'darkturquoise', en: 'Dark turquoise', ar: 'فيروزي داكن' },
  { css: 'mediumturquoise', en: 'Medium turquoise', ar: 'فيروزي متوسط' },
  { css: 'paleturquoise', en: 'Pale turquoise', ar: 'فيروزي شاحب' },
  { css: 'aquamarine', en: 'Aquamarine', ar: 'زبرجدي' },
  { css: 'cyan', en: 'Cyan', ar: 'سماوي' },
  { css: 'lightcyan', en: 'Light cyan', ar: 'سماوي فاتح' },
  { css: 'azure', en: 'Azure', ar: 'لازوردي' },
  { css: 'skyblue', en: 'Sky blue', ar: 'أزرق سماوي' },
  { css: 'rgb(137, 207, 240)', en: 'Baby blue', ar: 'بيبي بلو' },
  { css: 'lightblue', en: 'Light blue', ar: 'أزرق فاتح' },
  { css: 'powderblue', en: 'Powder blue', ar: 'أزرق بودري' },
  { css: 'deepskyblue', en: 'Deep sky blue', ar: 'أزرق سماوي عميق' },
  { css: 'dodgerblue', en: 'Bright blue', ar: 'أزرق ساطع' },
  { css: 'cornflowerblue', en: 'Cornflower', ar: 'أزرق زهري' },
  { css: 'steelblue', en: 'Steel blue', ar: 'أزرق فولاذي' },
  { css: 'lightsteelblue', en: 'Light steel blue', ar: 'أزرق فولاذي فاتح' },
  { css: 'cadetblue', en: 'Cadet blue', ar: 'أزرق رمادي' },
  { css: 'blue', en: 'Blue', ar: 'أزرق' },
  { css: 'royalblue', en: 'Royal blue', ar: 'أزرق ملكي' },
  { css: 'rgb(15, 82, 186)', en: 'Sapphire', ar: 'زفيري' },
  { css: 'mediumblue', en: 'Medium blue', ar: 'أزرق متوسط' },
  { css: 'darkblue', en: 'Dark blue', ar: 'أزرق داكن' },
  { css: 'navy', en: 'Navy', ar: 'كحلي' },
  { css: 'midnightblue', en: 'Midnight blue', ar: 'أزرق ليلي' },
  { css: 'slateblue', en: 'Slate blue', ar: 'أزرق أردوازي' },
  { css: 'slategray', en: 'Slate grey', ar: 'رمادي أردوازي' },
  { css: 'darkslategray', en: 'Dark slate', ar: 'أردوازي داكن' },
  { css: 'indigo', en: 'Indigo', ar: 'نيلي' },
  { css: 'rebeccapurple', en: 'Royal purple', ar: 'بنفسجي ملكي' },
  { css: 'purple', en: 'Purple', ar: 'بنفسجي' },
  { css: 'darkviolet', en: 'Dark violet', ar: 'بنفسجي داكن' },
  { css: 'blueviolet', en: 'Blue violet', ar: 'بنفسجي مزرق' },
  { css: 'mediumpurple', en: 'Medium purple', ar: 'بنفسجي متوسط' },
  { css: 'violet', en: 'Violet', ar: 'بنفسجي فاتح' },
  { css: 'rgb(200, 162, 200)', en: 'Lilac', ar: 'ليلكي' },
  { css: 'rgb(224, 176, 255)', en: 'Mauve', ar: 'موف' },
  { css: 'lavender', en: 'Lavender', ar: 'خزامي' },
  { css: 'thistle', en: 'Thistle', ar: 'شوكي' },
  { css: 'plum', en: 'Plum', ar: 'برقوقي' },
  { css: 'orchid', en: 'Orchid', ar: 'أوركيدي' },
  { css: 'darkorchid', en: 'Dark orchid', ar: 'أوركيدي داكن' },
  { css: 'darkmagenta', en: 'Dark magenta', ar: 'أرجواني داكن' },
  { css: 'magenta', en: 'Magenta', ar: 'أرجواني' },
  { css: 'fuchsia', en: 'Fuchsia', ar: 'فوشيا' },
  { css: 'rgb(255, 16, 240)', en: 'Neon pink', ar: 'وردي نيون' },
  { css: 'deeppink', en: 'Deep pink', ar: 'وردي عميق' },
  { css: 'hotpink', en: 'Hot pink', ar: 'وردي فاقع' },
  { css: 'mediumvioletred', en: 'Raspberry', ar: 'توتي' },
  { css: 'palevioletred', en: 'Old rose', ar: 'وردي قديم' },
  { css: 'pink', en: 'Pink', ar: 'وردي' },
  { css: 'lightpink', en: 'Light pink', ar: 'زهري فاتح' },
  { css: 'mistyrose', en: 'Misty rose', ar: 'وردي ضبابي' },
  { css: 'lavenderblush', en: 'Blush', ar: 'وردي خجول' },
  { css: 'lightcoral', en: 'Light coral', ar: 'مرجاني فاتح' },
  { css: 'darksalmon', en: 'Dark salmon', ar: 'سلموني داكن' },
  { css: 'lightsalmon', en: 'Light salmon', ar: 'سلموني فاتح' },
  { css: 'bisque', en: 'Biscuit', ar: 'بسكويتي' },
  { css: 'moccasin', en: 'Moccasin', ar: 'جلدي فاتح' },
  { css: 'navajowhite', en: 'Navajo white', ar: 'أبيض رملي' },
  { css: 'papayawhip', en: 'Papaya', ar: 'بابايا' },
  { css: 'blanchedalmond', en: 'Almond', ar: 'لوزي' },
  { css: 'cornsilk', en: 'Corn silk', ar: 'حريري' },
  { css: 'seashell', en: 'Seashell', ar: 'صدفي' },
  { css: 'oldlace', en: 'Old lace', ar: 'دانتيل' },
  { css: 'floralwhite', en: 'Floral white', ar: 'أبيض زهري' },
  { css: 'honeydew', en: 'Honeydew', ar: 'شمامي' },
  { css: 'aliceblue', en: 'Ice blue', ar: 'أزرق جليدي' },
  { css: 'ghostwhite', en: 'Ghost white', ar: 'أبيض مزرق' },
  { css: 'whitesmoke', en: 'White smoke', ar: 'أبيض دخاني' },
  { css: 'gainsboro', en: 'Pale grey', ar: 'رمادي شاحب' },
]

/** Search by English or Arabic name; Arabic matching ignores the hamza and taa-marbuta spelling variants. */
export function searchNamed(query: string): NamedColour[] {
  const fold = (s: string) =>
    s
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[ً-ْ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  const q = fold(query)
  if (!q) return NAMED_COLOURS
  return NAMED_COLOURS.filter((c) => fold(c.en).includes(q) || fold(c.ar).includes(q) || c.css.includes(q))
}
