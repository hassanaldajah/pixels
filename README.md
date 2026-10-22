# pixels

A personal, local-first image studio. It runs on your own machine, works offline, has no accounts,
no cloud and no telemetry, and treats every image you open as untrusted until it has passed a
security gate.

> **Everything runs on your computer, with ordinary algorithms: no AI models, no downloads, no cloud.**
> That keeps it small (the Windows installer is about 37 MB), predictable and private.

## Download

Get the latest build from the [Releases page](https://github.com/hassanaldajah/pixels/releases/latest):

| System  | File                                        |
| ------- | ------------------------------------------- |
| Windows | `pixels_<version>_x64-setup.exe`            |
| Linux   | `pixels_<version>_amd64.AppImage` or `.deb` |

Every file has a `.sha256` next to it. Check the download before you run it:

```powershell
# Windows
certutil -hashfile pixels_0.1.1_x64-setup.exe SHA256
```

```bash
# Linux
sha256sum -c pixels_0.1.1_amd64.AppImage.sha256
```

The Windows installer is not signed (there is no paid certificate), so SmartScreen asks for confirmation the first
time. The app is free, works offline and sends nothing anywhere.

## What works today

- **Security Gate**: every file is size-capped, type-checked by its real bytes, scanned for
  hidden payloads and malware, decoded in a resource-limited sandbox and re-encoded into a clean
  PNG with all metadata removed. [How it works and what it cannot do](docs/SECURITY_GATE.md).
- **Viewport**: a WebGL 2 canvas with tiled textures, smooth 10%-1000% zoom (wheel, pinch,
  keyboard), pan (space-drag or middle mouse), pixel grid above 800%, rulers, draggable snapping
  guides, rule-of-thirds and custom grids, a mini-map, and a cursor read-out.
- **Workspace**: glass panels, a command palette (`Ctrl K`), a full shortcut map (`?`), Studio
  Dark and Light Studio themes with a shader-based wipe between them, resizable and collapsible
  panels, a job queue with live progress over WebSocket, and an opening animation.
- **Core editor** ([how it works](docs/PIPELINE.md)): non-destructive edits with unlimited undo and a
  clickable history; crop with ratio presets and px/cm/in + DPI, rotate, flip, straighten (auto-detect
  or draw the horizon), skew, four-point perspective, canvas and picture size; exposure, contrast,
  highlights, shadows, whites, blacks, temperature, tint, vibrance, saturation, HSL per colour, curves,
  levels, noise reduction, sharpening, vignette and grain; before/after split, side-by-side, and hold `\`.
- **The preview matches the export.** Edits run live on the GPU; the server renders the same edit
  with NumPy for the export. A browser test compares them pixel by pixel (within 1/255 today).
- **Export and presets**: PNG, JPEG, WebP, AVIF and TIFF, 8 or 16 bit, sRGB or Display P3, optional camera
  info; app-icon sets (iOS, Android adaptive, macOS, Windows, favicons, PWA); store and social sizes;
  batch recipes with a per-file security report; `.pxe` project files.
- **Pixel Art**: turn any picture into pixel art. Pixel size, edge-preserving smoothing, an automatic
  palette (k-means) or Game Boy, PICO-8, NES, Commodore 64, CGA and Endesga 32, your own `.hex` / `.gpl`
  palette, ordered (2/4/8) / Floyd-Steinberg / Atkinson dithering, outline, and export as the 1x sprite or
  scaled up with crisp blocks. The preview is produced by the same code as the export.
- **Eraser**: paint over anything and it is removed; the gap is filled from the surrounding texture
  (PatchMatch exemplar inpainting, coarse to fine; fast and high-quality modes). Every removal makes a new
  version, so it can be undone.
- **Retouch**: heal spots with the same fill, smooth skin while keeping eyes, hair and edges sharp, and
  cut out a plain background (studio shots, screenshots) with a soft edge.
- **Upscale**: Lanczos enlargement up to 4x with a sharpening pass that is limited so it adds no bright or
  dark halos. It cannot invent detail that was never there.

## Install and run

You need **Node.js 22+**, **pnpm**, **uv** (it installs Python 3.11 for you) and **git**.

```powershell
# Windows
npm install -g pnpm
py -m pip install --user uv
.\start.ps1
```

```bash
# Linux
npm install -g pnpm
curl -LsSf https://astral.sh/uv/install.sh | sh
./start.sh
```

The script installs dependencies, builds the web app, starts the backend on
`http://127.0.0.1:8765` and opens your browser. Options:

| Option                   | Effect                                                              |
| ------------------------ | ------------------------------------------------------------------- |
| `-Dev` / `--dev`         | Vite dev server with hot reload on `http://localhost:5173`          |
| `-Lan` / `--lan`         | Allow other devices on your network; prints a one-time access token |
| `-Rebuild` / `--rebuild` | Rebuild the web app first                                           |

Optional: install [ClamAV](https://www.clamav.net/) and start `clamd` to add signature scanning.
Without it everything else still runs and the app tells you once.

Your data lives outside the repository: `%LOCALAPPDATA%\Pixels` on Windows,
`~/Library/Application Support/Pixels` on macOS, `~/.local/share/Pixels` on Linux. Sanitised working
copies older than 14 days are deleted automatically. Every setting can be overridden with a
`PIXELS_*` environment variable; see [server/app/config.py](server/app/config.py).

## Development

```bash
cd server && uv sync && uv run pytest          # backend: unit, API and security-gate tests
cd server && uv run ruff check . && uv run black --check . && uv run mypy
pnpm install
pnpm --filter @pixels/web run typecheck        # tsc
pnpm --filter @pixels/web run lint             # eslint (also rejects hard-coded colours)
pnpm --filter @pixels/web run test             # vitest: viewport maths, tokens, shortcuts, pre-check
pnpm --filter @pixels/web run build
# real-browser test: start the backend, then
PIXELS_BASE=http://127.0.0.1:8765 pnpm --filter @pixels/web run e2e          # shell, security, viewport
PIXELS_BASE=http://127.0.0.1:8765 pnpm --filter @pixels/web run e2e:edit   # GPU-vs-server parity, editor flows
pnpm --filter @pixels/web run brand            # regenerate icons from brand/source/logo-original.png
```

Pre-commit hooks (`ruff`, `black`, `mypy`, `prettier`, `eslint`, `tsc`, **gitleaks**, and a block
on files over 10 MB) are described in [.pre-commit-config.yaml](.pre-commit-config.yaml). CI runs
lint, type checks, unit tests, the security-gate tests on Windows and Linux, a dependency
audit, CodeQL, and the browser test.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.

## Troubleshooting

- **"WebGL 2 is not available"**: update your graphics driver or enable hardware acceleration in
  your browser. The viewport needs WebGL 2.
- **"Backend offline" in the top bar**: the Python server is not running. Start it with
  `start.ps1` / `start.sh`, or `cd server && uv run python -m app`.
- **A file of mine is refused**: the message names the step and the reason. Common ones: the
  extension does not match the contents; a phone photo has a second image appended (set
  `PIXELS_REJECT_TRAILING_DATA=0`); SVG and GIF are not accepted.
- **"ClamAV is not running"**: optional. Install it and start `clamd`, or ignore the notice.
- **Port 8765 is taken**: `start.ps1 -Port 9000` (or `--port=9000`).
- **`uv sync` fails building a package on Windows**: make sure you are on Python 3.11
  (`uv python install 3.11`); the dependencies ship wheels for it.

## Roadmap

Done: the Security Gate, the viewport and workspace, the core editor, export and presets, Pixel Art,
Eraser, Retouch, Upscale, and the Windows installer. Still to do: publish the first release on GitHub (the
Linux AppImage and `.deb` come from the release workflow, which has not run yet) and a 3D device-mockup
studio. Windows builds are unsigned (no paid certificate), so SmartScreen asks for confirmation the first
time; [docs/SECURITY_GATE.md](docs/SECURITY_GATE.md) and the release checksums let you verify what you run.

## Licence

[MIT](LICENSE). Third-party fonts are bundled under their own licences (Inter, Space Grotesk and
JetBrains Mono, all SIL OFL). No models or datasets are bundled.
