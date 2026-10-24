/**
 * Draws one moment of the timeline. The preview and the export call the same function with the same
 * project, so what you see is what you get; only the size of the frames differs.
 */
import { renderText } from '../lib/makeShape'
import {
  valueAt,
  visibleAt,
  type AnimKind,
  type Clip,
  type ClipColor,
  type Project,
  type Visible,
} from './model'

export interface Drawable {
  source: CanvasImageSource
  width: number
  height: number
}

/** Named looks: a colour change and an optional tint, applied on top of the clip's own colour settings. */
export const LOOKS: Record<string, { label: string; color: Partial<ClipColor>; tint?: string }> = {
  none: { label: 'None', color: {} },
  vivid: { label: 'Vivid', color: { saturation: 35, contrast: 12 } },
  warm: { label: 'Warm', color: { temperature: 35, saturation: 8 } },
  cool: { label: 'Cool', color: { temperature: -35 } },
  mono: { label: 'Black & white', color: { saturation: -100, contrast: 10 } },
  noir: { label: 'Noir', color: { saturation: -100, contrast: 45, exposure: -0.2, vignette: 45 } },
  fade: { label: 'Faded', color: { contrast: -25, saturation: -20, exposure: 0.15 } },
  cinema: {
    label: 'Cinema',
    color: { contrast: 18, saturation: -10, vignette: 30 },
    tint: 'rgba(0, 110, 130, 0.12)',
  },
  sunset: { label: 'Sunset', color: { temperature: 45, saturation: 15 }, tint: 'rgba(255, 90, 40, 0.10)' },
  retro: {
    label: 'Retro',
    color: { contrast: -10, saturation: -25, temperature: 25 },
    tint: 'rgba(120, 80, 30, 0.12)',
  },
}

const ANIM_LENGTH = 0.5 // seconds for an entrance or exit animation

function combinedColor(c: Clip): ClipColor & { tint?: string } {
  const look = LOOKS[c.filter] ?? LOOKS.none!
  const add = (k: keyof ClipColor) => c.color[k] + (look.color[k] ?? 0)
  return {
    exposure: add('exposure'),
    contrast: add('contrast'),
    saturation: add('saturation'),
    temperature: add('temperature'),
    vignette: add('vignette'),
    tint: look.tint,
  }
}

const isNeutral = (c: ClipColor & { tint?: string }) =>
  !c.tint &&
  c.exposure === 0 &&
  c.contrast === 0 &&
  c.saturation === 0 &&
  c.temperature === 0 &&
  c.vignette === 0

/** Entrance/exit animation: extra opacity, offset and scale at `local` seconds into the clip. */
function animation(c: Clip, local: number, W: number, H: number) {
  let alpha = 1
  let dx = 0
  let dy = 0
  let scale = 1
  const apply = (kind: AnimKind, u: number, sign: 1 | -1) => {
    const e = 1 - (1 - u) * (1 - u) // ease out
    if (kind === 'fade') alpha *= u
    else if (kind === 'rise') {
      alpha *= u
      dy += (1 - e) * H * 0.08 * sign
    } else if (kind === 'pop') {
      alpha *= Math.min(1, u * 2)
      scale *= 0.6 + 0.4 * e + Math.sin(u * Math.PI) * 0.08
    } else if (kind === 'slide') {
      alpha *= u
      dx += (1 - e) * W * 0.25 * sign
    }
  }
  if (c.animIn !== 'none' && local < ANIM_LENGTH) apply(c.animIn, Math.max(0, local / ANIM_LENGTH), 1)
  const left = c.duration - local
  if (c.animOut !== 'none' && left < ANIM_LENGTH) apply(c.animOut, Math.max(0, left / ANIM_LENGTH), -1)
  return { alpha, dx, dy, scale }
}

let scratch: OffscreenCanvas | HTMLCanvasElement | null = null
function scratchCanvas(w: number, h: number) {
  scratch ??=
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas')
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w
    scratch.height = h
  }
  return scratch
}

