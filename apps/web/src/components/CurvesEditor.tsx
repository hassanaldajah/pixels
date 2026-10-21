import { useMemo, useRef, useState } from 'react'
import { curveLut } from '../engine/curves'
import { MAX_CURVE_POINTS, type CurvePoints } from '../engine/types'

const SIZE = 220
const PAD = 8
const CHANNELS = ['master', 'r', 'g', 'b'] as const
export type CurveChannel = (typeof CHANNELS)[number]

const toPx = (x: number, y: number): [number, number] => [
  PAD + x * (SIZE - 2 * PAD),
  PAD + (1 - y) * (SIZE - 2 * PAD),
]
const fromPx = (px: number, py: number): [number, number] => [
  Math.min(1, Math.max(0, (px - PAD) / (SIZE - 2 * PAD))),
  Math.min(1, Math.max(0, 1 - (py - PAD) / (SIZE - 2 * PAD))),
]

interface Props {
  channel: CurveChannel
  points: CurvePoints
  onChannel: (c: CurveChannel) => void
  onPreview: (points: CurvePoints) => void
  onCommit: (points: CurvePoints) => void
}

/** Click to add a point, drag to move it, double-click a point to remove it. */
export function CurvesEditor({ channel, points, onChannel, onPreview, onCommit }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const [active, setActive] = useState<number | null>(null)
  const lut = useMemo(() => curveLut(points), [points])
  const stroke = {
    master: 'var(--px-text1)',
    r: 'var(--px-danger)',
    g: 'var(--px-success)',
    b: 'var(--px-accent)',
  }[channel]

  const path = useMemo(() => {
    const parts: string[] = []
    for (let i = 0; i < 256; i++) {
      const [x, y] = toPx(i / 255, lut[i] as number)
      parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    }
    return parts.join(' ')
  }, [lut])

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const rect = svg.current?.getBoundingClientRect()
    const scale = rect ? SIZE / rect.width : 1
    return fromPx((e.clientX - (rect?.left ?? 0)) * scale, (e.clientY - (rect?.top ?? 0)) * scale)
  }

  const move = (index: number, x: number, y: number): CurvePoints => {
    const next = points.map((p) => [...p] as [number, number])
    const lo = index === 0 ? 0 : (next[index - 1] as [number, number])[0] + 0.005
    const hi = index === next.length - 1 ? 1 : (next[index + 1] as [number, number])[0] - 0.005
    const isEnd = index === 0 || index === next.length - 1
    next[index] = [isEnd ? (next[index] as [number, number])[0] : Math.min(hi, Math.max(lo, x)), y]
    return next
  }

  return (
    <div className="curves">
      <div className="segmented" role="radiogroup" aria-label="Curve channel">
        {CHANNELS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === channel}
            data-active={c === channel}
            onClick={() => onChannel(c)}
          >
            {c === 'master' ? 'RGB' : c.toUpperCase()}
          </button>
        ))}
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="curves-plot"
        role="application"
        aria-label={`${channel} tone curve editor`}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          const [x, y] = local(e)
          const hit = points.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 0.045)
          if (hit >= 0) {
            setActive(hit)
          } else if (points.length < MAX_CURVE_POINTS) {
            const next = [...points, [x, y] as [number, number]].sort((a, b) => a[0] - b[0])
            onPreview(next)
            setActive(next.findIndex((p) => p[0] === x && p[1] === y))
          }
          svg.current?.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (active === null) return
          const [x, y] = local(e)
          onPreview(move(active, x, y))
        }}
        onPointerUp={(e) => {
          if (active === null) return
          const [x, y] = local(e)
          onCommit(move(active, x, y))
          setActive(null)
          svg.current?.releasePointerCapture(e.pointerId)
        }}
        onDoubleClick={(e) => {
          const [x, y] = local(e)
          const hit = points.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 0.045)
          if (hit > 0 && hit < points.length - 1) onCommit(points.filter((_, i) => i !== hit))
        }}
      >
        <rect x={PAD} y={PAD} width={SIZE - 2 * PAD} height={SIZE - 2 * PAD} className="curves-bg" />
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} className="curves-grid">
            <line x1={toPx(g, 0)[0]} y1={PAD} x2={toPx(g, 0)[0]} y2={SIZE - PAD} />
            <line x1={PAD} y1={toPx(0, g)[1]} x2={SIZE - PAD} y2={toPx(0, g)[1]} />
          </g>
        ))}
        <line x1={PAD} y1={SIZE - PAD} x2={SIZE - PAD} y2={PAD} className="curves-diagonal" />
        <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
        {points.map(([x, y], i) => {
          const [cx, cy] = toPx(x, y)
          return (
            <circle
              key={`${i}-${x}`}
              cx={cx}
              cy={cy}
              r={active === i ? 6 : 4.5}
              className="curves-point"
              data-active={active === i}
              stroke={stroke}
            />
          )
        })}
      </svg>
      <p className="hint">Click to add a point · drag to move · double-click a point to remove it</p>
    </div>
  )
}
