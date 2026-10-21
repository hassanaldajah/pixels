import { cssColorToRgba } from '../lib/color'
import { IMAGE_FRAG, IMAGE_VERT, MAX_GUIDES, OVERLAY_FRAG, OVERLAY_VERT } from './shaders'
import type { Size, View } from './math'

const TILE = 1024 // inner tile edge; each texture carries a 1 px border so filtering has no seams
const NEAREST_ABOVE = 2 // device px per image px; above 200% show real pixels

export interface OverlayOptions {
  thirds: boolean
  grid: { cols: number; rows: number } | null
  guidesX: number[] // image px
  guidesY: number[]
  pixelGrid: boolean
}

export interface Layer {
  texture: WebGLTexture
  /** Where it sits in image space: x, y, width, height (full-resolution pixels). */
  rect: [number, number, number, number]
  /** Only draw this image-space x range (used by the split compare view). */
  clipX?: [number, number]
}

interface Tile {
  texture: WebGLTexture
  rect: [number, number, number, number]
  uv: [number, number, number, number]
}

interface Colors {
  canvas: [number, number, number, number]
  checkA: [number, number, number, number]
  checkB: [number, number, number, number]
  line: [number, number, number, number]
  guide: [number, number, number, number]
  outline: [number, number, number, number]
  grid: [number, number, number, number]
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Could not create a shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error(`Shader error: ${gl.getShaderInfoLog(shader) ?? 'unknown'}`)
  return shader
}

function program(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const p = gl.createProgram()
  if (!p) throw new Error('Could not create a program')
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vert))
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(`Program link error: ${gl.getProgramInfoLog(p) ?? 'unknown'}`)
  return p
}

