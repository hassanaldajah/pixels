import type { Rejection, SecurityStatus, SystemInfo, UploadResult } from './types'

const TOKEN_KEY = 'pixels.token'

/** LAN mode: the start script prints a URL ending in #token=…; keep it for this tab only. */
export function readAccessToken(): string | null {
  try {
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('token')
    if (fromHash) {
      sessionStorage.setItem(TOKEN_KEY, fromHash)
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

const authHeaders = (): Record<string, string> => {
  const token = readAccessToken()
  return token ? { 'X-Pixels-Token': token } : {}
}

export class RejectionError extends Error {
  constructor(readonly rejection: Rejection) {
    super(rejection.message)
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: authHeaders() })
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return (await response.json()) as T
}

export const fetchSystem = () => getJson<SystemInfo>('/api/system')
export const fetchSecurityStatus = () => getJson<SecurityStatus>('/api/security/status')

export async function createBatch(count: number): Promise<string> {
  const response = await fetch('/api/batches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ count }),
  })
  const body = (await response.json()) as { id?: string } & Partial<Rejection>
  if (!response.ok || !body.id) {
    throw new RejectionError({
      code: body.code ?? 'batch_failed',
      step: body.step ?? 'size',
      message: body.message ?? 'The batch could not be created.',
      steps: body.steps ?? [],
    })
  }
  return body.id
}

export interface UploadOptions {
  jobId: string
  batchId?: string
  onUploadProgress?: (fraction: number) => void
}

/** Raw-body upload with real byte progress. The server streams it to disk with a hard cap. */
export function uploadImage(file: File, options: UploadOptions): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const query = options.batchId ? `?batch=${encodeURIComponent(options.batchId)}` : ''
    xhr.open('POST', `/api/images${query}`)
    xhr.responseType = 'json'
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name))
    xhr.setRequestHeader('X-Job-Id', options.jobId)
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) options.onUploadProgress?.(e.loaded / e.total)
    }
    xhr.onerror = () =>
      reject(
        new RejectionError({
          code: 'network',
          step: 'size',
          message: 'Could not reach the Pixels backend. Is it running?',
          steps: [],
        }),
      )
    xhr.onload = () => {
      const body = xhr.response as (UploadResult & Partial<Rejection>) | null
      if (xhr.status === 201 && body) resolve(body)
      else
        reject(
          new RejectionError({
            code: body?.code ?? 'rejected',
            step: body?.step ?? 'size',
            message: body?.message ?? `The upload failed (HTTP ${xhr.status}).`,
            steps: body?.steps ?? [],
          }),
        )
    }
    xhr.send(file)
  })
}

/** What the media Security Gate returns for a video or audio file. */
export interface MediaUpload {
  id: string
  url: string
  name: string
  kind: string
  mime: string
  video_codecs: string[]
  audio_codecs: string[]
  width: number
  height: number
  duration: number
  metadata_removed: string[]
  gate: { notices: string[] }
}

/** Video and audio go through the media gate (/api/media); the same raw-body upload with progress. */
export function uploadMedia(file: File, options: UploadOptions): Promise<MediaUpload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/media')
    xhr.responseType = 'json'
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name))
    xhr.setRequestHeader('X-Job-Id', options.jobId)
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) options.onUploadProgress?.(e.loaded / e.total)
    }
    xhr.onerror = () =>
      reject(
        new RejectionError({
          code: 'network',
          step: 'size',
          message: 'Could not reach the Pixels backend. Is it running?',
          steps: [],
        }),
      )
    xhr.onload = () => {
      const body = xhr.response as (MediaUpload & Partial<Rejection>) | null
      if (xhr.status === 201 && body) resolve(body)
      else
        reject(
          new RejectionError({
            code: body?.code ?? 'rejected',
            step: body?.step ?? 'size',
            message: body?.message ?? `The upload failed (HTTP ${xhr.status}).`,
            steps: body?.steps ?? [],
          }),
        )
    }
    xhr.send(file)
  })
}

/** Headers for reading media (LAN mode needs the access token). */
export const mediaHeaders = (): Record<string, string> => authHeaders()

export async function fetchImageBlob(url: string): Promise<Blob> {
  const response = await fetch(url, { headers: authHeaders() })
  if (!response.ok) throw new Error(`Could not load the image (HTTP ${response.status}).`)
  return response.blob()
}

export function jobsSocketUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const token = readAccessToken()
  return `${scheme}://${window.location.host}/ws/jobs${token ? `?token=${encodeURIComponent(token)}` : ''}`
}
