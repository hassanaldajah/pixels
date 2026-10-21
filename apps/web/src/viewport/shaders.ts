export const IMAGE_VERT = `#version 300 es
precision highp float;
in vec2 a_unit;                 // 0..1 quad corner
uniform vec4 u_rect;            // tile rectangle in image px: x, y, w, h
uniform vec4 u_uv;              // texture coords of that rectangle: u0, v0, u1, v1
uniform vec2 u_pan;             // image px at the viewport centre
uniform float u_scale;          // device px per image px
uniform vec2 u_viewport;        // device px
out vec2 v_uv;
out vec2 v_image;
void main() {
  vec2 image = u_rect.xy + a_unit * u_rect.zw;
  vec2 screen = (image - u_pan) * u_scale + u_viewport * 0.5;
  vec2 clip = screen / u_viewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = mix(u_uv.xy, u_uv.zw, a_unit);
  v_image = image;
}`

export const IMAGE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_image;
uniform sampler2D u_tex;
uniform float u_scale;
uniform float u_dpr;
uniform vec3 u_checkA;
uniform vec3 u_checkB;
uniform vec4 u_gridColor;
uniform float u_pixelGrid;      // 0..1, fades in above 800%
uniform vec2 u_clipX;           // image-space x range that may be drawn (split compare)
out vec4 outColor;
void main() {
  if (v_image.x < u_clipX.x || v_image.x >= u_clipX.y) discard;
  vec4 texel = texture(u_tex, v_uv);
  vec2 cell = floor(gl_FragCoord.xy / (8.0 * u_dpr));
  vec3 checker = mod(cell.x + cell.y, 2.0) < 1.0 ? u_checkA : u_checkB;
  vec3 color = mix(checker, texel.rgb, texel.a);
  if (u_pixelGrid > 0.0) {
    vec2 f = fract(v_image);
    vec2 edge = min(f, 1.0 - f) * u_scale;            // device px to the nearest pixel edge
    float line = 1.0 - smoothstep(0.0, 1.0, min(edge.x, edge.y));
    color = mix(color, u_gridColor.rgb, line * u_gridColor.a * u_pixelGrid);
  }
  outColor = vec4(color, 1.0);
}`

export const OVERLAY_VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`

export const MAX_GUIDES = 16

export const OVERLAY_FRAG = `#version 300 es
precision highp float;
uniform vec2 u_viewport;        // device px
uniform vec4 u_imageRect;       // image rectangle on screen, device px: x, y, w, h
uniform float u_dpr;
uniform float u_thirds;
uniform vec2 u_grid;            // columns, rows (0 = off)
uniform float u_guideX[${MAX_GUIDES}];
uniform float u_guideY[${MAX_GUIDES}];
uniform int u_nX;
uniform int u_nY;
uniform vec4 u_lineColor;       // grid / thirds
uniform vec4 u_guideColor;
uniform vec4 u_outlineColor;
out vec4 outColor;

float strip(float distancePx, float widthPx) {
  return 1.0 - smoothstep(widthPx - 0.5, widthPx + 0.5, distancePx);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_viewport.y - gl_FragCoord.y);
  vec2 rel = (p - u_imageRect.xy) / u_imageRect.zw;
  bool inside = rel.x >= 0.0 && rel.x <= 1.0 && rel.y >= 0.0 && rel.y <= 1.0;
  float w = 0.5 * u_dpr;
  vec4 acc = vec4(0.0);

  // 1 px outline around the image
  float dx = min(abs(p.x - u_imageRect.x), abs(p.x - (u_imageRect.x + u_imageRect.z)));
  float dy = min(abs(p.y - u_imageRect.y), abs(p.y - (u_imageRect.y + u_imageRect.w)));
  bool nearX = p.y >= u_imageRect.y - 1.0 && p.y <= u_imageRect.y + u_imageRect.w + 1.0;
  bool nearY = p.x >= u_imageRect.x - 1.0 && p.x <= u_imageRect.x + u_imageRect.z + 1.0;
  float outline = max(nearX ? strip(dx, w) : 0.0, nearY ? strip(dy, w) : 0.0);
  acc = vec4(u_outlineColor.rgb, u_outlineColor.a * outline);

  if (inside) {
    float line = 0.0;
    if (u_thirds > 0.5) {
      line = max(line, strip(abs(rel.x - 1.0 / 3.0) * u_imageRect.z, w));
      line = max(line, strip(abs(rel.x - 2.0 / 3.0) * u_imageRect.z, w));
      line = max(line, strip(abs(rel.y - 1.0 / 3.0) * u_imageRect.w, w));
      line = max(line, strip(abs(rel.y - 2.0 / 3.0) * u_imageRect.w, w));
    }
    if (u_grid.x > 0.0) {
      line = max(line, strip(abs(fract(rel.x * u_grid.x + 0.5) - 0.5) * u_imageRect.z / u_grid.x, w));
      line = max(line, strip(abs(fract(rel.y * u_grid.y + 0.5) - 0.5) * u_imageRect.w / u_grid.y, w));
    }
    float a = u_lineColor.a * line;
    acc = vec4(mix(acc.rgb, u_lineColor.rgb, a), max(acc.a, a));
  }

  float g = 0.0;
  for (int i = 0; i < ${MAX_GUIDES}; i++) {
    if (i < u_nX) g = max(g, strip(abs(p.x - u_guideX[i]), w));
    if (i < u_nY) g = max(g, strip(abs(p.y - u_guideY[i]), w));
  }
  float ga = u_guideColor.a * g;
  outColor = vec4(mix(acc.rgb, u_guideColor.rgb, ga), max(acc.a, ga));
}`
