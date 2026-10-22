/**
 * GLSL for the preview pipeline. Every formula mirrors server/pipeline/*.py, stage for stage:
 * docs/PIPELINE.md lists the order. Pixel (x, y) is texel row y: nothing is flipped anywhere, so
 * `gl_FragCoord` is already the pixel centre in image coordinates.
 */

export const FULLSCREEN_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 outColor;
`

export const GEOMETRY_FRAG = `${HEADER}
uniform sampler2D u_src;
uniform ivec2 u_srcSize;
uniform mat3 u_inv;            // output pixel centre -> source position (column-major)
uniform vec4 u_fill;           // straight RGBA outside the source

vec4 premultiplied(ivec2 i) {
  vec4 t = texelFetch(u_src, clamp(i, ivec2(0), u_srcSize - 1), 0);
  return vec4(t.rgb * t.a, t.a);
}

void main() {
  vec3 q = u_inv * vec3(gl_FragCoord.xy, 1.0);
  bool valid = q.z > 1e-12;
  vec2 p = valid ? q.xy / q.z : vec2(-1.0e6);
  vec2 f = p - 0.5;
  vec2 fl = floor(f);
  vec2 t = f - fl;
  ivec2 i0 = ivec2(fl);
  vec4 acc = mix(
    mix(premultiplied(i0), premultiplied(i0 + ivec2(1, 0)), t.x),
    mix(premultiplied(i0 + ivec2(0, 1)), premultiplied(i0 + ivec2(1, 1)), t.x),
    t.y);
  vec3 rgb = acc.a > 1e-6 ? acc.rgb / acc.a : vec3(0.0);
  float inside = min(min(p.x, float(u_srcSize.x) - p.x), min(p.y, float(u_srcSize.y) - p.y));
  float coverage = valid ? clamp(inside + 0.5, 0.0, 1.0) : 0.0;
  float fa = u_fill.a;
  float a = coverage * acc.a + (1.0 - coverage) * fa;
  vec3 pm = coverage * acc.a * rgb + (1.0 - coverage) * fa * u_fill.rgb;
  outColor = vec4(a > 1e-6 ? pm / a : vec3(0.0), a);
}`

const COLOR_HELPERS = `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 srgbToLinear(vec3 c) {
  c = max(c, 0.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float luma(vec3 c) { return dot(c, LUMA); }
vec3 rgbToHsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float d = mx - mn;
  float l = (mx + mn) * 0.5;
  float safeD = d > 1e-6 ? d : 1.0;
  float denom = max(1.0 - abs(2.0 * l - 1.0), 1e-6);
  float s = d > 1e-6 ? d / denom : 0.0;
  float h = (mx == c.r) ? mod((c.g - c.b) / safeD, 6.0)
          : ((mx == c.g) ? (c.b - c.r) / safeD + 2.0 : (c.r - c.g) / safeD + 4.0);
  h = d > 1e-6 ? h * 60.0 : 0.0;
  return vec3(h, clamp(s, 0.0, 1.0), l);
}
vec3 hslToRgb(vec3 hsl) {
  float a = hsl.y * min(hsl.z, 1.0 - hsl.z);
  vec3 k = mod(vec3(0.0, 8.0, 4.0) + hsl.x / 30.0, 12.0);
  vec3 t = min(min(k - 3.0, 9.0 - k), 1.0);
  return hsl.z - a * max(vec3(-1.0), t);
}
`

/** Stages 1-9: everything that only needs the pixel itself. */
export const POINT_FRAG = `${HEADER}
${COLOR_HELPERS}
uniform sampler2D u_src;
uniform sampler2D u_lut;       // 256 x 1, RGBA32F: master, red, green, blue
uniform float u_exposure, u_temperature, u_tint, u_contrast, u_highlights, u_shadows;
uniform float u_whites, u_blacks, u_vibrance, u_saturation;
uniform bool u_useHsl, u_useLevels, u_useMaster, u_useR, u_useG, u_useB;
uniform float u_hslHue[8], u_hslSat[8], u_hslLum[8];
uniform float u_hslCenter[8];
uniform vec3 u_levels;         // black, white, gamma

float lutLookup(int channel, float v) {
  float x = clamp(v, 0.0, 1.0) * 255.0;
  int i0 = int(floor(x));
  int i1 = min(255, i0 + 1);
  float t = x - float(i0);
  vec4 a = texelFetch(u_lut, ivec2(i0, 0), 0);
  vec4 b = texelFetch(u_lut, ivec2(i1, 0), 0);
  float va = channel == 0 ? a.r : (channel == 1 ? a.g : (channel == 2 ? a.b : a.a));
  float vb = channel == 0 ? b.r : (channel == 1 ? b.g : (channel == 2 ? b.b : b.a));
  return mix(va, vb, t);
}

void main() {
  vec4 px = texelFetch(u_src, ivec2(gl_FragCoord.xy), 0);
  vec3 rgb = px.rgb;

  // 1. white balance and exposure in linear light
  vec3 gains = vec3(1.0 + 0.25 * u_temperature / 100.0, 1.0 - 0.2 * u_tint / 100.0, 1.0 - 0.25 * u_temperature / 100.0);
  rgb = linearToSrgb(srgbToLinear(rgb) * gains * exp2(u_exposure));

  // 2. whites / blacks move the end points
  if (u_whites != 0.0 || u_blacks != 0.0) {
    float wp = 1.0 - 0.25 * u_whites / 100.0;
    float bp = -0.25 * u_blacks / 100.0;
    rgb = (rgb - bp) / (wp - bp);
  }

  // 3. shadows / highlights, masked by luminance
  if (u_shadows != 0.0 || u_highlights != 0.0) {
    float y = luma(clamp(rgb, 0.0, 1.0));
    float shadowMask = 1.0 - smoothstep(0.0, 0.6, y);
    float highlightMask = smoothstep(0.4, 1.0, y);
    float stops = 1.5 * u_shadows / 100.0 * shadowMask + 1.5 * u_highlights / 100.0 * highlightMask;
    rgb *= exp2(stops);
  }

  // 4. contrast around mid grey
  if (u_contrast != 0.0) rgb = (rgb - 0.5) * (1.0 + u_contrast / 100.0) + 0.5;
  rgb = clamp(rgb, 0.0, 1.0);

  // 5. saturation and vibrance
  if (u_saturation != 0.0 || u_vibrance != 0.0) {
    float grey = luma(rgb);
    float chroma = max(max(rgb.r, rgb.g), rgb.b) - min(min(rgb.r, rgb.g), rgb.b);
    float boost = (1.0 + u_saturation / 100.0) + u_vibrance / 100.0 * (1.0 - chroma);
    rgb = clamp(vec3(grey) + (rgb - grey) * boost, 0.0, 1.0);
  }

  // 6. HSL per colour band
  if (u_useHsl) {
    vec3 hsl = rgbToHsl(rgb);
    float dHue = 0.0, dSat = 0.0, dLum = 0.0;
    for (int i = 0; i < 8; i++) {
      float dist = abs(mod(hsl.x - u_hslCenter[i] + 180.0, 360.0) - 180.0);
      float w = max(0.0, 1.0 - dist / 60.0);
      dHue += w * u_hslHue[i] * 0.3;
      dSat += w * u_hslSat[i] / 100.0;
      dLum += w * u_hslLum[i] / 100.0 * 0.3;
    }
    float h = mod(hsl.x + dHue, 360.0);
    float s = clamp(hsl.y * (1.0 + dSat), 0.0, 1.0);
    float l = clamp(hsl.z + dLum * s, 0.0, 1.0);
    rgb = clamp(hslToRgb(vec3(h, s, l)), 0.0, 1.0);
  }

  // 7. levels
  if (u_useLevels) {
    rgb = clamp((rgb - u_levels.x) / (u_levels.y - u_levels.x), 0.0, 1.0);
    rgb = pow(rgb, vec3(1.0 / u_levels.z));
  }

  // 8-9. curves: master, then per channel
  if (u_useMaster) rgb = vec3(lutLookup(0, rgb.r), lutLookup(0, rgb.g), lutLookup(0, rgb.b));
  if (u_useR) rgb.r = lutLookup(1, rgb.r);
  if (u_useG) rgb.g = lutLookup(2, rgb.g);
  if (u_useB) rgb.b = lutLookup(3, rgb.b);
  outColor = vec4(clamp(rgb, 0.0, 1.0), px.a);
}`

/** One direction of a separable Gaussian with clamped edges (kernel truncated at 3 sigma). */
export const BLUR_FRAG = `${HEADER}
uniform sampler2D u_src;
uniform ivec2 u_size;
uniform ivec2 u_dir;
uniform float u_sigma;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int radius = min(24, max(1, int(ceil(3.0 * u_sigma))));
  float sum = 0.0;
  vec4 acc = vec4(0.0);
  for (int i = -24; i <= 24; i++) {
    if (i < -radius || i > radius) continue;
    float w = exp(-float(i * i) / (2.0 * u_sigma * u_sigma));
    sum += w;
    acc += w * texelFetch(u_src, clamp(c + u_dir * i, ivec2(0), u_size - 1), 0);
  }
  outColor = acc / sum;
}`

/** Stage 10: blend toward the blur, but not across edges. */
export const NOISE_FRAG = `${HEADER}
uniform sampler2D u_src;
uniform sampler2D u_blur;
uniform float u_amount;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 px = texelFetch(u_src, c, 0);
  vec3 bl = texelFetch(u_blur, c, 0).rgb;
  vec3 d = abs(px.rgb - bl);
  float diff = max(max(d.r, d.g), d.b);
  float w = u_amount / 100.0 * (1.0 - smoothstep(0.02, 0.12, diff));
  outColor = vec4(px.rgb + (bl - px.rgb) * w, px.a);
}`

/** Stages 11-13 and the final clamp: sharpen, vignette, grain. */
export const FINISH_FRAG = `${HEADER}
${COLOR_HELPERS}
uniform sampler2D u_src;
uniform sampler2D u_blur;
uniform bool u_useSharpen;
uniform float u_sharpAmount, u_sharpThreshold;
uniform float u_vigAmount, u_vigMid, u_vigFeather;
uniform float u_grainAmount;
uniform int u_grainCell;
uniform uint u_grainSeed;
uniform ivec2 u_size;

