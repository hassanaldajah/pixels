/**
 * Keeps the open picture and its edit history in the recent list, a moment after each change, and brings
 * them back when a recent item is opened. The picture itself is the Security-Gate copy on this computer.
 */
import { fetchImageBlob } from '../api/client'
import type { UploadResult } from '../api/types'
import { useEdit, type Snapshot } from '../state/edit'
import { useImage } from '../state/image'
import { useUi } from '../state/ui'
import { useVideo } from '../video/store'
import type { Project } from '../video/model'
import { forgetRecent, refreshRecent, saveRecent, thumbnailOf, type RecentItem } from './recent'

const thumbs = new Map<string, string>()
let timer = 0

function savePhoto(): void {
  const image = useImage.getState().current
  if (!image) return
  const { history, index } = useEdit.getState()
  let thumb = thumbs.get(image.id)
  if (!thumb) {
    thumb = thumbnailOf(image.bitmap)
    thumbs.set(image.id, thumb)
  }
  void saveRecent({
    key: `photo:${image.id}`,
    kind: 'photo',
    name: image.name,
    imageId: image.id,
    history,
    index,
    thumb,
    updatedAt: Date.now(),
  })
}

/** Start watching for changes. Returns the function that stops it. */
export function installAutosave(): () => void {
  void refreshRecent()
  const later = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(savePhoto, 800)
  }
  const offEdit = useEdit.subscribe((s, prev) => {
    if (s.history !== prev.history || s.index !== prev.index) later()
  })
  const offImage = useImage.subscribe((s, prev) => {
    if (s.current !== prev.current && s.current) later()
  })
  return () => {
    offEdit()
    offImage()
    window.clearTimeout(timer)
  }
}

export type OpenResult = 'opened' | 'missing'

/** Open a recent item: a picture with its history, or a video project. */
export async function openRecent(item: RecentItem): Promise<OpenResult> {
  if (item.kind === 'video') {
    useVideo.getState().open(item.project as Project, 'Open')
    useUi.getState().set({ mode: 'video' })
    return 'opened'
  }
  const response = await fetch(`/api/images/${item.imageId}/info`)
  if (!response.ok) {
    await forgetRecent(item.key) // the 14 days are over: the picture is no longer on this computer
    return 'missing'
  }
  const info = (await response.json()) as Record<string, unknown>
  const result = {
    id: item.imageId,
    url: `/api/images/${item.imageId}`,
    name: String(info.name ?? item.name),
    width: Number(info.width),
    height: Number(info.height),
    has_alpha: Boolean(info.has_alpha),
    gate: info.gate,
    meta: info,
  } as unknown as UploadResult
  await fetchImageBlob(result.url) // fails early if the file was removed by hand
  useUi.getState().set({ mode: 'photo' })
  useImage.getState().close() // frees the previous picture and its undo versions
  await useImage.getState().openDerived(result)
  useEdit.getState().reset(item.history as Snapshot[], item.index)
  return 'opened'
}
