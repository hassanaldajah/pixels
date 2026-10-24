# Changelog

All notable changes to Pixels. Versions follow [Semantic Versioning](https://semver.org/).

## 0.3.0 (2026-10-24)

### Added

- **Video editor** (switch with Photos | Video in the top bar). Import video, music, voice-overs and pictures
  (each through the new media Security Gate); a magnetic main track plus video, text and audio tracks; move, trim,
  split (S), delete, undo; speed 0.25x to 4x; volume, fade in and out; position, scale, rotation and opacity with
  keyframes; colour (exposure, contrast, saturation, temperature, vignette) and ten looks; transitions (fade, dip to
  black, wipe, slide, zoom); entrance and exit animations; titles with the Arabic font; frame shapes 16:9, 9:16, 1:1,
  4:5, 4:3, 21:9; thumbnails and sound waveforms on the timeline; a phone frame and TikTok / Reels / Shorts safe
  zones; export to MP4 (H.264 or HEVC with AAC) at 720p, 1080p, 2K or 4K, offering only the sizes this computer can
  encode, written straight to disk.
- **Media Security Gate** (`/api/media`): MP4, MOV, WebM, MKV, M4A, WAV and MP3 are checked without decoding:
  every byte must belong to a known container element, nothing may follow the end, codecs are allow-listed,
  encrypted tracks and references to other files are refused, metadata (location, device, tags, attachments) is
  blanked in place, and YARA reads only headers and metadata. Decoding happens in the platform's sandboxed WebCodecs
  decoders.
- **Draw** tool (N): pen with pressure, marker, highlighter and eraser in any colour.
- **Pen** tool (G): vector paths with corner and curved points, fill and outline; path layers stay editable.
- **Liquify** tool (Q): push, bloat, pinch and restore.
- **Colour picker** everywhere: spectrum, transparency, HEX/RGB, eyedropper, a 144-colour palette and about 170
  colours by name in Arabic and English, recent colours.
- **Text**: outline, shadow, background box, two-colour gradient, alignment, letter and line spacing, an Arabic font,
  ready-made styles, a live preview; text layers can be edited after they are added.
- **Fill layers**: solid colour, linear or radial gradient, and a paint bucket with tolerance and soft edge.
- **Painted layer masks** that move and scale with their layer.
- **Magic wand** selection by colour.
- **Brush**: "Affects" shadows, midtones or highlights only; new Sharpen and Smudge brushes.
- **Blur kinds**: motion (with direction), lens (bokeh), spin, and a one-click tilt-shift.
- **Eight blend modes**: colour dodge, colour burn, hard light, exclusion, hue, saturation, colour, luminosity.
- **Actions**: save the current look and apply it to any picture in one step (also usable as batch recipes).
- **Recent work**: pictures with their full edit history and video projects are kept, so a window closed by mistake
  loses nothing; "Continue where you left off" on the start screen.
- **Guided tour** on first launch (photo editor, then video editor), replayable from the command palette.

### Changed

- Smoother interface: panels ease in when switching tools, press feedback on every control, softer focus rings,
  growing slider thumbs; the identity (colours, logo, fonts) is unchanged.
- Arabic interface: buttons size to their words and tool names wrap instead of overflowing; the tool rail shows when
  it scrolls; the "side by side" label is shorter. The Arabic browser test now fails on any text that spills out.
- The ClamAV notice is shown once per session instead of on every picture.
- The Windows installer now carries the Pixels icon.

### Fixed

- Large AI-made pictures were rejected as "PHP, ASP or shell code": the YARA rule matched the three bytes `<%@`, which
  occur by chance in compressed pixel data. It now needs a real ASP directive.
- The desktop shell escapes every character of an error message before showing it in the loading page.
- The server reported version 0.1.1.

### Security

- No new runtime dependency except `mediabunny` 1.61.3 (MPL-2.0, no install scripts, pinned, integrity checked).
  FFmpeg was considered and rejected because of its steady stream of CVEs.
- `pnpm audit` and `pip-audit`: no known vulnerabilities.
