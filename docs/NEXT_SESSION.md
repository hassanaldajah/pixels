# Next session: the tools not built yet

Branch: `feature/layers-v1.2` (10 commits on top of `main`). Read this first, then pick from the top.

## How every tool is built here (so the next session starts fast)

1. **Model**: add it to the edit state in `server/pipeline/ops.py` (pydantic, `extra="forbid"`, hard limits) and mirror it
   in `apps/web/src/engine/types.ts`. Old states must still load: new fields are optional, and
   `withDefaults` (types.ts) fills scalars that older saves lack.
2. **Server render**: a module in `server/pipeline/` and one call in `render.py` (`render_base` for pixel edits,
   `render_composite` for things on top). Same maths in numpy and GLSL.
3. **GPU preview**: a fragment shader in `engine/shaders.ts`, a pass in `engine/pipeline.ts` (copy the `mixPass` /
   `clonePass` / `blendPass` pattern). Brush-like strokes are rasterised by `lib/paintMask.ts`.
4. **UI**: a panel in `components/`, a tool in `lib/tools.ts`, an overlay in `viewport/` for canvas drawing (copy
   `BrushOverlay.tsx`), an entry in `help/guide.ts` (then `pnpm guide`).
5. **Tests**: unit tests in `server/tests/pipeline/`, a parity case in `apps/web/scripts/e2e-edit.mjs` (GPU against
   server, tolerance within 1/255 for point edits), a real-mouse step in `scripts/e2e-tools.mjs`.
6. **Gate**: `pytest`, `ruff`, `mypy`, `pnpm audit`, `pip-audit`, `vitest`, `tsc`, `eslint`, and the three browser tests
   (`e2e`, `e2e:edit`, `e2e:tools`). Nothing merges to `main` until all pass and the app has been tried by hand.

Rules that stay: no AI, no new dependencies unless audited, colours only from `src/tokens.ts`, never trust a file
(everything that becomes a layer goes through the Security Gate), preview and export must agree.

## Highest value first

| # | Tool | What it is | How to build it | Size |
|---|------|------------|-----------------|------|
| 1 | **Liquify** | Push, bloat and pinch pixels (reshape faces, bodies, curves) | Strokes of dabs `{x, y, dx, dy, r, strength, mode}`; accumulate a displacement field (smooth falloff); output = bilinear sample of the source at `p - field(p)`. Server: numpy field + the same sampler as `geometry._sample`. GPU: RGBA32F field texture (like `paintTexture`) + a sampling shader. Cap dabs like `MAX_DABS`. | Large |
| 2 | **Painted layer masks** | Hide/reveal parts of a layer with the brush | Give `Layer` an optional `paint` (reuse `Paint`/`rasterise`); multiply the layer alpha by it in `layers.composite` and `BLEND_FRAG` (same texture path as local adjustments). | Medium |
| 3 | **Magic wand / select by colour** | Click a colour, select similar pixels | Flood fill with tolerance on the server (needs a raster result): return a packed mask like the Eraser does, store it as a gated image or an RLE in the state; use as a `Selection` of kind `mask`. | Medium |
| 4 | **Dodge / Burn as their own tool** | Currently presets inside Brush | Add a mid-tone / shadow / highlight range weighting to the brush adjustment (weight by luminance). | Small |
| 5 | **More blur kinds** | Motion, radial (spin), lens, tilt-shift | Motion = 1-D kernel along an angle; tilt-shift = linear-gradient mask + blur (already possible with Local adjustments, add a preset); lens = disc kernel. | Medium |
| 6 | **Smudge / sharpen brush** | Drag colour around; sharpen where painted | Smudge = per-dab sample-and-carry (like Liquify but copies colour); sharpen = local adjustment preset. | Medium |
| 7 | **Gradient fill and paint bucket layers** | Fill a layer with a gradient or a colour | Generate a PNG on a canvas (as Text & shapes does), add as a layer. | Small |
| 8 | **More blend modes** | Color dodge, color burn, hard light, exclusion, hue, saturation, color, luminosity | Add to `blend_rgb` and `blendRgb` with the W3C formulas; extend `BLEND_MODES` and the tests. | Small |
| 9 | **Actions** | Record and replay a list of steps | Batch recipes already apply an edit state to many files; add "save this edit as a recipe" and a replay button. | Small |
| 10 | **Pen / vector paths** | Draw and edit paths, strokes and fills | Needs a path model (Bezier nodes) and a rasteriser on both sides; or render paths to a PNG layer on the canvas. | Large |
| 11 | **Text editing after adding** | Change the words of a text layer | Store the text options on the layer and re-draw its PNG on edit (new field `source: {kind: "text", ...}`; the PNG still goes through the gate). | Medium |

## Big or risky: only if you really want them

- **RAW camera files**: needs a decoder dependency (audit it) and runs inside the sandbox worker.
- **CMYK / soft proofing / custom ICC profiles**: needs a colour-management dependency (LittleCMS is already used in tests).
- **HDR merge, panorama stitching, focus stacking**: multi-image alignment; a project of its own.

## Left out on purpose (AI)

Generative fill, automatic subject selection, AI background removal, AI upscaling, face detection, clothes swapping.

## Small things noticed

- The Brush and Clone overlays share a lot of code with the Eraser overlay: factor out a `useCanvasStroke` hook.
- Layer pictures stay in memory until the picture is closed; free the ones no history step uses.
- The gradient fade controls are sliders; a draggable handle on the canvas (like Move) would be nicer.
- Try everything by hand on real photos (the browser tests check numbers and behaviour, not how it looks).
