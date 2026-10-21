# Architecture

```
pixels/
  apps/web/        React 18 + TypeScript + Vite. The whole UI and the WebGL viewport.
  apps/desktop/    Tauri 2 shell: opens maximised and runs the backend as a sidecar.
  server/          FastAPI backend (Python 3.11, managed with uv)
    app/           routes, middleware, config, job events
    security/      Module S: the Security Gate, sandbox, YARA rules
    pipeline/      edit model, geometry, adjustments, export, pixel art, eraser (PatchMatch), retouch
    tests/         unit, API and security-gate tests
  brand/source/    the supplied logo; scripts/make-brand.mjs derives every icon from it
  shaders/         shared GLSL (adjustments run on the GPU)
  docs/
```

## Request flow for an image

1. The browser pre-checks the file (size, extension, magic bytes) and creates a job.
2. `POST /api/images` streams the raw body to a private spool directory with a hard byte cap.
3. `SecurityGate.inspect` runs steps 1-3, 6 and 7 in the server, then starts the sandboxed
   worker, which performs steps 4, 5, 8, 9 and 10 and writes a clean PNG.
4. Each finished step is published on `/ws/jobs`, so the progress bar shows real work.
5. The server stores the clean PNG under a random UUID and returns the gate report. The spool
   directory (with the original bytes) is deleted in a `finally`, success or not.
6. The browser fetches the PNG, decodes it once, and hands the bitmap to the WebGL viewport.

## The viewport

`viewport/renderer.ts` is a WebGL 2 renderer. Images are cut into 1024 px tiles; each tile's
texture carries a 1 px border from its neighbours so linear filtering never shows seams, and gets
mipmaps for smooth zoom-out. Above 200% it switches to nearest-neighbour; above 800% a pixel grid
fades in. A second full-screen pass draws the image outline, thirds, custom grid and guides.
Tiles that are off screen are skipped. It renders only when something changed or is animating.

`viewport/Viewport.tsx` eases the drawn view toward the target view held in `state/view.ts`.
Zooming eases in log space around the cursor so the point under the pointer stays put. The maths
lives in `viewport/math.ts` and is unit-tested.

## Design tokens

`src/tokens.ts` is the only place colours, radii, blur, glow, durations and easings are written.
`vite.tokens.ts` turns it into CSS variables (`--px-*`) as a virtual stylesheet; Tailwind, the
components and the shaders read those variables. An ESLint rule rejects hex colours elsewhere in
`src/`. `tokens.test.ts` checks WCAG contrast for every text/surface pair in both themes.

## Tools that make a new version

Pixel Art is part of the edit state (applied last, previewed by the server). Eraser, Retouch and Upscale
produce pixels that cannot be described as a small edit, so each one renders the edits so far, runs the
algorithm (`pipeline/inpaint.py`, `pipeline/retouch.py`) and stores the result as a new working copy through
the same store the Security Gate uses. The browser keeps the previous versions (up to five) for undo.
Masks travel as packed bits, never as an image file.

## Smoothness and performance

- Canvas pan and zoom are eased with frame-rate-independent damping; wheel zoom is exponential.
- The workspace animates with CSS transitions that share the same easing tokens; the right panel
  and dock animate their grid tracks, so resizing and collapsing move as one.
- `lib/perf.ts` watches real frame times. If the canvas cannot hold a 16 ms frame, decorative
  effects (glass blur, the travelling panel edge, logo glow) switch off, and return when it recovers.
- `prefers-reduced-motion` turns decorative animation off and shortens the rest.
