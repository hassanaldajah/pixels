import { useEffect, useRef, useSyncExternalStore } from 'react'
import { create } from 'zustand'
import type { Selection } from '../engine/types'
import { committedState, useEdit } from '../state/edit'
import { useImage } from '../state/image'
import { useView } from '../state/view'
import { getLiveView, subscribeLiveView } from './liveView'
import { imageToScreen } from './math'

/** Waiting for a click on the picture to make a magic-wand selection. */
export const useWandPick = create<{ picking: boolean; set: (picking: boolean) => void }>((set) => ({
  picking: false,
  set: (picking) => set({ picking }),
}))

/** Select everything around the clicked point whose colour is close to it. Esc cancels. */
export function WandOverlay() {
  const picking = useWandPick((s) => s.picking)
  const image = useImage((s) => s.current)
  const view = useSyncExternalStore(subscribeLiveView, getLiveView)
  const { viewport, dpr, image: size } = useView()
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!picking) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useWandPick.getState().set(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picking])

  if (!picking || !image || !size) return null
  const topLeft = imageToScreen({ x: 0, y: 0 }, view, viewport, dpr)
  const bottomRight = imageToScreen({ x: size.w, y: size.h }, view, viewport, dpr)
  return (
    <div
      ref={box}
      className="eraser-layer fill-layer"
      style={{
        left: topLeft.x,
        top: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        const rect = box.current?.getBoundingClientRect()
        if (!rect) return
        const state = committedState()
        const previous = state.selection?.kind === 'wand' ? state.selection : null
        const selection: Selection = {
          kind: 'wand',
          x: Math.floor(((e.clientX - rect.left) / rect.width) * size.w),
          y: Math.floor(((e.clientY - rect.top) / rect.height) * size.h),
          w: 1,
          h: 1,
          points: [],
          feather: previous?.feather ?? 0,
          invert: false,
          tolerance: previous?.tolerance ?? 20,
          contiguous: previous?.contiguous ?? true,
        }
        useEdit.getState().commit('Magic wand', { ...state, selection })
        useWandPick.getState().set(false)
      }}
    />
  )
}
