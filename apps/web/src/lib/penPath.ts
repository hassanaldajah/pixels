/**
 * Pen paths: nodes with optional Bézier handles, drawn with the canvas Path2D API.
 * A node's handles are offsets from the node: `out` leaves toward the next node, `in` arrives from the previous one.
 */
export interface PenNode {
  x: number
  y: number
  in?: [number, number] | null
  out?: [number, number] | null
}

export interface PenStyle {
  fill: string | null // null: no fill
  stroke: string | null // null: no outline
  width: number // outline width, image pixels
}

export interface PathOptions extends PenStyle {
  nodes: PenNode[]
  closed: boolean
}

/** Adds the path to `ctx` (scaled by `k` and moved by -ox, -oy). */
export function tracePath(
  ctx: CanvasRenderingContext2D | Path2D,
  o: PathOptions,
  k = 1,
  ox = 0,
  oy = 0,
): void {
  const n = o.nodes
  if (n.length === 0) return
  const X = (x: number) => (x - ox) * k
  const Y = (y: number) => (y - oy) * k
  const first = n[0] as PenNode
  ctx.moveTo(X(first.x), Y(first.y))
  const segment = (a: PenNode, b: PenNode) => {
    const c1 = a.out ?? [0, 0]
    const c2 = b.in ?? [0, 0]
    if (!a.out && !b.in) ctx.lineTo(X(b.x), Y(b.y))
    else ctx.bezierCurveTo(X(a.x + c1[0]), Y(a.y + c1[1]), X(b.x + c2[0]), Y(b.y + c2[1]), X(b.x), Y(b.y))
  }
  for (let i = 1; i < n.length; i++) segment(n[i - 1] as PenNode, n[i] as PenNode)
  if (o.closed && n.length > 2) {
    segment(n[n.length - 1] as PenNode, first)
    ctx.closePath()
  }
}

/** The area the path covers, handles included (a Bézier never leaves its control points), plus the outline. */
export function pathBounds(o: PathOptions): { x: number; y: number; w: number; h: number } | null {
  if (o.nodes.length === 0) return null
  const xs: number[] = []
  const ys: number[] = []
  for (const p of o.nodes) {
    xs.push(p.x)
    ys.push(p.y)
    for (const h of [p.in, p.out]) {
      if (!h) continue
      xs.push(p.x + h[0])
      ys.push(p.y + h[1])
    }
  }
  const pad = (o.stroke ? o.width / 2 : 0) + 2
  const x0 = Math.floor(Math.min(...xs) - pad)
  const y0 = Math.floor(Math.min(...ys) - pad)
  const x1 = Math.ceil(Math.max(...xs) + pad)
  const y1 = Math.ceil(Math.max(...ys) + pad)
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}

const MAX_SIDE = 6144

/** The path on a transparent canvas covering its bounds, and where that canvas sits on the picture. */
export function renderPath(
  o: PathOptions,
): { canvas: HTMLCanvasElement; x: number; y: number; scale: number } | null {
  const box = pathBounds(o)
  if (!box || (!o.fill && !o.stroke)) return null
  const k = Math.min(1, MAX_SIDE / Math.max(box.w, box.h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(box.w * k))
  canvas.height = Math.max(1, Math.round(box.h * k))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is not available.')
  ctx.beginPath()
  tracePath(ctx, o, k, box.x, box.y)
  if (o.fill && o.closed) {
    ctx.fillStyle = o.fill
    ctx.fill('nonzero')
  }
  if (o.stroke && o.width > 0) {
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.lineWidth = o.width * k
    ctx.strokeStyle = o.stroke
    ctx.stroke()
  }
  return { canvas, x: box.x, y: box.y, scale: 1 / k }
}

/** SVG path data for the on-screen outline (screen coordinates). */
export function svgPath(o: PathOptions, toScreen: (x: number, y: number) => [number, number]): string {
  const n = o.nodes
  if (n.length === 0) return ''
  const pt = (x: number, y: number) =>
    toScreen(x, y)
      .map((v) => v.toFixed(1))
      .join(' ')
  let d = `M ${pt(n[0]!.x, n[0]!.y)}`
  const segment = (a: PenNode, b: PenNode) => {
    if (!a.out && !b.in) d += ` L ${pt(b.x, b.y)}`
    else {
      const c1 = a.out ?? [0, 0]
      const c2 = b.in ?? [0, 0]
      d += ` C ${pt(a.x + c1[0], a.y + c1[1])} ${pt(b.x + c2[0], b.y + c2[1])} ${pt(b.x, b.y)}`
    }
  }
  for (let i = 1; i < n.length; i++) segment(n[i - 1]!, n[i]!)
  if (o.closed && n.length > 2) {
    segment(n[n.length - 1]!, n[0]!)
    d += ' Z'
  }
  return d
}
