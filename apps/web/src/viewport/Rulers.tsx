import { useEffect, useRef } from 'react'
import { useUi } from '../state/ui'
import { useView } from '../state/view'
import { getLiveView, subscribeLiveView } from './liveView'
import { rulerStep } from './math'

export const RULER_SIZE = 20

interface Props {
  onStartGuide: (axis: 'x' | 'y', event: React.PointerEvent) => void
}

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function draw(canvas: HTMLCanvasElement, axis: 'x' | 'y') {
  const dpr = window.devicePixelRatio || 1
  const length = (axis === 'x' ? canvas.parentElement?.clientWidth : canvas.parentElement?.clientHeight) ?? 0
  const w = axis === 'x' ? length : RULER_SIZE
  const h = axis === 'x' ? RULER_SIZE : length
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = css('--px-bg1')
  ctx.fillRect(0, 0, w, h)
  const view = getLiveView()
  const { viewport, dpr: viewDpr } = useView.getState()
  const scale = view.zoom / viewDpr
  const step = rulerStep(scale)
  const centre = axis === 'x' ? viewport.w / 2 : viewport.h / 2
  const pan = axis === 'x' ? view.panX : view.panY
  const first = Math.floor((pan - centre / scale) / step) * step
  const last = pan + (length - centre) / scale
  ctx.strokeStyle = css('--px-line-strong')
  ctx.fillStyle = css('--px-text3')
  ctx.font = `10px ${css('--px-font-mono')}`
  ctx.textBaseline = 'top'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let v = first; v <= last; v += step) {
    const s = Math.round((v - pan) * scale + centre) + 0.5
    if (axis === 'x') {
      ctx.moveTo(s, RULER_SIZE - 6)
      ctx.lineTo(s, RULER_SIZE)
      ctx.fillText(String(Math.round(v)), s + 3, 2)
    } else {
      ctx.moveTo(RULER_SIZE - 6, s)
      ctx.lineTo(RULER_SIZE, s)
      ctx.save()
      ctx.translate(2, s - 3)
      ctx.rotate(-Math.PI / 2)
      ctx.fillText(String(Math.round(v)), 0, 0)
      ctx.restore()
    }
    // minor ticks
    for (let i = 1; i < 5; i++) {
      const m = Math.round((v + (step * i) / 5 - pan) * scale + centre) + 0.5
      if (axis === 'x') {
        ctx.moveTo(m, RULER_SIZE - 3)
        ctx.lineTo(m, RULER_SIZE)
      } else {
        ctx.moveTo(RULER_SIZE - 3, m)
        ctx.lineTo(RULER_SIZE, m)
      }
    }
  }
  ctx.stroke()
}

export function Rulers({ onStartGuide }: Props) {
  const top = useRef<HTMLCanvasElement>(null)
  const left = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const redraw = () => {
      if (top.current) draw(top.current, 'x')
      if (left.current) draw(left.current, 'y')
    }
    redraw()
    const unsub = subscribeLiveView(redraw)
    const unsubView = useView.subscribe(redraw)
    // The new theme's variables land on the next frame.
    const unsubTheme = useUi.subscribe((s, prev) => {
      if (s.theme !== prev.theme) requestAnimationFrame(redraw)
    })
    window.addEventListener('resize', redraw)
    const observer = new ResizeObserver(redraw)
    if (top.current?.parentElement) observer.observe(top.current.parentElement)
    return () => {
      unsub()
      unsubView()
      unsubTheme()
      window.removeEventListener('resize', redraw)
      observer.disconnect()
    }
  }, [])

  return (
    <>
      <div
        className="ruler ruler-top"
        onPointerDown={(e) => onStartGuide('y', e)}
        title="Drag down to add a guide"
      >
        <canvas ref={top} />
      </div>
      <div
        className="ruler ruler-left"
        onPointerDown={(e) => onStartGuide('x', e)}
        title="Drag right to add a guide"
      >
        <canvas ref={left} />
      </div>
      <div className="ruler-corner" />
    </>
  )
}