/** The clip's pixels with its colour applied, at the size it will be drawn. */
function coloured(
  d: Drawable,
  color: ClipColor & { tint?: string },
  w: number,
  h: number,
): CanvasImageSource {
  const canvas = scratchCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)))
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ctx.save()
  ctx.globalCompositeOperation = 'copy'
  ctx.filter = `brightness(${2 ** color.exposure}) contrast(${Math.max(0, 1 + color.contrast / 100)}) saturate(${Math.max(0, 1 + color.saturation / 100)})`
  ctx.drawImage(d.source, 0, 0, canvas.width, canvas.height)
  ctx.filter = 'none'
  ctx.globalCompositeOperation = 'source-atop'
  if (color.temperature !== 0) {
    const a = Math.min(1, Math.abs(color.temperature) / 100) * 0.35
    ctx.globalCompositeOperation = 'soft-light'
    ctx.fillStyle = color.temperature > 0 ? `rgba(255, 140, 40, ${a})` : `rgba(40, 120, 255, ${a})`
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  if (color.tint) {
    ctx.globalCompositeOperation = 'source-atop'
    ctx.fillStyle = color.tint
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  if (color.vignette > 0) {
    const g = ctx.createRadialGradient(
      canvas.width / 2,
      canvas.height / 2,
      Math.min(canvas.width, canvas.height) * 0.25,
      canvas.width / 2,
      canvas.height / 2,
      Math.hypot(canvas.width, canvas.height) / 2,
    )
    g.addColorStop(0, 'rgba(0, 0, 0, 0)')
    g.addColorStop(1, `rgba(0, 0, 0, ${Math.min(1, color.vignette / 100) * 0.85})`)
    ctx.globalCompositeOperation = 'source-atop'
    ctx.fillStyle = g
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  // keep the clip's own transparency (soft-light can tint transparent pixels)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(d.source, 0, 0, canvas.width, canvas.height)
  ctx.restore()
  return canvas
}

/**
 * Draw the frame at `t` into `ctx` (W x H pixels, the output size). `frames` holds each visible clip's
 * picture (video frame, still or rendered title) keyed by clip id; a missing one is simply skipped.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  p: Project,
  t: number,
  frames: Map<string, Drawable>,
  W: number,
  H: number,
): void {
  const k = W / p.width // output pixels per project pixel
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = p.background
  ctx.fillRect(0, 0, W, H)
  for (const v of visibleAt(p, t)) {
    const d = frames.get(v.clip.id)
    if (d) drawClip(ctx, v, d, W, H, k)
  }
  ctx.restore()
}

function drawClip(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  v: Visible,
  d: Drawable,
  W: number,
  H: number,
  k: number,
): void {
  const c = v.clip
  const local = Math.min(Math.max(v.local, 0), c.duration)
  // fit the picture to the frame (titles keep their own size)
  const fit =
    c.kind === 'text'
      ? k
      : c.fit === 'cover'
        ? Math.max(W / d.width, H / d.height)
        : Math.min(W / d.width, H / d.height)
  const anim = animation(c, local, W, H)
  let scale = fit * valueAt(c, 'scale', local) * anim.scale
  let x = W / 2 + valueAt(c, 'x', local) * k + anim.dx
  const y = H / 2 + valueAt(c, 'y', local) * k + anim.dy
  let alpha = Math.min(1, Math.max(0, valueAt(c, 'opacity', local))) * anim.alpha
  let clipRect: [number, number, number, number] | null = null
  const tr = v.transition
  if (tr) {
    const q = Math.min(1, Math.max(0, tr.progress))
    if (tr.kind === 'fade' && tr.incoming) alpha *= q
    else if (tr.kind === 'dip') alpha *= tr.incoming ? Math.max(0, 2 * q - 1) : Math.max(0, 1 - 2 * q)
    else if (tr.kind === 'wipe' && tr.incoming) clipRect = [0, 0, W * q, H]
    else if (tr.kind === 'slide') x += tr.incoming ? (1 - q) * W : -q * W
    else if (tr.kind === 'zoom') {
      scale *= tr.incoming ? 0.85 + 0.15 * q : 1 + 0.15 * q
      alpha *= tr.incoming ? q : 1 - q
    }
  }
  if (alpha <= 0.001) return
  const w = d.width * scale
  const h = d.height * scale
  const color = combinedColor(c)
  const pixels = isNeutral(color) || c.kind === 'text' ? d.source : coloured(d, color, w, h)
  ctx.save()
  if (clipRect) {
    ctx.beginPath()
    ctx.rect(...clipRect)
    ctx.clip()
  }
  ctx.globalAlpha = alpha
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(x, y)
  ctx.rotate((valueAt(c, 'rotation', local) * Math.PI) / 180)
  ctx.drawImage(pixels, -w / 2, -h / 2, w, h)
  ctx.restore()
}

const titles = new Map<string, Promise<HTMLCanvasElement>>()

/** A title clip drawn once per look (cached), with the same code as text layers on pictures. */
export function titleFor(c: Clip): Promise<HTMLCanvasElement> | null {
  if (!c.text) return null
  const key = JSON.stringify(c.text)
  let p = titles.get(key)
  if (!p) {
    p = renderText(c.text)
    titles.set(key, p)
    if (titles.size > 64) titles.delete(titles.keys().next().value as string)
  }
  return p
}
