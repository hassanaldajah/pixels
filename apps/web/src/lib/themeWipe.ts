import { cssColorToRgba } from './color'
import { themes } from '../tokens'
import { useUi } from '../state/ui'

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`

/**
 * A noise-edged circular wipe. First wave covers the screen with the incoming theme's background,
 * the theme flips while everything is covered, the second wave uncovers the new theme.
 */
const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform vec2 u_origin;
uniform float u_t;
uniform vec3 u_cover;
uniform vec3 u_edge;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { return 0.5 * noise(p) + 0.25 * noise(p * 2.0) + 0.125 * noise(p * 4.0); }

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  float far = length(max(u_origin, u_res - u_origin));
  float d = length(p - u_origin) / far + (fbm(p / 140.0) - 0.28) * 0.16;
  float cover = clamp(u_t * 2.0, 0.0, 1.0) * 1.25;
  float reveal = clamp(u_t * 2.0 - 1.0, 0.0, 1.0) * 1.25;
  float inside = step(d, cover) * (1.0 - step(d, reveal));
  float glow = exp(-abs(d - cover) * 38.0) * step(u_t, 0.5) + exp(-abs(d - reveal) * 38.0) * step(0.5, u_t);
  vec3 color = mix(u_cover, u_edge, clamp(glow, 0.0, 1.0));
  float alpha = max(inside, clamp(glow * 0.9, 0.0, 1.0));
  outColor = vec4(color, alpha);
}`

const DURATION = 900

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)
  if (!s) throw new Error('shader')
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
  return s
}

export function runThemeWipe(origin: { x: number; y: number }, applyTheme: () => void): void {
  if (prefersReducedMotion() || useUi.getState().reduceEffects) {
    applyTheme()
    return
  }
  const incoming = useUi.getState().theme === 'dark' ? 'light' : 'dark'
  const canvas = document.createElement('canvas')
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(window.innerWidth * dpr)
  canvas.height = Math.round(window.innerHeight * dpr)
  canvas.className = 'theme-wipe'
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false })
  if (!gl) {
    applyTheme()
    return
  }
  try {
    const program = gl.createProgram()
    if (!program) throw new Error('program')
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(program)
    gl.useProgram(program)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const a = gl.getAttribLocation(program, 'a_pos')
    gl.enableVertexAttribArray(a)
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    const cover = cssColorToRgba(themes[incoming].bg0)
    const edge = cssColorToRgba(themes[incoming].accent)
    const u = (name: string) => gl.getUniformLocation(program, name)
    gl.uniform2f(u('u_res'), canvas.width, canvas.height)
    gl.uniform2f(u('u_origin'), origin.x * dpr, origin.y * dpr)
    gl.uniform3f(u('u_cover'), cover[0], cover[1], cover[2])
    gl.uniform3f(u('u_edge'), edge[0], edge[1], edge[2])
    document.body.appendChild(canvas)
    gl.viewport(0, 0, canvas.width, canvas.height)

    let flipped = false
    const start = performance.now()
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION)
      if (t >= 0.5 && !flipped) {
        flipped = true
        applyTheme()
      }
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform1f(u('u_t'), t)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      if (t < 1) requestAnimationFrame(frame)
      else {
        canvas.remove()
        gl.getExtension('WEBGL_lose_context')?.loseContext()
      }
    }
    requestAnimationFrame(frame)
  } catch {
    canvas.remove()
    applyTheme()
  }
}
