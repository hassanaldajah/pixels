# Project status and how to continue

Last updated: 2026-10-24. Read this first in a new session.

## Where we are

All the planned tools are built and tested. There is no AI anywhere in the project: everything is ordinary
algorithms that run locally.

- Security Gate, FastAPI backend, WebGL viewport, themes, logo and icons, opening animation (`brand/Splash.tsx`).
- Core editor: the GPU preview matches the NumPy export to within 1/255. Export (PNG/JPEG/WebP/AVIF/TIFF,
  8/16 bit, sRGB/P3), app-icon sets, store sizes, batch recipes, `.pxe` projects.
- **Pixel Art** (the user's priority): `pipeline/pixelart.py`, the preview route and `PixelArtPanel`.
- **Eraser**: PatchMatch inpainting (`pipeline/inpaint.py`), `POST /api/images/{id}/erase`, `EraserPanel` and
  `EraserOverlay`.
- **Retouch** (heal spots, skin smoothing, plain-background cut-out) and **Upscale**: `pipeline/retouch.py`,
  `app/api_retouch.py`, `RetouchPanel`, `UpscalePanel`.
- Desktop: Tauri 2 shell, frozen backend (PyInstaller), NSIS installer (about 37 MB), installed and run on the
  user's PC. `.github/workflows/release.yml` is written but has never run.

## Version 0.3.0 (video editor and new tools)

See [CHANGELOG.md](../CHANGELOG.md) for the full list. Where things live:

- Video editor: `apps/web/src/video/` (`model.ts` timeline logic with tests, `store.ts` history and autosave,
  `media.ts` mediabunny/WebCodecs reading, `render.ts` the one frame composer used by preview and export,
  `player.ts` playback on the audio clock, `exporter.ts` MP4 export, `thumbs.ts`, `ui/`).
- Media Security Gate: `server/security/media.py` (container walkers) and `media_gate.py`; routes in
  `server/app/api_media.py`; tests in `server/tests/security/test_media.py`.
- Pixel tools with CPU-mirrored algorithms (identical in numpy and TypeScript, parity-tested): smudge
  (`pipeline/smudge.py` / `lib/smudge.ts`) and liquify (`pipeline/liquify.py` / `lib/liquify.ts`).
- Recent work and autosave: `lib/recent.ts` (IndexedDB), `lib/autosave.ts`; guided tour: `components/Tour.tsx`.
- Not done yet: Linux packages were not built on this machine (the release workflow builds them).

## Version 0.2.1 (security)

- Hidden-data screen on every opened picture (`server/security/stego.py`), optional `PIXELS_SCRUB_LSB=1`.
- SHA-256 of the original file and a VirusTotal hash lookup in the Inspector (the picture is never uploaded).
- Windows firewall script `server/scripts/windows-block-network.ps1` and detection of its rule.
- `docs/SECURITY_AUDIT.md` (bandit, HTTP probes, steganography results) and a Security section in the README.
- Free security ideas still open: a real sandbox (AppContainer), decoder fuzzing, SBOM, privacy report, C2PA.
  The v0.2.0 installer scanned 0 of 69 on VirusTotal (a snapshot, not a guarantee).
- The promo video is built outside the repo (HTML + Three.js + Playwright + ffmpeg).

## Next steps, in order

1. User: create an empty public GitHub repo, run `gh auth login`, enable 2FA and branch protection on `main`.
2. Write `docs/VERIFY.md` (checksums, provenance, Windows Sandbox) and pin GitHub Actions to commit SHAs;
   add the `cargo` ecosystem to `.github/dependabot.yml`. The Linux build and the release workflow are
   untested until they run on GitHub.
3. Ask before pushing anything. Then tag `v0.1.0` to trigger the release.
4. Regenerate `docs/screenshots/` (headless browser only) for the new design, and add them to the README.
5. Optional: a 3D device-mockup studio; the Windows Sandbox test (needs firmware virtualization).

## Rules from the user

- Nothing vulnerable: `pip-audit` and `pnpm audit` must stay clean; replace flagged packages.
- Everything free. No AI. Colours only from `apps/web/src/tokens.ts`. The app must feel very smooth.
- Never open the user's personal files; never capture their screen (headless browser captures only).
- The GPU/server parity test (`apps/web/scripts/e2e-edit.mjs`) must stay green.

## Commands

```bash
cd server && uv run pytest && uv run ruff check . && uv run black --check . && uv run mypy
pnpm --filter @pixels/web run typecheck && pnpm --filter @pixels/web run lint && pnpm --filter @pixels/web run test
# real-browser tests (backend running):
PIXELS_BASE=http://127.0.0.1:8765 pnpm --filter @pixels/web run e2e
PIXELS_BASE=http://127.0.0.1:8765 pnpm --filter @pixels/web run e2e:edit
```

Start the app with `.\start.ps1`. uv is installed with `py -m pip install --user uv`; call it as `py -m uv`
if it is not on PATH.
