def patch(path, pairs):
    s = open(path, encoding='utf-8').read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:70], s.count(a))
        s = s.replace(a, b)
    open(path, 'w', encoding='utf-8').write(s)


patch('../../server/pipeline/blur.py', [("MAX_RADIUS = 24\n", "MAX_RADIUS = 96  # sigma up to 32; the GPU shader uses the same cap\n")])
patch('../../server/pipeline/ops.py', [("    noise_reduction: float = Field(default=0.0, ge=0, le=100)\n", "    noise_reduction: float = Field(default=0.0, ge=0, le=100)\n    blur: float = Field(default=0.0, ge=0, le=32)  # Gaussian blur, sigma in source pixels\n")])
patch('../../server/pipeline/adjust.py', [
    ('                "noise_reduction": 0.0,\n', '                "noise_reduction": 0.0,\n                "blur": 0.0,\n'),
    ("    rgb = noise_reduction(rgb, a.noise_reduction, scale)\n", "    rgb = noise_reduction(rgb, a.noise_reduction, scale)\n    if a.blur > 0:  # stage 10b: plain Gaussian blur (soften, background blur)\n        rgb = gaussian(rgb, a.blur * scale)\n"),
])
patch('src/engine/shaders.ts', [("  int radius = min(24, max(1, int(ceil(3.0 * u_sigma))));\n  float sum = 0.0;\n  vec4 acc = vec4(0.0);\n  for (int i = -24; i <= 24; i++) {", "  int radius = min(96, max(1, int(ceil(3.0 * u_sigma))));\n  float sum = 0.0;\n  vec4 acc = vec4(0.0);\n  for (int i = -96; i <= 96; i++) {")])
patch('src/engine/types.ts', [
    ("  noise_reduction: number\n", "  noise_reduction: number\n  blur: number\n"),
    ("    noise_reduction: 0,\n", "    noise_reduction: 0,\n    blur: 0,\n"),
    ("{ ...a, noise_reduction: 0, sharpen:", "{ ...a, noise_reduction: 0, blur: 0, sharpen:"),
])
patch('src/engine/pipeline.ts', [
    ("    const needsNoise = a.noise_reduction > 0\n    if (!(hasPointAdjustments(a) || needsNoise || needsFinish)) return input\n", "    const needsNoise = a.noise_reduction > 0\n    const needsBlur = a.blur > 0\n    if (!(hasPointAdjustments(a) || needsNoise || needsBlur || needsFinish)) return input\n"),
    ("    if (needsFinish) {\n      const base: Pooled = stage ?? this.copyTo(input)\n      const finished = this.finishPass(base, a, f)", """    if (needsBlur) {
      const base: Pooled = stage ?? this.copyTo(input)
      const blurred = this.blur(base, a.blur * f)
      base.busy = false
      stage = blurred
    }
    if (needsFinish) {
      const base: Pooled = stage ?? this.copyTo(input)
      const finished = this.finishPass(base, a, f)"""),
])
patch('src/components/AdjustPanel.tsx', [('        <Row label="Noise reduction" path="noise_reduction" min={0} max={100} />\n', '        <Row label="Noise reduction" path="noise_reduction" min={0} max={100} />\n        <Row label="Blur" path="blur" min={0} max={32} step={0.5} digits={1} unit="px" />\n')])
patch('src/components/LocalPanel.tsx', [("type Key = 'exposure' |", "type Key = 'blur' | 'exposure' |"), ("  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },\n]", "  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },\n  { key: 'blur', label: 'Blur', min: 0, max: 32, step: 0.5, digits: 1 },\n]")])
patch('src/state/brush.ts', [
    ("export type BrushMode = 'dodge' | 'burn' | 'eyes' | 'teeth' | 'warm' | 'soft'", "export type BrushMode = 'dodge' | 'burn' | 'eyes' | 'teeth' | 'warm' | 'soft' | 'blur'"),
    ("'exposure' | 'contrast' | 'highlights' | 'shadows' | 'temperature' | 'saturation' | 'vibrance'\n    >", "'exposure' | 'contrast' | 'highlights' | 'shadows' | 'temperature' | 'saturation' | 'vibrance' | 'blur'\n    >"),
    ("  soft: {\n    label: 'Soften',", "  blur: {\n    label: 'Blur',\n    hint: 'Blur where you paint: a soft background, hidden detail.',\n    adjust: { blur: 6 },\n  },\n  soft: {\n    label: 'Soften',"),
])
patch('scripts/e2e-edit.mjs', [("  [\n    'brush: dodge strokes with an erased hole',", """  [
    'blur (global)',
    { geometry: [], adjust: adjust({ blur: 5, saturation: 10 }) },
    spatial,
    0,
  ],
  [
    'blur (large) through a radial filter',
    {
      geometry: [],
      adjust: adjust(),
      local: [{ id: 'blur0001', name: 'Blur', visible: true, mask: { kind: 'radial', x0: 128, y0: 96, x1: 190, y1: 96, invert: true }, adjust: adjust({ blur: 14 }) }],
    },
    spatial,
    2,
  ],
  [
    'brush: dodge strokes with an erased hole',""")])
print('ok')
