/**
 * Fast client-side pre-check for UX only. The backend Security Gate is the authority: this just
 * saves a round trip for files that are obviously wrong and gives a friendlier first message.
 */

export const ALLOWED_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.jpe',
  '.jfif',
  '.webp',
  '.tif',
  '.tiff',
  '.bmp',
  '.heic',
  '.heif',
  '.avif',
] as const

export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.join(',')
export const DEFAULT_MAX_BYTES = 200 * 1024 * 1024
export const DEFAULT_MAX_BATCH = 100

export type Kind = 'png' | 'jpeg' | 'webp' | 'tiff' | 'bmp' | 'heif' | 'avif' | 'unknown'

export function detectKind(head: Uint8Array): Kind {
  const at = (i: number) => head[i] ?? -1
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to))
  if (head.length >= 8 && at(0) === 0x89 && ascii(1, 4) === 'PNG') return 'png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpeg'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  if (['II*\0', 'MM\0*', 'II+\0', 'MM\0+'].includes(ascii(0, 4))) return 'tiff'
  if (ascii(0, 2) === 'BM') return 'bmp'
  if (ascii(4, 8) === 'ftyp') {
    const brands = ascii(8, Math.min(head.length, 32))
    if (/avif|avis/.test(brands)) return 'avif'
    if (/hei[cxms]|hev[cxms]|mif1|msf1/.test(brands)) return 'heif'
  }
  return 'unknown'
}

export interface PrecheckLimits {
  maxBytes: number
}

export type PrecheckResult = { ok: true; kind: Kind } | { ok: false; reason: string }

export async function precheck(
  file: File,
  limits: PrecheckLimits = { maxBytes: DEFAULT_MAX_BYTES },
): Promise<PrecheckResult> {
  if (file.size === 0) return { ok: false, reason: `“${file.name}” is empty.` }
  if (file.size > limits.maxBytes) {
    const mb = (n: number) => Math.round(n / 1024 / 1024)
    return {
      ok: false,
      reason: `“${file.name}” is ${mb(file.size)} MB; the limit is ${mb(limits.maxBytes)} MB.`,
    }
  }
  const dot = file.name.lastIndexOf('.')
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : ''
  if (ext && !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    const svg = ext === '.svg' ? ' SVG can carry scripts, so export it as PNG first.' : ''
    return { ok: false, reason: `“${file.name}”: ${ext} files are not accepted.${svg}` }
  }
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  const kind = detectKind(head)
  if (kind === 'unknown') {
    return { ok: false, reason: `“${file.name}” does not look like a supported image.` }
  }
  return { ok: true, kind }
}
