/** WCAG contrast helpers, used by the palette test and to read CSS colours for WebGL. */

export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const n = Number.parseInt(full.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function channel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Reads a CSS colour (hex or rgb()/rgba()) into 0..1 floats for a shader uniform. */
export function cssColorToRgba(value: string): [number, number, number, number] {
  const v = value.trim()
  if (v.startsWith('#')) {
    const [r, g, b] = parseHex(v)
    return [r / 255, g / 255, b / 255, 1]
  }
  const m = v.match(/rgba?\(([^)]+)\)/)
  if (m?.[1]) {
    const p = m[1].split(',').map((x) => Number.parseFloat(x))
    return [(p[0] ?? 0) / 255, (p[1] ?? 0) / 255, (p[2] ?? 0) / 255, p[3] ?? 1]
  }
  return [0, 0, 0, 1]
}
