def patch(path, pairs):
    s = open(path, encoding='utf-8').read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:70], s.count(a))
        s = s.replace(a, b)
    open(path, 'w', encoding='utf-8').write(s)


patch('../../server/pipeline/ops.py', [
    ("MAX_LOCAL = 8\nMAX_STROKES = 300", "MAX_LOCAL = 8\nMAX_CLONE = 60\nMAX_STROKES = 300"),
    ("class LocalAdjust(_Model):", '''class ClonePaint(_Model):
    """One clone-stamp stroke: copies from (x + dx, y + dy) onto the dabs at `pts`."""

    dx: int = Field(ge=-100_000, le=100_000)
    dy: int = Field(ge=-100_000, le=100_000)
    r: float = Field(ge=1, le=4000)
    hardness: float = Field(default=0.5, ge=0, le=1)
    flow: float = Field(default=0.6, ge=0.01, le=1)
    pts: list[list[float]] = Field(min_length=1, max_length=4000)

    @field_validator("pts")
    @classmethod
    def _points(cls, value: list[list[float]]) -> list[list[float]]:
        for point in value:
            if len(point) != 2 or any(abs(c) > 1e6 for c in point):
                raise ValueError("each dab must be [x, y]")
        return value


class LocalAdjust(_Model):'''),
    ("    local: list[LocalAdjust] = Field(default_factory=list, max_length=MAX_LOCAL)\n", "    local: list[LocalAdjust] = Field(default_factory=list, max_length=MAX_LOCAL)\n    clone: list[ClonePaint] = Field(default_factory=list, max_length=MAX_CLONE)\n"),
    ('''    @field_validator("local")
    @classmethod
    def _unique_local(''', '''    @field_validator("clone")
    @classmethod
    def _clone_total(cls, value: list[ClonePaint]) -> list[ClonePaint]:
        if sum(len(s.pts) for s in value) > MAX_DABS:
            raise ValueError(f"clone strokes can hold at most {MAX_DABS} dabs")
        return value

    @field_validator("local")
    @classmethod
    def _unique_local('''),
])
patch('../../server/pipeline/render.py', [
    ("from pipeline import adjust, geometry, layers, paint, pixelart, selection", "from pipeline import adjust, clone, geometry, layers, paint, pixelart, selection"),
    ("    image = geometry.apply(source, state.geometry, max_pixels) if state.geometry else source\n", "    image = geometry.apply(source, state.geometry, max_pixels) if state.geometry else source\n    image = clone.apply(image, state.clone)\n"),
])

patch('src/engine/types.ts', [
    ("export const MAX_LOCAL = 8\n", "export const MAX_LOCAL = 8\nexport const MAX_CLONE = 60\n\n/** One clone-stamp stroke: copies from (x + dx, y + dy) onto the dabs at `pts`. */\nexport interface CloneStroke {\n  dx: number\n  dy: number\n  r: number\n  hardness: number\n  flow: number\n  pts: [number, number][]\n}\n"),
    ("  local?: LocalAdjust[]\n", "  local?: LocalAdjust[]\n  clone?: CloneStroke[]\n"),
    ("&& !(s.local?.length ?? 0)", "&& !(s.local?.length ?? 0) && !(s.clone?.length ?? 0)"),
])
patch('src/engine/shaders.ts', [
    ("uniform sampler2D u_paint;     // painted mask (R8), when u_maskKind is 3\n", "uniform sampler2D u_paint;     // painted mask (R8), when u_maskKind is 3\nuniform int u_useShift;        // clone stamp: take `after` from a shifted place (bilinear)\nuniform vec2 u_shift;          // preview pixels\n"),
    ("  outColor = mix(texelFetch(u_before, ip, 0), texelFetch(u_after, ip, 0), v);\n}`\n\n/**\n * Keeps the adjusted", """  vec4 copy;
  if (u_useShift == 1) {
    ivec2 sz = textureSize(u_after, 0);
    vec2 q = gl_FragCoord.xy + u_shift - 0.5;
    vec2 fl = floor(q);
    vec2 t = q - fl;
    ivec2 i0 = ivec2(fl);
    copy = mix(
      mix(texelFetch(u_after, clamp(i0, ivec2(0), sz - 1), 0), texelFetch(u_after, clamp(i0 + ivec2(1, 0), ivec2(0), sz - 1), 0), t.x),
      mix(texelFetch(u_after, clamp(i0 + ivec2(0, 1), ivec2(0), sz - 1), 0), texelFetch(u_after, clamp(i0 + ivec2(1, 1), ivec2(0), sz - 1), 0), t.x),
      t.y);
  } else copy = texelFetch(u_after, ip, 0);
  outColor = mix(texelFetch(u_before, ip, 0), copy, v);
}`

/**
 * Keeps the adjusted"""),
])
print('ok')
