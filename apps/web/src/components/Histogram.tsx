import { useEffect, useRef } from 'react'
import type { Histogram as Data } from '../lib/imageLoader'
import { useUi } from '../state/ui'

const W = 256
const H = 80

export function Histogram({ data }: { data: Data }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const theme = useUi((s) => s.theme)

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const dpr = window.devicePixelRatio || 1
    el.width = W * dpr
    el.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const style = getComputedStyle(document.documentElement)
    // Square-root scale so a single tall spike does not flatten everything else.
    const scale = (v: number) => Math.sqrt(v / data.max) * (H - 2)
    const channels: [Uint32Array, string][] = [
      [data.r, style.getPropertyValue('--px-danger').trim()],
      [data.g, style.getPropertyValue('--px-success').trim()],
      [data.b, style.getPropertyValue('--px-accent').trim()],
    ]
    for (const [values, color] of channels) {
      ctx.beginPath()
      ctx.moveTo(0, H)
      for (let i = 0; i < 256; i++) ctx.lineTo(i, H - scale(values[i] ?? 0))
      ctx.lineTo(255, H)
      ctx.closePath()
      ctx.globalAlpha = 0.22
      ctx.fillStyle = color
      ctx.fill()
      ctx.globalAlpha = 0.9
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = style.getPropertyValue('--px-text2').trim()
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i < 256; i++) {
      const y = H - scale(data.luma[i] ?? 0) * 0.9
      if (i === 0) ctx.moveTo(0, y)
      else ctx.lineTo(i, y)
    }
    ctx.stroke()
  }, [data, theme])

  return (
    <canvas
      ref={canvas}
      className="histogram"
      style={{ width: '100%', height: H }}
      role="img"
      aria-label="Histogram of red, green, blue and brightness"
    />
  )
}
