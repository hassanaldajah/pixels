import { useEffect, useRef, useState } from 'react'
import { FrameMonitor } from '../lib/perf'
import { takesText } from '../lib/shortcuts'
import { useImage } from '../state/image'
import { useUi } from '../state/ui'
import { useView } from '../state/view'
import { setLiveView, useCursor } from './liveView'
import { guideTargets, imageToScreen, screenToImage, snapGuide, zoomAt, type Point, type View } from './math'
import { GlViewport } from './renderer'
import { useEngine } from './useEngine'
import { EraserOverlay } from './EraserOverlay'
import { MiniMap } from './MiniMap'
import { PixelArtOverlay } from './PixelArtOverlay'
import { Rulers, RULER_SIZE } from './Rulers'
import { TransformOverlay } from './TransformOverlay'

const EASE_RATE = 18 // 1/s; higher is snappier
const GUIDE_HIT = 5 // css px
const WHEEL_SENSITIVITY = 0.0015
const PINCH_SENSITIVITY = 0.01

type Drag = { kind: 'pan'; x: number; y: number } | { kind: 'guide'; axis: 'x' | 'y'; index: number } | null

const sameView = (a: View, b: View, eps = 1e-4) =>
  Math.abs(Math.log(a.zoom / b.zoom)) < eps &&
  Math.abs(a.panX - b.panX) < 0.01 &&
  Math.abs(a.panY - b.panY) < 0.01