uint pcg(uint x, uint y, uint seed) {
  uint v = x * 747796405u + y * 2891336453u + seed * 277803737u;
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 px = texelFetch(u_src, c, 0);
  vec3 rgb = px.rgb;

  if (u_useSharpen) {
    vec3 detail = rgb - texelFetch(u_blur, c, 0).rgb;
    if (u_sharpThreshold > 0.0) {
      float t = u_sharpThreshold / 255.0;
      detail *= smoothstep(t, t + 0.02, abs(luma(detail)));
    }
    rgb += detail * (u_sharpAmount / 100.0);
  }

  if (u_vigAmount != 0.0) {
    vec2 uv = ((gl_FragCoord.xy / vec2(u_size)) - 0.5) * 2.0;
    float dist = sqrt(uv.x * uv.x + uv.y * uv.y);
    float edge0 = u_vigMid / 100.0 * 1.4142135;
    float falloff = smoothstep(edge0, edge0 + u_vigFeather / 100.0 * 1.4142135, dist);
    float k = u_vigAmount / 100.0;
    rgb = u_vigAmount < 0.0 ? rgb * (1.0 + k * falloff) : rgb + (1.0 - rgb) * k * falloff;
  }

  if (u_grainAmount > 0.0) {
    uint cell = uint(u_grainCell);
    uint h = pcg(uint(c.x) / cell, uint(c.y) / cell, u_grainSeed);
    float noise = float(h >> 8u) / 8388608.0 - 1.0;
    float mask = 1.0 - 0.5 * abs(2.0 * luma(rgb) - 1.0);
    rgb += noise * mask * (u_grainAmount / 100.0 * 0.15);
  }
  outColor = vec4(clamp(rgb, 0.0, 1.0), px.a);
}`

/**
 * Blends an adjusted copy in where a gradient (the same one layers use) is opaque. Mirrors server/pipeline/render.py.
 */
export const MIX_FRAG = `${HEADER}
uniform sampler2D u_before;
uniform sampler2D u_after;
uniform sampler2D u_paint;     // painted mask (R8), when u_maskKind is 3
uniform int u_maskKind;        // 1 linear, 2 radial, 3 painted
uniform vec4 u_mask;           // x0, y0, x1, y1 in full-resolution canvas pixels
uniform int u_maskInvert;
uniform float u_preview;       // preview scale (preview px per full px)

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec2 g = gl_FragCoord.xy / u_preview;
  vec2 d = u_mask.zw - u_mask.xy;
  float v = u_maskKind == 3
    ? texelFetch(u_paint, ip, 0).r
    : u_maskKind == 1
      ? clamp(dot(g - u_mask.xy, d) / dot(d, d), 0.0, 1.0)
      : 1.0 - clamp(length(g - u_mask.xy) / length(d), 0.0, 1.0);
  if (u_maskInvert == 1) v = 1.0 - v;
  outColor = mix(texelFetch(u_before, ip, 0), texelFetch(u_after, ip, 0), v);
}`

/**
 * Keeps the adjusted picture inside a selection and the original outside it. Mirrors server/pipeline/selection.py.
 */
export const SELECT_FRAG = `${HEADER}
uniform sampler2D u_before;
uniform sampler2D u_after;
uniform int u_kind;            // 0 rect, 1 ellipse, 2 polygon
uniform vec4 u_rect;           // x, y, w, h in full-resolution canvas pixels
uniform vec2 u_pts[128];
uniform int u_n;
uniform float u_feather;
uniform int u_invert;
uniform float u_preview;       // preview scale (preview px per full px)

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 before = texelFetch(u_before, ip, 0);
  vec4 after = texelFetch(u_after, ip, 0);
  vec2 p = gl_FragCoord.xy / u_preview;
  float sd;
  if (u_kind == 2) {
    bool inside = false;
    float dist = 1.0e20;
    for (int i = 0; i < 128; i++) {
      if (i >= u_n) break;
      vec2 a = u_pts[i];
      vec2 b = u_pts[(i + 1) % u_n];
      if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      vec2 e = b - a;
      float l2 = dot(e, e);
      float t = l2 > 0.0 ? clamp(dot(p - a, e) / l2, 0.0, 1.0) : 0.0;
      dist = min(dist, length(p - (a + t * e)));
    }
    sd = inside ? -dist : dist;
  } else {
    vec2 c = u_rect.xy + u_rect.zw * 0.5;
    vec2 h = u_rect.zw * 0.5;
    sd = u_kind == 0
      ? max(abs(p.x - c.x) - h.x, abs(p.y - c.y) - h.y)
      : (length((p - c) / h) - 1.0) * min(h.x, h.y);
  }
  float v = clamp(0.5 - sd / max(u_feather, 1.0), 0.0, 1.0);
  if (u_invert == 1) v = 1.0 - v;
  outColor = mix(before, after, v);
}`

/**
 * One layer blended onto the picture. Mirrors server/pipeline/layers.py: the layer is placed with premultiplied
 * bilinear sampling and a one-pixel anti-aliased edge, then blended with the W3C formulas (source-over + blend mode).
 */
export const BLEND_FRAG = `${HEADER}
uniform sampler2D u_base;
uniform sampler2D u_layer;
uniform ivec2 u_layerSize;     // size of the layer texture
uniform mat3 u_inv;            // preview-canvas pixel centre -> layer texture position (column-major)
uniform float u_opacity;       // 0..1
uniform int u_mode;
uniform int u_maskKind;       // 0 none, 1 linear, 2 radial
uniform vec4 u_mask;           // x0, y0, x1, y1 in full-resolution canvas pixels
uniform int u_maskInvert;
uniform float u_preview;       // preview scale (preview px per full px)

