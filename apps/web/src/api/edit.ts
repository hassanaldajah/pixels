import type { EditState } from '../engine/types'
import { outputColors } from '../tokens'
import { RejectionError, readAccessToken } from './client'
import type { Rejection, UploadResult } from './types'

export interface ExportOptions {
  format: 'png' | 'jpeg' | 'webp' | 'avif' | 'tiff'
  quality: number
  lossless: boolean
  bit_depth: 8 | 16
  profile: 'sRGB' | 'Display P3'
  keep_camera_info: boolean
  keep_gps: boolean
  background: string
  dpi: number | null
}

export const defaultExportOptions = (): ExportOptions => ({
  format: 'png',
  quality: 90,
  lossless: false,
  bit_depth: 8,
  profile: 'sRGB',
  keep_camera_info: false,
  keep_gps: false,
  background: outputColors.white,
  dpi: null,
})

export interface Capabilities {
  formats: Record<ExportOptions['format'], boolean>
  platforms: string[]
  size_presets: { id: string; label: string; group: string; w: number; h: number }[]
}

export interface Recipe {
  name: string
  orientation: ({ type: 'rotate90'; turns: 1 | 2 | 3 } | { type: 'flip'; axis: 'h' | 'v' })[]
  layout:
    | { type: 'none' }
    | { type: 'pad_square'; fill: string | null }
    | {
        type: 'fit'
        w: number
        h: number
        mode: 'cover' | 'contain'
        fill: string | null
        focus_x: number
        focus_y: number
      }
  adjust: EditState['adjust']
  export: ExportOptions
  suffix: string
}

export interface ProjectFile {
  format: string
  version: number
  name: string
  history: { label: string; state: EditState }[]
  index: number
}

const headers = (extra: Record<string, string> = {}): Record<string, string> => {
  const token = readAccessToken()
  return { ...(token ? { 'X-Pixels-Token': token } : {}), ...extra }
}

async function failure(response: Response): Promise<RejectionError> {
  let body: Partial<Rejection> & { detail?: unknown } = {}
  try {
    body = (await response.json()) as typeof body
  } catch {
    /* not JSON */
  }
  const detail = Array.isArray(body.detail)
    ? (body.detail as { loc?: unknown[]; msg?: string }[])
        .map((d) => `${(d.loc ?? []).slice(1).join('.')}: ${d.msg ?? ''}`)
        .join('; ')
    : undefined
  return new RejectionError({
    code: body.code ?? 'request_failed',
    step: body.step ?? 'size',
    message: body.message ?? detail ?? `The request failed (HTTP ${response.status}).`,
    steps: body.steps ?? [],
  })
}

async function post(path: string, body: unknown, extra: Record<string, string> = {}): Promise<Response> {
  const response = await fetch(path, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', ...extra }),
    body: JSON.stringify(body),
  })
  if (!response.ok) throw await failure(response)
  return response
}

export async function fetchCapabilities(): Promise<Capabilities> {
  const response = await fetch('/api/capabilities', { headers: headers() })
  if (!response.ok) throw await failure(response)
  return (await response.json()) as Capabilities
}

export async function exportImage(
  id: string,
  state: EditState,
  options: ExportOptions,
): Promise<{ blob: Blob; filename: string }> {
  return download(await post(`/api/images/${id}/export`, { state, options }))
}

export async function exportIcons(
  id: string,
  state: EditState,
  body: { platforms: string[]; background: string; fit: 'cover' | 'contain' },
) {
  return download(await post(`/api/images/${id}/presets/icons`, { state, ...body }))
}

export async function exportSizes(id: string, state: EditState, body: object) {
  return download(await post(`/api/images/${id}/presets/sizes`, { state, ...body }))
}

export async function runBatch(imageIds: string[], recipe: Recipe, jobId: string) {
  return download(await post('/api/batch/run', { image_ids: imageIds, recipe }, { 'X-Job-Id': jobId }))
}

export async function detectHorizon(id: string): Promise<{ angle: number; confidence: number }> {
  const response = await post(`/api/images/${id}/horizon`, {})
  return (await response.json()) as { angle: number; confidence: number }
}

export async function saveProject(id: string, project: ProjectFile) {
  return download(await post('/api/projects/save', { image_id: id, project }))
}

export async function openProject(
  file: File,
  jobId: string,
): Promise<UploadResult & { project: ProjectFile & { safe_exif?: unknown } }> {
  const response = await fetch('/api/projects/open', {
    method: 'POST',
    headers: headers({
      'Content-Type': 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name),
      'X-Job-Id': jobId,
    }),
    body: file,
  })
  if (!response.ok) throw await failure(response)
  return (await response.json()) as UploadResult & { project: ProjectFile }
}

async function download(response: Response): Promise<{ blob: Blob; filename: string }> {
  const disposition = response.headers.get('content-disposition') ?? ''
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'pixels-export'
  return { blob: await response.blob(), filename }
}

/** Hand a blob to the browser as a file download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export interface PixelPaletteInfo {
  id: string
  label: string
  colors: string[]
}

export async function fetchPixelPalettes(): Promise<PixelPaletteInfo[]> {
  const response = await fetch('/api/pixelart/palettes', { headers: headers() })
  if (!response.ok) throw await failure(response)
  return ((await response.json()) as { palettes: PixelPaletteInfo[] }).palettes
}

/** A .hex or GIMP .gpl palette file, parsed on the server (plain text only). */
export async function importPixelPalette(file: File): Promise<string[]> {
  const response = await fetch('/api/pixelart/import-palette', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'text/plain' }),
    body: await file.text(),
  })
  if (!response.ok) throw await failure(response)
  return ((await response.json()) as { colors: string[] }).colors
}

export interface PixelPreview {
  url: string
  info: { grid: [number, number]; colors: number; palette: string[]; notes: string[]; size: [number, number] }
}

export async function pixelArtPreview(
  id: string,
  state: EditState,
  signal: AbortSignal,
): Promise<PixelPreview> {
  const response = await fetch(`/api/images/${id}/pixelart/preview`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ state, max_edge: 2048 }),
    signal,
  })
  if (!response.ok) throw await failure(response)
  const info = JSON.parse(response.headers.get('x-pixelart-info') ?? '{}') as PixelPreview['info']
  return { url: URL.createObjectURL(await response.blob()), info }
}

export interface ErasedImage {
  id: string
  url: string
  name: string
  width: number
  height: number
  has_alpha: boolean
}

/** Remove the painted area (bit-packed mask, 1 = erase). The result is a new working copy. */
export async function eraseObject(
  id: string,
  body: {
    state: EditState
    mask_w: number
    mask_h: number
    mask_bits: string
    quality: 'fast' | 'high'
    grow: number
    feather: number
  },
): Promise<UploadResult> {
  return (await (await post(`/api/images/${id}/erase`, body)).json()) as UploadResult
}

export type RetouchKind = 'cutout' | 'smooth' | 'upscale'

/** Cut out a plain background, smooth skin or enlarge. The result is a new working copy. */
export async function retouchImage(
  id: string,
  kind: RetouchKind,
  state: EditState,
  options: Record<string, number | boolean | string | null>,
): Promise<UploadResult> {
  return (await (
    await post(`/api/images/${id}/retouch/${kind}`, { state, ...options })
  ).json()) as UploadResult
}