export function Viewport({ onGlError }: { onGlError: (message: string) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const gl = useRef<GlViewport | null>(null)
  const live = useRef<View>({ zoom: 1, panX: 0, panY: 0 })
  const dirty = useRef(true)
  const drag = useRef<Drag>(null)
  const space = useRef(false)
  const touches = useRef(new Map<number, Point>())
  const pinch = useRef<{ distance: number } | null>(null)
  const image = useImage((s) => s.current)
  const [cursor, setCursor] = useState('default')

  // --- renderer lifecycle ---------------------------------------------------------------
  useEffect(() => {
    const element = canvas.current
    const container = box.current
    if (!element || !container) return
    let renderer: GlViewport
    try {
      renderer = new GlViewport(element)
    } catch (error) {
      onGlError(error instanceof Error ? error.message : 'WebGL could not start.')
      return
    }
    gl.current = renderer

    const resize = () => {
      // The layout size, not getBoundingClientRect(): that one includes CSS transforms, and the app's opening
      // animation scales the workspace from 97% to 100%, which left the canvas sized 3% too small for good.
      const width = container.clientWidth
      const height = container.clientHeight
      const dpr = window.devicePixelRatio || 1
      renderer.resize(width, height, dpr)
      useView.getState().setViewport({ w: width, h: height }, dpr)
      dirty.current = true
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    window.addEventListener('resize', resize) // devicePixelRatio changes with browser zoom
    resize()

    const monitor = new FrameMonitor((reduced) => {
      if (useUi.getState().reduceEffects !== reduced) useUi.getState().set({ reduceEffects: reduced })
    })
    let last = performance.now()
    let frame = 0
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const state = useView.getState()
      const target = state.target
      const current = live.current
      if (!sameView(current, target)) {
        let next: View
        if (drag.current?.kind === 'pan') next = target
        else if (state.mode === 'anchor' && state.anchor) {
          const k = 1 - Math.exp(-dt * EASE_RATE)
          const lz = Math.log(current.zoom)
          const lt = Math.log(target.zoom)
          const zoom = Math.abs(lt - lz) < 0.002 ? target.zoom : Math.exp(lz + (lt - lz) * k)
          next =
            zoom === target.zoom ? target : zoomAt(current, zoom, state.anchor, state.viewport, state.dpr)
        } else {
          const k = 1 - Math.exp(-dt * EASE_RATE)
          const lz = Math.log(current.zoom)
          const lt = Math.log(target.zoom)
          next = {
            zoom: Math.abs(lt - lz) < 0.002 ? target.zoom : Math.exp(lz + (lt - lz) * k),
            panX: current.panX + (target.panX - current.panX) * k,
            panY: current.panY + (target.panY - current.panY) * k,
          }
          if (sameView(next, target, 0.002)) next = target
        }
        live.current = next
        setLiveView(next)
        dirty.current = true
      }
      if (!dirty.current) return
      dirty.current = false
      const t0 = performance.now()
      const ui = useUi.getState()
      renderer.render(live.current, {
        thirds: ui.thirds,
        grid: ui.customGrid ? { cols: ui.gridCols, rows: ui.gridRows } : null,
        guidesX: state.guides.x,
        guidesY: state.guides.y,
        pixelGrid: true,
      })
      monitor.record(performance.now() - t0 + dt * 1000 * 0) // render cost on this machine
    }
    frame = requestAnimationFrame(tick)

    const markDirty = () => {
      dirty.current = true
    }
    const unsubView = useView.subscribe(markDirty)
    const unsubUi = useUi.subscribe((s, prev) => {
      if (s.theme !== prev.theme) {
        // The new theme's variables land on the next frame.
        requestAnimationFrame(() => {
          renderer.readColors()
          dirty.current = true
        })
      }
      dirty.current = true
    })
    renderer.onRestoreNeeded = () => {
      const blob = renderer.restoreBlob
      if (!blob) return
      void createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).then(
        async (bitmap) => {
          await renderer.setImage(bitmap, blob)
          bitmap.close()
          dirty.current = true
        },
      )
    }

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', resize)
      unsubView()
      unsubUi()
      renderer.dispose()
      gl.current = null
    }
  }, [onGlError])

  // --- upload the image when it changes -------------------------------------------------
  useEffect(() => {
    const renderer = gl.current
    if (!renderer) return
    if (!image) {
      renderer.clearImage()
      dirty.current = true
      return
    }
    let cancelled = false
    void renderer.setImage(image.bitmap, image.blob).then(() => {
      if (cancelled) return
      live.current = useView.getState().target // first view appears fitted, not animated
      setLiveView(live.current)
      dirty.current = true
    })
    return () => {
      cancelled = true
    }
  }, [image])

  useEngine(gl, () => {
    dirty.current = true
  })

  // --- keyboard: hold space to pan ------------------------------------------------------
  useEffect(() => {
    const typing = (e: KeyboardEvent) => takesText(e.target)
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e)) {
        e.preventDefault()
        space.current = true
        setCursor('grab')
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        space.current = false
        setCursor('default')
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // --- pointer / wheel ------------------------------------------------------------------
  const local = (e: { clientX: number; clientY: number }): Point => {
    const rect = box.current?.getBoundingClientRect()
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
  }

  useEffect(() => {
    const container = box.current
    if (!container) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = container.getBoundingClientRect()
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      const sensitivity = e.ctrlKey ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY
      useView.getState().zoomBy(Math.exp(-e.deltaY * lines * sensitivity), anchor)
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  const guideAt = (p: Point): { axis: 'x' | 'y'; index: number } | null => {
    const { guides, target, viewport, dpr } = useView.getState()
    for (const [axis, list] of [
      ['x', guides.x],
      ['y', guides.y],
    ] as const) {
      for (let i = 0; i < list.length; i++) {
        const v = list[i] ?? 0
        const s = imageToScreen({ x: axis === 'x' ? v : 0, y: axis === 'y' ? v : 0 }, target, viewport, dpr)
        if (Math.abs((axis === 'x' ? s.x : s.y) - (axis === 'x' ? p.x : p.y)) <= GUIDE_HIT)
          return { axis, index: i }
      }
    }
    return null
  }

  const moveGuide = (axis: 'x' | 'y', index: number, p: Point) => {
    const { target, viewport, dpr, image: size } = useView.getState()
    if (!size) return
    const at = screenToImage(p, target, viewport, dpr)
    const value = axis === 'x' ? at.x : at.y
    const edge = axis === 'x' ? size.w : size.h
    useView.getState().moveGuide(axis, index, snapGuide(value, guideTargets(edge), 6 / (target.zoom / dpr)))
  }

  const startGuide = (axis: 'x' | 'y', e: React.PointerEvent) => {
    if (!useView.getState().image) return
    const { guides } = useView.getState()
    useView.getState().addGuide(axis, 0)
    const index = axis === 'x' ? guides.x.length : guides.y.length
    drag.current = { kind: 'guide', axis, index }
    box.current?.setPointerCapture(e.pointerId)
    moveGuide(axis, index, local(e))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const p = local(e)
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, p)
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()] as [Point, Point]
        pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) }
      }
    }
    const panning = e.button === 1 || (e.button === 0 && space.current) || e.pointerType === 'touch'
    if (panning) {
      e.preventDefault()
      drag.current = { kind: 'pan', x: p.x, y: p.y }
      box.current?.setPointerCapture(e.pointerId)
      setCursor('grabbing')
      return
    }
    if (e.button === 0) {
      const hit = guideAt(p)
      if (hit) {
        drag.current = { kind: 'guide', ...hit }
        box.current?.setPointerCapture(e.pointerId)
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e)
    const { target, viewport, dpr, image: size } = useView.getState()
    if (size) {
      const at = screenToImage(p, target, viewport, dpr)
      const inside = at.x >= 0 && at.y >= 0 && at.x < size.w && at.y < size.h
      useCursor.getState().set(inside ? { x: Math.floor(at.x), y: Math.floor(at.y) } : null)
    }
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, p)
      if (touches.current.size === 2 && pinch.current) {
        const [a, b] = [...touches.current.values()] as [Point, Point]
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        useView.getState().zoomBy(distance / pinch.current.distance, centre)
        pinch.current.distance = distance
        return
      }
    }
    const d = drag.current
    if (d?.kind === 'pan') {
      useView.getState().panBy(p.x - d.x, p.y - d.y)
      d.x = p.x
      d.y = p.y
    } else if (d?.kind === 'guide') {
      moveGuide(d.axis, d.index, p)
    } else if (!space.current) {
      setCursor(guideAt(p) ? 'col-resize' : 'default')
    }
  }

  const endDrag = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId)
    if (touches.current.size < 2) pinch.current = null
    const d = drag.current
    drag.current = null
    if (box.current?.hasPointerCapture(e.pointerId)) box.current.releasePointerCapture(e.pointerId)
    if (d?.kind === 'guide') {
      const p = local(e)
      const { viewport } = useView.getState()
      const outside = p.x < RULER_SIZE || p.y < RULER_SIZE || p.x > viewport.w || p.y > viewport.h
      if (outside) useView.getState().removeGuide(d.axis, d.index)
    }
    setCursor(space.current ? 'grab' : 'default')
  }

  const hasImage = image !== null
  return (
    <div
      ref={box}
      className="viewport"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => useCursor.getState().set(null)}
      onAuxClick={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        if (e.button === 0 && hasImage && !guideAt(local(e))) useView.getState().fit()
      }}
    >
      <canvas ref={canvas} className="viewport-canvas" />
      {hasImage && <PixelArtOverlay />}
      {hasImage && <EraserOverlay />}
      {hasImage && <Rulers onStartGuide={startGuide} />}
      {hasImage && <TransformOverlay />}
      {hasImage && <MiniMap />}
    </div>
  )
}
