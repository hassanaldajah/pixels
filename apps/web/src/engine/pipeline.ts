/**
 * The GPU preview pipeline. Runs an EditState on a (possibly downscaled) copy of the image:
 * geometry passes, then the point adjustments, noise reduction, and the sharpen/vignette/grain
 * finish. The server renders the same state with NumPy for the export (docs/PIPELINE.md).
 */
import { curveLut } from './curves'
import { hexToFill, invert, plan, scaleOp, type Mat3 } from './geometry'
import {
  BLEND_FRAG,
  SELECT_FRAG,
  BLUR_FRAG,
  FINISH_FRAG,
  FULLSCREEN_VERT,
  GEOMETRY_FRAG,
  NOISE_FRAG,
  POINT_FRAG,
} from './shaders'
import {
  BLEND_MODES,
  HSL_CENTERS,
  hasPointAdjustments,
  isIdentityCurve,
  type Adjust,
  type EditState,
  type Layer,
  type Selection,
} from './types'

export interface RenderResult {
  /** The picture after geometry and adjustments (RGBA8, mipmapped, straight alpha). */
  out: WebGLTexture
  /** The picture after geometry only: the "before" for the compare view. */
  geometryOnly: WebGLTexture
  /** Size of the preview textures. */
  w: number
  h: number
  /** Size the result will have at full resolution. */
  fullW: number
  fullH: number
}

interface Pooled {
  texture: WebGLTexture
  w: number
  h: number
  format: 'rgba8' | 'f16' | 'f32'
  busy: boolean
}

const FLOAT_LIMIT_PIXELS = 4_000_000 // above this, intermediates use half floats

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Could not create a shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error(`Shader error: ${gl.getShaderInfoLog(shader) ?? 'unknown'}`)
  return shader
}

class Program {
  readonly program: WebGLProgram
  private readonly locations = new Map<string, WebGLUniformLocation | null>()

  constructor(
    private readonly gl: WebGL2RenderingContext,
    fragment: string,
  ) {
    const program = gl.createProgram()
    if (!program) throw new Error('Could not create a program')
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, FULLSCREEN_VERT))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`Program link error: ${gl.getProgramInfoLog(program) ?? 'unknown'}`)
    this.program = program
  }

  use(): void {
    this.gl.useProgram(this.program)
  }

  loc(name: string): WebGLUniformLocation | null {
    if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.program, name))
    return this.locations.get(name) ?? null
  }

  f(name: string, v: number): void {
    this.gl.uniform1f(this.loc(name), v)
  }
  i(name: string, v: number): void {
    this.gl.uniform1i(this.loc(name), v)
  }
  b(name: string, v: boolean): void {
    this.gl.uniform1i(this.loc(name), v ? 1 : 0)
  }
}