/** WebGL2 image viewport: tiled textures, mipmapped minification, pixel-exact magnification. */
export class GlViewport {
  private readonly gl: WebGL2RenderingContext
  private readonly imageProgram: WebGLProgram
  private readonly overlayProgram: WebGLProgram
  private readonly unitQuad: WebGLBuffer
  private readonly clipQuad: WebGLBuffer
  private tiles: Tile[] = []
  private dpr = 1
  private magNearest = false
  private colors: Colors
  private blob: Blob | null = null
  private imageSize: Size | null = null
  private lost = false
  private layers: Layer[] | null = null
  private layoutSize: Size | null = null
  onRestoreNeeded: (() => void) | null = null

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false })
    if (!gl) throw new Error('WebGL 2 is not available in this browser.')
    this.gl = gl
    this.imageProgram = program(gl, IMAGE_VERT, IMAGE_FRAG)
    this.overlayProgram = program(gl, OVERLAY_VERT, OVERLAY_FRAG)
    this.unitQuad = this.buffer([0, 0, 1, 0, 0, 1, 1, 1])
    this.clipQuad = this.buffer([-1, -1, 1, -1, -1, 1, 1, 1])
    this.colors = this.readColors()
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
  }

  private buffer(data: number[]): WebGLBuffer {
    const { gl } = this
    const b = gl.createBuffer()
    if (!b) throw new Error('Could not create a buffer')
    gl.bindBuffer(gl.ARRAY_BUFFER, b)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW)
    return b
  }

  /** Colours come from the design tokens (CSS variables), never from literals here. */
  readColors(): Colors {
    const style = getComputedStyle(document.documentElement)
    const read = (name: string, alpha?: number): [number, number, number, number] => {
      const c = cssColorToRgba(style.getPropertyValue(name))
      return alpha === undefined ? c : [c[0], c[1], c[2], alpha]
    }
    this.colors = {
      canvas: read('--px-canvas'),
      checkA: read('--px-check-a'),
      checkB: read('--px-check-b'),
      line: read('--px-accent-soft', 0.75),
      guide: read('--px-accent', 0.95),
      outline: read('--px-line-strong', 0.9),
      grid: read('--px-text1', 0.28),
    }
    return this.colors
  }

  private onLost = (event: Event): void => {
    event.preventDefault()
    this.lost = true
  }

  private onRestored = (): void => {
    this.lost = false
    this.tiles = []
    this.onRestoreNeeded?.()
  }

  get context(): WebGL2RenderingContext {
    return this.gl
  }

  /** Draw these textures instead of the original image (an edited preview). `null` goes back. */
  setLayers(layers: Layer[] | null, layout: Size | null = null): void {
    this.layers = layers
    this.layoutSize = layout
  }

  get hasImage(): boolean {
    return this.tiles.length > 0 || this.layers !== null
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.dpr = dpr
    this.canvas.width = Math.max(1, Math.round(cssW * dpr))
    this.canvas.height = Math.max(1, Math.round(cssH * dpr))
  }

  clearImage(): void {
    for (const t of this.tiles) this.gl.deleteTexture(t.texture)
    this.tiles = []
    this.imageSize = null
    this.blob = null
  }

  /** Upload an image as overlapping tiles. `blob` is kept so a lost context can be rebuilt. */
  async setImage(bitmap: ImageBitmap, blob: Blob): Promise<void> {
    this.clearImage()
    this.blob = blob
    const { gl } = this
    const { width, height } = bitmap
    this.imageSize = { w: width, h: height }
    const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    if (TILE + 2 > maxTexture) throw new Error('This GPU cannot hold 1024 px textures.')
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    for (let ty = 0; ty * TILE < height; ty++) {
      for (let tx = 0; tx * TILE < width; tx++) {
        const x0 = tx * TILE
        const y0 = ty * TILE
        const x1 = Math.min(width, x0 + TILE)
        const y1 = Math.min(height, y0 + TILE)
        const sx = Math.max(0, x0 - 1)
        const sy = Math.max(0, y0 - 1)
        const ex = Math.min(width, x1 + 1)
        const ey = Math.min(height, y1 + 1)
        const piece = await createImageBitmap(bitmap, sx, sy, ex - sx, ey - sy, {
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
        })
        const texture = gl.createTexture()
        if (!texture) throw new Error('Could not create a texture')
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, piece)
        piece.close()
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        const tw = ex - sx
        const th = ey - sy
        this.tiles.push({
          texture,
          rect: [x0, y0, x1 - x0, y1 - y0],
          uv: [(x0 - sx) / tw, (y0 - sy) / th, (x1 - sx) / tw, (y1 - sy) / th],
        })
      }
    }
    this.magNearest = false
  }

  get restoreBlob(): Blob | null {
    return this.blob
  }

  private setMagFilter(nearest: boolean): void {
    if (nearest === this.magNearest) return
    this.magNearest = nearest
    const { gl } = this
    for (const t of this.tiles) {
      gl.bindTexture(gl.TEXTURE_2D, t.texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR)
    }
  }

  render(view: View, overlay: OverlayOptions): void {
    if (this.lost) return
    const { gl, canvas, colors } = this
    const vw = canvas.width
    const vh = canvas.height
    gl.bindFramebuffer(gl.FRAMEBUFFER, null) // the pipeline leaves its own framebuffer bound
    gl.viewport(0, 0, vw, vh)
    gl.clearColor(...colors.canvas)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.BLEND)
    const layout = this.layers ? this.layoutSize : this.imageSize
    if (!layout || (!this.layers && this.tiles.length === 0)) return

    const scale = view.zoom // device px per image px
    this.setMagFilter(scale >= NEAREST_ABOVE)

    const p = this.imageProgram
    gl.useProgram(p)
    const loc = (name: string) => gl.getUniformLocation(p, name)
    gl.uniform2f(loc('u_pan'), view.panX, view.panY)
    gl.uniform1f(loc('u_scale'), scale)
    gl.uniform2f(loc('u_viewport'), vw, vh)
    gl.uniform1f(loc('u_dpr'), this.dpr)
    gl.uniform3f(loc('u_checkA'), colors.checkA[0], colors.checkA[1], colors.checkA[2])
    gl.uniform3f(loc('u_checkB'), colors.checkB[0], colors.checkB[1], colors.checkB[2])
    gl.uniform4f(loc('u_gridColor'), ...colors.grid)
    const gridStrength = overlay.pixelGrid ? Math.min(1, Math.max(0, (scale - 8) / 2)) : 0
    gl.uniform1f(loc('u_pixelGrid'), gridStrength)
    gl.uniform1i(loc('u_tex'), 0)
    const aUnit = gl.getAttribLocation(p, 'a_unit')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuad)
    gl.enableVertexAttribArray(aUnit)
    gl.vertexAttribPointer(aUnit, 2, gl.FLOAT, false, 0, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform2f(loc('u_clipX'), -1e9, 1e9)
    const draw = (rect: [number, number, number, number], uv: [number, number, number, number]) => {
      const sx0 = (rect[0] - view.panX) * scale + vw / 2
      const sy0 = (rect[1] - view.panY) * scale + vh / 2
      if (sx0 > vw || sy0 > vh || sx0 + rect[2] * scale < 0 || sy0 + rect[3] * scale < 0) return
      gl.uniform4f(loc('u_rect'), ...rect)
      gl.uniform4f(loc('u_uv'), ...uv)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    for (const layer of this.layers ?? []) {
      gl.bindTexture(gl.TEXTURE_2D, layer.texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, scale >= NEAREST_ABOVE ? gl.NEAREST : gl.LINEAR)
      gl.uniform2f(loc('u_clipX'), layer.clipX?.[0] ?? -1e9, layer.clipX?.[1] ?? 1e9)
      draw(layer.rect, [0, 0, 1, 1])
    }
    gl.uniform2f(loc('u_clipX'), -1e9, 1e9)
    for (const tile of this.layers ? [] : this.tiles) {
      // Skip tiles that are entirely off screen.
      const sx0 = (tile.rect[0] - view.panX) * scale + vw / 2
      const sy0 = (tile.rect[1] - view.panY) * scale + vh / 2
      if (sx0 > vw || sy0 > vh || sx0 + tile.rect[2] * scale < 0 || sy0 + tile.rect[3] * scale < 0) continue
      gl.bindTexture(gl.TEXTURE_2D, tile.texture)
      gl.uniform4f(loc('u_rect'), ...tile.rect)
      gl.uniform4f(loc('u_uv'), ...tile.uv)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    this.drawOverlay(view, overlay, vw, vh, layout)
  }

  private drawOverlay(view: View, o: OverlayOptions, vw: number, vh: number, image: Size): void {
    const { gl, colors } = this
    const p = this.overlayProgram
    gl.useProgram(p)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    const loc = (name: string) => gl.getUniformLocation(p, name)
    const scale = view.zoom
    const toScreenX = (x: number) => (x - view.panX) * scale + vw / 2
    const toScreenY = (y: number) => (y - view.panY) * scale + vh / 2
    gl.uniform2f(loc('u_viewport'), vw, vh)
    gl.uniform4f(loc('u_imageRect'), toScreenX(0), toScreenY(0), image.w * scale, image.h * scale)
    gl.uniform1f(loc('u_dpr'), this.dpr)
    gl.uniform1f(loc('u_thirds'), o.thirds ? 1 : 0)
    gl.uniform2f(loc('u_grid'), o.grid?.cols ?? 0, o.grid?.rows ?? 0)
    const xs = o.guidesX.slice(0, MAX_GUIDES).map(toScreenX)
    const ys = o.guidesY.slice(0, MAX_GUIDES).map(toScreenY)
    const pad = (a: number[]) => Float32Array.from({ length: MAX_GUIDES }, (_, i) => a[i] ?? 0)
    gl.uniform1fv(loc('u_guideX'), pad(xs))
    gl.uniform1fv(loc('u_guideY'), pad(ys))
    gl.uniform1i(loc('u_nX'), xs.length)
    gl.uniform1i(loc('u_nY'), ys.length)
    gl.uniform4f(loc('u_lineColor'), ...colors.line)
    gl.uniform4f(loc('u_guideColor'), ...colors.guide)
    gl.uniform4f(loc('u_outlineColor'), ...colors.outline)
    const aPos = gl.getAttribLocation(p, 'a_pos')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.clipQuad)
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    this.clearImage()
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
