# The edit pipeline

One `EditState` describes everything done to an image, non-destructively:

```json
{
  "geometry": [
    { "type": "rotate90", "turns": 1 },
    { "type": "crop", "x": 0, "y": 0, "w": 800, "h": 600 }
  ],
  "adjust": { "exposure": 0.5, "contrast": 12, "...": "..." }
}
```

The original working copy is never touched. The browser previews the state on the GPU; the server
renders **the same state** with NumPy for the export. Both follow this document, and a browser test
checks that they agree (see "Parity" below). The model is defined in
`server/pipeline/ops.py` (pydantic, validated on every request) and mirrored in
`apps/web/src/engine/types.ts`.

## Order

1. **Geometry**, in the order the user made it, one op at a time.
2. **Adjustments**, in this order:

| #   | Stage                    | What it does                                                                                |
| --- | ------------------------ | ------------------------------------------------------------------------------------------- |
| 1   | White balance + exposure | In linear light: temperature/tint gains, then x 2^EV                                        |
| 2   | Whites / blacks          | Moves the white and black end points (±0.25 of the range at ±100)                           |
| 3   | Shadows / highlights     | Up to 1.5 stops, masked by luminance (smoothstep 0..0.6 for shadows, 0.4..1 for highlights) |
| 4   | Contrast                 | Linear around mid grey, then clamp to 0..1                                                  |
| 5   | Saturation + vibrance    | Away from luma; vibrance weights low-chroma pixels more                                     |
| 6   | HSL, eight bands         | Triangular bands (±60°) centred on red, orange, yellow, green, aqua, blue, purple, magenta  |
| 7   | Levels                   | Black point, white point, gamma                                                             |
| 8-9 | Curves                   | RGB master, then red, green, blue; monotone cubic (PCHIP) sampled into a 256-entry LUT      |
| 10  | Noise reduction          | Blend toward a Gaussian blur (σ = 1.5 px) except across edges                               |
| 11  | Sharpen                  | Unsharp mask: amount, radius (σ, in image px), optional threshold                           |
| 12  | Vignette                 | Elliptical falloff, midpoint and feather                                                    |
| 13  | Grain                    | Zero-mean monochrome noise from an integer hash (PCG), strongest in the mid-tones           |

Stages 1-9 only need the pixel itself. 10-13 are spatial; their radii are in **image pixels** and
are multiplied by the preview scale, so a downscaled preview blurs in proportion.

## Geometry

Coordinates are continuous: pixel (i, j) covers [i, i+1) x [j, j+1), its centre is (i+.5, j+.5),
the origin is the top-left corner, y points down, positive angles are clockwise. Each op is a 3x3
forward matrix plus a new size:

- `rotate90`, `flip`, `crop`, and integer `canvas` shifts are exact copies (no resampling).
- `rotate` (optionally growing the canvas), `straighten` (rotate, then keep the largest rectangle
  with the original aspect ratio that fits inside), `skew` and `perspective` (a homography from the
  four image corners to four chosen points) resample by inverse mapping with **premultiplied
  bilinear** filtering and a one-pixel anti-aliased edge.
- `resize` uses Lanczos on premultiplied colour (server) and bilinear (preview).
- `canvas` anchors the picture in a larger or smaller frame, filled with transparency or a colour.

Geometry never exceeds `PIXELS_MAX_RENDER_PIXELS` (100 MP by default); the server refuses a state
whose result would be larger.

## Where each half lives

|                    | Browser (preview)                  | Server (export)              |
| ------------------ | ---------------------------------- | ---------------------------- |
| Geometry planning  | `engine/geometry.ts`               | `pipeline/geometry.py`       |
| Adjustments        | `engine/shaders.ts` (GLSL ES 3.00) | `pipeline/adjust.py` (NumPy) |
| Curves             | `engine/curves.ts`                 | `pipeline/curves.py`         |
| Pass orchestration | `engine/pipeline.ts`               | `pipeline/render.py`         |

The preview runs on a downscaled copy of the image (the **Quality** selector: 1024 / 2048 / 4096 px
or Original, capped by the GPU's texture limit). With no edits the viewport shows the original at
full resolution; the selected quality applies to the preview only. The export always renders at
full resolution.

## Parity

`apps/web/scripts/e2e-edit.mjs` is the contract. It opens a real browser, renders sixteen edit
states on the GPU, exports the same states from the server and compares them pixel by pixel:
exact copies must match to 2/255, point adjustments to 3/255, spatial effects to 10/255,
resampled geometry to 12/255 (edges excluded). Today every case is within **1/255**, with a mean
error of 0.0 to 0.12. The same numbers are pinned in unit tests: `server/tests/pipeline` and
`apps/web/src/engine/engine.test.ts` check the geometry matrices and the curve LUT against shared
golden values.

Known, deliberate differences: grain cells land on different pixels at different preview scales
(the statistics match, the pattern does not), and `resize` is smoother on the server.

## Export

`pipeline/export.py` encodes the rendered float image:

- **PNG, JPEG, WebP, AVIF, TIFF.** JPEG has no alpha, so transparency is flattened onto a chosen
  background. AVIF and WebP quality is configurable; WebP has a lossless mode.
- **8 or 16 bit** for PNG and TIFF. 16-bit keeps the smooth gradients that adjustments create; the
  working copy itself is 8-bit (Pillow's limit), so 16-bit does not add detail that was never there.
- **sRGB or Display P3.** Both profiles are generated in `pipeline/icc.py` from the published
  primaries with a Bradford adaptation, embedded in the file, and checked against LittleCMS.
- **Camera info (optional).** Metadata is removed at import. A short allowlist of plain values
  (make, model, date, exposure, ISO, focal length, lens) is kept as validated JSON and can be
  re-attached; GPS is a separate, off-by-default switch. Nothing is ever copied from the original bytes.
- **Print DPI** for PNG, JPEG and TIFF.

## Presets, recipes and projects

- **App icons**: iOS (every size plus `Contents.json`, alpha removed), Android (all densities,
  round icons, adaptive foreground inside the 66 dp safe zone, background colour, Play Store 512),
  macOS `.icns`, Windows `.ico` (16-256), favicons, and PWA icons including a maskable one.
- **Store and social sizes**: App Store, Google Play, GitHub social preview, Open Graph, README
  banner, X, LinkedIn, Instagram, YouTube and Facebook. Fill (crop around a focus point) or fit (bars).
- **Recipes**: orientation, a layout (keep, pad to 1:1, or fit to a size), adjustments and an export
  format. Saved in your browser (`localStorage`), applied to many images by `POST /api/batch/run`, which
  returns a ZIP with a `report.json` listing each file's security verdict.
- **Projects (`.pxe`)**: a ZIP with `project.json` (the whole edit history) and `original.png`.
  Opening one is treated like any untrusted upload: only those two names are accepted, every entry is
  read with a hard size cap that ignores the archive's own header, and the image inside goes through
  the complete Security Gate again.
