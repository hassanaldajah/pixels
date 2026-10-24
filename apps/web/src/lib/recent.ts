/**
 * Recent work, so a closed window (or a crash) never loses an edit: the open picture with its whole edit
 * history, and every video project. Kept in this browser's IndexedDB (room for long histories), newest first.
 * The pictures and videos themselves stay on this computer's Pixels store (14 days for pictures, 30 for media).
 */
import { useSyncExternalStore } from 'react'

export interface RecentPhoto {
  key: string // photo:<image id>
  kind: 'photo'
  name: string
  imageId: string
  history: unknown[]
  index: number
  thumb: string // small JPEG data URL
  updatedAt: number
}

export interface RecentVideo {
  key: string // video:<project id>
  kind: 'video'
  name: string
  project: unknown
  duration: number
  updatedAt: number
}

export type RecentItem = RecentPhoto | RecentVideo

const DB = 'pixels'
const STORE = 'recent'
const KEEP = 12

let db: Promise<IDBDatabase> | null = null
function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return db
}

function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const request = f(d.transaction(STORE, mode).objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }),
  )
}

let items: RecentItem[] = []
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

export async function refreshRecent(): Promise<void> {
  try {
    const all = (await run<RecentItem[]>('readonly', (s) => s.getAll() as IDBRequest<RecentItem[]>)) ?? []
    items = all.sort((a, b) => b.updatedAt - a.updatedAt)
    // keep the newest few
    for (const old of items.slice(KEEP)) await run('readwrite', (s) => s.delete(old.key))
    items = items.slice(0, KEEP)
  } catch {
    items = [] // private window or blocked storage: no recent list, nothing breaks
  }
  notify()
}

export async function saveRecent(item: RecentItem): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(item))
    await refreshRecent()
  } catch {
    /* storage unavailable */
  }
}

export async function forgetRecent(key: string): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(key))
  } finally {
    await refreshRecent()
  }
}

export function useRecent(): RecentItem[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    () => items,
  )
}

/** A small JPEG of a picture for the list. */
export function thumbnailOf(bitmap: ImageBitmap, side = 160): string {
  const k = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * k))
  canvas.height = Math.max(1, Math.round(bitmap.height * k))
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.75)
}