export class GpuPipeline {
  private readonly programs: Record<
    'geometry' | 'point' | 'blur' | 'noise' | 'finish' | 'blend' | 'select',
    Program
  >
  private readonly framebuffer: WebGLFramebuffer
  private readonly vao: WebGLVertexArrayObject
  private readonly lutTexture: WebGLTexture
  private pool: Pooled[] = []
  private source: { texture: WebGLTexture; w: number; h: number } | null = null
  private fullSize = { w: 1, h: 1 }
  private last: RenderResult | null = null
  private layerTextures = new Map<
    string,
    { texture: WebGLTexture; w: number; h: number; fullW: number; fullH: number }
  >()
  readonly floatTargets: boolean

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.floatTargets = gl.getExtension('EXT_color_buffer_float') !== null
    this.programs = {
      geometry: new Program(gl, GEOMETRY_FRAG),
      point: new Program(gl, POINT_FRAG),
      blur: new Program(gl, BLUR_FRAG),
      noise: new Program(gl, NOISE_FRAG),
      finish: new Program(gl, FINISH_FRAG),
      blend: new Program(gl, BLEND_FRAG),
      select: new Program(gl, SELECT_FRAG),
    }
    const fb = gl.createFramebuffer()
    const vao = gl.createVertexArray()
    const lut = gl.createTexture()
    if (!fb || !vao || !lut) throw new Error('Could not allocate GPU objects')
    this.framebuffer = fb
    this.vao = vao
    this.lutTexture = lut
  }

  /** Upload the (downscaled) source. `fullW`/`fullH` are the real image's dimensions. */
  setSource(bitmap: ImageBitmap, fullW: number, fullH: number): void {
    const { gl } = this
    if (this.source) gl.deleteTexture(this.source.texture)
    const texture = gl.createTexture()
    if (!texture) throw new Error('Could not create a texture')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.source = { texture, w: bitmap.width, h: bitmap.height }
    this.fullSize = { w: fullW, h: fullH }
    this.last = null
  }

  /** Upload a layer's picture (possibly downscaled: `fullW`/`fullH` are its real size). */
  setLayerImage(id: string, bitmap: ImageBitmap, fullW: number, fullH: number): void {
    const { gl } = this
    this.removeLayerImage(id)
    const texture = gl.createTexture()
    if (!texture) throw new Error('Could not create a texture')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
    this.setNearest(texture)
    this.layerTextures.set(id, { texture, w: bitmap.width, h: bitmap.height, fullW, fullH })
  }

  removeLayerImage(id: string): void {
    const entry = this.layerTextures.get(id)
    if (entry) this.gl.deleteTexture(entry.texture)
    this.layerTextures.delete(id)
  }

  hasLayerImage(id: string): boolean {
    return this.layerTextures.has(id)
  }

  get sourceTexture(): { texture: WebGLTexture; w: number; h: number } | null {
    return this.source
  }

  get previewScale(): number {
    return this.source ? this.source.w / this.fullSize.w : 1
  }

  private setNearest(texture: WebGLTexture): void {
    const { gl } = this
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  // --- texture pool -----------------------------------------------------------------------------
  private acquire(w: number, h: number, format: Pooled['format']): Pooled {
    const found = this.pool.find((p) => !p.busy && p.w === w && p.h === h && p.format === format)
    if (found) {
      found.busy = true
      return found
    }
    const { gl } = this
    const texture = gl.createTexture()
    if (!texture) throw new Error('Could not create a texture')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    if (format === 'rgba8')
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    else if (format === 'f16')
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null)
    this.setNearest(texture)
    const entry: Pooled = { texture, w, h, format, busy: true }
    this.pool.push(entry)
    if (this.pool.length > 24) this.trimPool()
    return entry
  }

  private trimPool(): void {
    const { gl } = this
    this.pool = this.pool.filter((p) => {
      if (p.busy) return true
      gl.deleteTexture(p.texture)
      return false
    })
  }

  private intermediateFormat(w: number, h: number): Pooled['format'] {
    if (!this.floatTargets) return 'rgba8'
    return w * h <= FLOAT_LIMIT_PIXELS ? 'f32' : 'f16'
  }

  private pass(program: Program, target: Pooled, bind: () => void): void {
    const { gl } = this
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0)
    gl.viewport(0, 0, target.w, target.h)
    gl.disable(gl.BLEND)
    program.use()
    bind()
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private bindTexture(unit: number, texture: WebGLTexture, program: Program, name: string): void {
    const { gl } = this
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    program.i(name, unit)
  }

  // --- the passes -------------------------------------------------------------------------------
  private geometryPass(
    input: { texture: WebGLTexture; w: number; h: number },
    matrix: Mat3,
    outW: number,
    outH: number,
    fill: [number, number, number, number],
  ): Pooled {
    const { gl } = this
    const out = this.acquire(outW, outH, 'rgba8')
    const p = this.programs.geometry
    const inv = invert(matrix)
    // row-major -> column-major for GLSL
    const columns = new Float32Array([inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]])
    this.pass(p, out, () => {
      this.bindTexture(0, input.texture, p, 'u_src')
      gl.uniform2i(p.loc('u_srcSize'), input.w, input.h)
      gl.uniformMatrix3fv(p.loc('u_inv'), false, columns)
      gl.uniform4f(p.loc('u_fill'), ...fill)
    })
    return out
  }

  private uploadLut(a: Adjust): void {
    const { gl } = this
    const data = new Float32Array(256 * 4)
    const luts = [a.curves.master, a.curves.r, a.curves.g, a.curves.b].map((pts) => curveLut(pts))
    for (let i = 0; i < 256; i++)
      for (let c = 0; c < 4; c++) data[i * 4 + c] = (luts[c] as Float32Array)[i] as number
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 256, 1, 0, gl.RGBA, gl.FLOAT, data)
    this.setNearest(this.lutTexture)
  }

  private pointPass(input: { texture: WebGLTexture; w: number; h: number }, a: Adjust): Pooled {
    const { gl } = this
    const out = this.acquire(input.w, input.h, this.intermediateFormat(input.w, input.h))
    const p = this.programs.point
    this.uploadLut(a)
    this.pass(p, out, () => {
      this.bindTexture(0, input.texture, p, 'u_src')
      this.bindTexture(1, this.lutTexture, p, 'u_lut')
      p.f('u_exposure', a.exposure)
      p.f('u_temperature', a.temperature)
      p.f('u_tint', a.tint)
      p.f('u_contrast', a.contrast)
      p.f('u_highlights', a.highlights)
      p.f('u_shadows', a.shadows)
      p.f('u_whites', a.whites)
      p.f('u_blacks', a.blacks)
      p.f('u_vibrance', a.vibrance)
      p.f('u_saturation', a.saturation)
      p.b(
        'u_useHsl',
        [...a.hsl.hue, ...a.hsl.sat, ...a.hsl.lum].some((v) => v !== 0),
      )
      gl.uniform1fv(p.loc('u_hslHue'), new Float32Array(a.hsl.hue))
      gl.uniform1fv(p.loc('u_hslSat'), new Float32Array(a.hsl.sat))
      gl.uniform1fv(p.loc('u_hslLum'), new Float32Array(a.hsl.lum))
      gl.uniform1fv(p.loc('u_hslCenter'), new Float32Array(HSL_CENTERS))
      const lv = a.levels
      p.b('u_useLevels', lv.black !== 0 || lv.white !== 1 || lv.gamma !== 1)
      gl.uniform3f(p.loc('u_levels'), lv.black, lv.white, lv.gamma)
      p.b('u_useMaster', !isIdentityCurve(a.curves.master))
      p.b('u_useR', !isIdentityCurve(a.curves.r))
      p.b('u_useG', !isIdentityCurve(a.curves.g))
      p.b('u_useB', !isIdentityCurve(a.curves.b))
    })
    return out
  }

  private blur(input: Pooled, sigma: number): Pooled {
    const { gl } = this
    const p = this.programs.blur
    const horizontal = this.acquire(input.w, input.h, input.format)
    this.pass(p, horizontal, () => {
      this.bindTexture(0, input.texture, p, 'u_src')
      gl.uniform2i(p.loc('u_size'), input.w, input.h)
      gl.uniform2i(p.loc('u_dir'), 1, 0)
      p.f('u_sigma', sigma)
    })
    const vertical = this.acquire(input.w, input.h, input.format)
    this.pass(p, vertical, () => {
      this.bindTexture(0, horizontal.texture, p, 'u_src')
      gl.uniform2i(p.loc('u_size'), input.w, input.h)
      gl.uniform2i(p.loc('u_dir'), 0, 1)
      p.f('u_sigma', sigma)
    })
    horizontal.busy = false
    return vertical
  }

  private noisePass(input: Pooled, a: Adjust, scale: number): Pooled {
    const blurred = this.blur(input, 1.5 * scale)
    const out = this.acquire(input.w, input.h, input.format)
    const p = this.programs.noise
    this.pass(p, out, () => {
      this.bindTexture(0, input.texture, p, 'u_src')
      this.bindTexture(1, blurred.texture, p, 'u_blur')
      p.f('u_amount', a.noise_reduction)
    })
    blurred.busy = false
    return out
  }

  private finishPass(input: Pooled, a: Adjust, scale: number): Pooled {
    const { gl } = this
    const useSharpen = a.sharpen.amount > 0
    const blurred = useSharpen ? this.blur(input, a.sharpen.radius * scale) : null
    const out = this.acquire(input.w, input.h, 'rgba8')
    const p = this.programs.finish
    this.pass(p, out, () => {
      this.bindTexture(0, input.texture, p, 'u_src')
      this.bindTexture(1, (blurred ?? input).texture, p, 'u_blur')
      p.b('u_useSharpen', useSharpen)
      p.f('u_sharpAmount', a.sharpen.amount)
      p.f('u_sharpThreshold', a.sharpen.threshold)
      p.f('u_vigAmount', a.vignette.amount)
      p.f('u_vigMid', a.vignette.midpoint)
      p.f('u_vigFeather', a.vignette.feather)
      p.f('u_grainAmount', a.grain.amount)
      p.i('u_grainCell', Math.max(1, Math.floor(a.grain.size * scale + 0.5)))
      gl.uniform1ui(p.loc('u_grainSeed'), a.grain.seed >>> 0)
      gl.uniform2i(p.loc('u_size'), input.w, input.h)
    })
    if (blurred) blurred.busy = false
    return out
  }

  /** Blend one layer onto `input` (full-resolution layer coordinates are scaled to the preview). */
  private blendPass(input: Pooled, layer: Layer, preview: number): Pooled | null {
    const tex = this.layerTextures.get(layer.image_id)
    if (!tex) return null
    const { gl } = this
    const out = this.acquire(input.w, input.h, 'rgba8')
    const p = this.programs.blend
    const fl = tex.w / tex.fullW
    // preview canvas px -> full canvas px (1 / preview) -> layer px ((. - xy) / scale) -> layer texture px (* fl)
    const k = fl / (layer.scale * preview)
    const inv = [k, 0, (-layer.x * fl) / layer.scale, 0, k, (-layer.y * fl) / layer.scale, 0, 0, 1] as const
    const columns = new Float32Array([inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]])
    this.pass(p, out, () => {
      this.bindTexture(0, input.texture, p, 'u_base')
      this.bindTexture(1, tex.texture, p, 'u_layer')
      gl.uniform2i(p.loc('u_layerSize'), tex.w, tex.h)
      gl.uniformMatrix3fv(p.loc('u_inv'), false, columns)
      p.f('u_opacity', layer.opacity / 100)
      p.i('u_mode', BLEND_MODES.indexOf(layer.blend))
      const m = layer.mask
      p.i('u_maskKind', m ? (m.kind === 'linear' ? 1 : 2) : 0)
      if (m) gl.uniform4f(p.loc('u_mask'), m.x0, m.y0, m.x1, m.y1)
      p.i('u_maskInvert', m?.invert ? 1 : 0)
      p.f('u_preview', preview)
    })
    return out
  }

  /** Keep the adjusted picture inside the selection and the original outside it. */
  private selectPass(before: Pooled, after: Pooled, sel: Selection, preview: number): Pooled {
    const { gl } = this
    const out = this.acquire(after.w, after.h, 'rgba8')
    const p = this.programs.select
    const pts = new Float32Array(256)
    sel.points.slice(0, 128).forEach(([x, y], i) => {
      pts[i * 2] = x
      pts[i * 2 + 1] = y
    })
    this.pass(p, out, () => {
      this.bindTexture(0, before.texture, p, 'u_before')
      this.bindTexture(1, after.texture, p, 'u_after')
      p.i('u_kind', sel.kind === 'rect' ? 0 : sel.kind === 'ellipse' ? 1 : 2)
      gl.uniform4f(p.loc('u_rect'), sel.x, sel.y, Math.max(sel.w, 1e-6), Math.max(sel.h, 1e-6))
      gl.uniform2fv(p.loc('u_pts'), pts)
      p.i('u_n', Math.min(sel.points.length, 128))
      p.f('u_feather', sel.feather)
      p.i('u_invert', sel.invert ? 1 : 0)
      p.f('u_preview', preview)
    })
    return out
  }

  private mipmap(tex: Pooled): void {
    const { gl } = this
    gl.bindTexture(gl.TEXTURE_2D, tex.texture)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  }

  /**
   * Run the pipeline. The returned textures stay valid until the next call to `run`.
   * Spatial effects use `previewScale` so radii stay proportional on a downscaled preview.
   */
  run(state: EditState): RenderResult {
    if (!this.source) throw new Error('No source image')
    for (const p of this.pool) p.busy = false
    const f = this.previewScale
    const full = plan(state.geometry, this.fullSize.w, this.fullSize.h)
    const fullLast = full[full.length - 1]
    const fullW = fullLast ? fullLast.outW : this.fullSize.w
    const fullH = fullLast ? fullLast.outH : this.fullSize.h

    let current: { texture: WebGLTexture; w: number; h: number } = this.source
    let currentPooled: Pooled | null = null
    const steps = plan(
      state.geometry.map((op) => scaleOp(op, f)),
      this.source.w,
      this.source.h,
    )
    for (const step of steps) {
      const next = this.geometryPass(current, step.matrix, step.outW, step.outH, step.fill)
      if (currentPooled) currentPooled.busy = false
      currentPooled = next
      current = next
    }
    const geometryPooled: Pooled = currentPooled ?? {
      texture: this.source.texture,
      w: this.source.w,
      h: this.source.h,
      format: 'rgba8',
      busy: true,
    }
    const a = state.adjust

    let adjusted: Pooled = geometryPooled
    const needsFinish = a.sharpen.amount > 0 || a.vignette.amount !== 0 || a.grain.amount > 0
    const needsNoise = a.noise_reduction > 0
    if (hasPointAdjustments(a) || needsNoise || needsFinish) {
      let stage: Pooled | null = null
      if (hasPointAdjustments(a)) stage = this.pointPass(geometryPooled, a)
      if (needsNoise) {
        const base: Pooled = stage ?? this.copyTo(geometryPooled)
        const denoised = this.noisePass(base, a, f)
        if (stage) stage.busy = false
        stage = denoised
      }
      if (needsFinish) {
        const base: Pooled = stage ?? this.copyTo(geometryPooled)
        const finished = this.finishPass(base, a, f)
        if (stage) stage.busy = false
        stage = finished
      } else if (stage && stage.format !== 'rgba8') {
        const quantised = this.quantise(stage)
        stage.busy = false
        stage = quantised
      }
      adjusted = stage ?? geometryPooled
    }
    if (state.selection && adjusted !== geometryPooled) {
      const masked = this.selectPass(geometryPooled, adjusted, state.selection, f)
      adjusted.busy = false
      adjusted = masked
    }
    for (const layer of state.layers ?? []) {
      if (!layer.visible || layer.opacity <= 0) continue
      const next = this.blendPass(adjusted, layer, f)
      if (!next) continue
      if (adjusted !== geometryPooled) adjusted.busy = false
      adjusted = next
    }
    this.mipmapIfOwned(adjusted)
    if (geometryPooled !== adjusted) this.mipmapIfOwned(geometryPooled)
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
    this.last = {
      out: adjusted.texture,
      geometryOnly: geometryPooled.texture,
      w: adjusted.w,
      h: adjusted.h,
      fullW,
      fullH,
    }
    return this.last
  }

  private mipmapIfOwned(tex: Pooled): void {
    if (this.pool.includes(tex)) this.mipmap(tex)
  }

  /** Float intermediates cannot be displayed directly; this pass rounds them to 8 bits. */
  private quantise(input: Pooled): Pooled {
    const out = this.acquire(input.w, input.h, 'rgba8')
    const p = this.programs.finish
    const { gl } = this
    this.pass(p, out, () => {
      this.bindTexture(0, input.texture, p, 'u_src')
      this.bindTexture(1, input.texture, p, 'u_blur')
      p.b('u_useSharpen', false)
      p.f('u_vigAmount', 0)
      p.f('u_grainAmount', 0)
      p.i('u_grainCell', 1)
      gl.uniform1ui(p.loc('u_grainSeed'), 0)
      gl.uniform2i(p.loc('u_size'), input.w, input.h)
    })
    return out
  }

  /** Copy an RGBA8 texture into an intermediate-format one so later passes can run on it. */
  private copyTo(input: Pooled): Pooled {
    const out = this.acquire(input.w, input.h, this.intermediateFormat(input.w, input.h))
    const p = this.programs.finish
    const { gl } = this
    this.pass(p, out, () => {
      this.bindTexture(0, input.texture, p, 'u_src')
      this.bindTexture(1, input.texture, p, 'u_blur')
      p.b('u_useSharpen', false)
      p.f('u_vigAmount', 0)
      p.f('u_grainAmount', 0)
      p.i('u_grainCell', 1)
      gl.uniform1ui(p.loc('u_grainSeed'), 0)
      gl.uniform2i(p.loc('u_size'), input.w, input.h)
    })
    return out
  }

  /** Read the last result back as straight-alpha RGBA bytes (row 0 is the image's top row). */
  readOutput(): { data: Uint8Array; w: number; h: number } | null {
    if (!this.last) return null
    const { gl } = this
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.last.out, 0)
    const data = new Uint8Array(this.last.w * this.last.h * 4)
    gl.readPixels(0, 0, this.last.w, this.last.h, gl.RGBA, gl.UNSIGNED_BYTE, data)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { data, w: this.last.w, h: this.last.h }
  }

  dispose(): void {
    const { gl } = this
    for (const p of this.pool) gl.deleteTexture(p.texture)
    this.pool = []
    for (const t of this.layerTextures.values()) gl.deleteTexture(t.texture)
    this.layerTextures.clear()
    if (this.source) gl.deleteTexture(this.source.texture)
    gl.deleteTexture(this.lutTexture)
    gl.deleteFramebuffer(this.framebuffer)
    gl.deleteVertexArray(this.vao)
  }
}

export { hexToFill }