vec4 layerTexel(ivec2 i) {
  vec4 t = texelFetch(u_layer, clamp(i, ivec2(0), u_layerSize - 1), 0);
  return vec4(t.rgb * t.a, t.a);
}
vec3 softLight(vec3 cb, vec3 cs) {
  vec3 d = mix(sqrt(cb), ((16.0 * cb - 12.0) * cb + 4.0) * cb, step(cb, vec3(0.25)));
  return mix(cb + (2.0 * cs - 1.0) * (d - cb), cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb), step(cs, vec3(0.5)));
}
vec3 blendRgb(vec3 cb, vec3 cs) {
  if (u_mode == 1) return cb * cs;
  if (u_mode == 2) return cb + cs - cb * cs;
  if (u_mode == 3) return mix(1.0 - 2.0 * (1.0 - cb) * (1.0 - cs), 2.0 * cb * cs, step(cb, vec3(0.5)));
  if (u_mode == 4) return min(cb, cs);
  if (u_mode == 5) return max(cb, cs);
  if (u_mode == 6) return abs(cb - cs);
  if (u_mode == 7) return softLight(cb, cs);
  return cs;
}

void main() {
  vec4 base = texelFetch(u_base, ivec2(gl_FragCoord.xy), 0);
  vec3 q = u_inv * vec3(gl_FragCoord.xy, 1.0);
  bool valid = q.z > 1e-12;
  vec2 p = valid ? q.xy / q.z : vec2(-1.0e6);
  vec2 f = p - 0.5;
  vec2 fl = floor(f);
  vec2 t = f - fl;
  ivec2 i0 = ivec2(fl);
  vec4 acc = mix(
    mix(layerTexel(i0), layerTexel(i0 + ivec2(1, 0)), t.x),
    mix(layerTexel(i0 + ivec2(0, 1)), layerTexel(i0 + ivec2(1, 1)), t.x),
    t.y);
  vec3 cs = acc.a > 1e-6 ? acc.rgb / acc.a : vec3(0.0);
  float inside = min(min(p.x, float(u_layerSize.x) - p.x), min(p.y, float(u_layerSize.y) - p.y));
  float coverage = valid ? clamp(inside + 0.5, 0.0, 1.0) : 0.0;
  float maskValue = 1.0;
  if (u_maskKind != 0) {
    vec2 g = gl_FragCoord.xy / u_preview;
    vec2 d = u_mask.zw - u_mask.xy;
    maskValue = u_maskKind == 1
      ? clamp(dot(g - u_mask.xy, d) / dot(d, d), 0.0, 1.0)
      : 1.0 - clamp(length(g - u_mask.xy) / length(d), 0.0, 1.0);
    if (u_maskInvert == 1) maskValue = 1.0 - maskValue;
  }
  float as = coverage * acc.a * u_opacity * maskValue;
  float ab = base.a;
  vec3 cb = base.rgb;
  vec3 mixed = (1.0 - ab) * cs + ab * clamp(blendRgb(cb, cs), 0.0, 1.0);
  vec3 pm = as * mixed + (1.0 - as) * ab * cb;
  float a = as + ab * (1.0 - as);
  outColor = vec4(a > 1e-6 ? clamp(pm / a, 0.0, 1.0) : vec3(0.0), a);
}`
