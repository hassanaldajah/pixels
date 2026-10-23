# The Security Gate (Module S)

Every image that enters Pixels, whether dragged in, picked, pasted or part of a batch, goes
through this pipeline **on the backend** before any code touches its pixels. The browser only does
a fast pre-check for friendlier messages; it is not trusted.

| #   | Step                  | Where it runs | What it does                                                                                                                           |
| --- | --------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Size and count limits | server        | The upload is streamed to disk with a hard byte cap (default 200 MB); a declared `Content-Length` over the cap is refused unread.      |
| 2   | Magic bytes           | server        | The real type comes from the file signature. A `.png` that is really an executable, ZIP, script or HTML is refused.                    |
| 3   | Allowlist             | server        | PNG, JPEG, WebP, TIFF, BMP, HEIC/HEIF, AVIF. SVG is refused because it can carry scripts. GIF and RAW are not accepted yet.            |
| 4   | Decompression bomb    | sandbox       | Header dimensions are read first; over 300 MP (configurable) is refused before a pixel is decoded. Pillow's bomb warning is fatal.     |
| 5   | Structural validation | sandbox       | `verify()`, then a full decode. Truncated or corrupt files are refused.                                                                |
| 6   | Polyglot / appended   | server        | Finds where the format says the image ends (PNG `IEND`, JPEG `EOI`, RIFF size, BMP size, ISO-BMFF boxes) and refuses extra data.       |
|     |                       |               | Also searches the whole file for embedded PE/ELF executables, ZIP, RAR, 7-Zip and PDF signatures.                                      |
| 7   | Malware scan          | server        | ClamAV through `clamd` when it is running, plus the YARA rules in `server/security/yara/`.                                             |
| 8   | Sandboxed decoding    | sandbox       | Decoding happens in a separate process with a memory cap, CPU-time cap and a wall-clock timeout.                                       |
| 9   | Sanitise              | sandbox       | The pixels are re-encoded into a fresh 8-bit PNG. The original bytes are deleted and never reach a model or an export.                 |
| 10  | Metadata hygiene      | sandbox       | EXIF, XMP, IPTC and text chunks are dropped. Orientation and the ICC profile are applied, then discarded. GPS is reported, never kept. |
| 11  | Quarantine and log    | server        | Rejected files are not stored. `security.log` gets one JSON line: filename hash, reason, time. No image content.                       |

Steps 4, 5, 9 and 10 need a decoder, so they run inside the sandboxed worker instead of the
server. The server never decodes untrusted bytes.

The wording is deliberate: a file that clears the gate **"passed Pixels security checks"**. Pixels
never claims a file is virus-free.

## Project files

A `.pxe` project is an archive, so it gets its own checks before its image reaches the gate: exactly
`project.json` and `original.png` (anything else, including path-traversal names, is refused), no
encryption, and every entry is read with a hard byte cap that does not trust the archive's header, so a
zip bomb is stopped without being inflated. `project.json` is validated against a strict schema. Then
`original.png` goes through all the steps above, exactly like a new upload.

## Network and application hardening

- The backend binds to `127.0.0.1`. LAN access needs `--lan` and a generated access token, and
  `Settings` refuses any other non-loopback host.
- A `Host` allow-list blocks DNS-rebinding pages. An `Origin` check covers every state-changing
  request and every WebSocket, so other websites cannot post to the local server.
- There are no CORS headers at all: the app is same-origin only (in development Vite proxies
  `/api` and `/ws`, so it stays same-origin).
- Strict Content-Security-Policy (`script-src 'self'`, no `eval`, no remote scripts or fonts).
  Fonts are self-hosted; the build never inlines assets as `data:` URIs.
- Client filenames are display-only. Files on disk are named by random UUID and every id is
  validated against `^[0-9a-f]{32}$`.
- No machine-learning models are used, so there are no weights or pickle files to load.

## Honest limits

These are known and intentional; none is hidden by the UI.

- **The sandbox is resource containment, not a jail.** On Windows it is a Job Object (memory,
  CPU time, no extra processes, no desktop or clipboard access, killed with the job). On Linux and
  macOS it uses `setrlimit`, a new session and, when the kernel allows it, `unshare -rn` for an empty
  network namespace. macOS cannot cap a process's address space, so there the decoder's memory is not
  limited (the CPU, file-size and time limits still apply). The worker can still read files the
  current user can read.
- **Network isolation is OS-enforced on Linux** (when `unshare -rn` works) **and on Windows when the firewall rule
  exists.** Run `scripts/windows-block-network.ps1` once as administrator (undo with `-Remove`): it blocks outbound
  internet for the backend's Python. Pixels only talks to itself on 127.0.0.1, which the firewall does not filter.
  Without the rule the worker still blocks sockets inside its own process, which is defence in depth, not a guarantee.
  `GET /api/security/status` reports which one you have.
- **Linux and macOS sandbox code is covered by CI, not by the developer's Windows machine.**
- **ClamAV is optional and free.** Without it you still get every other layer; the UI says so once. To turn it on
  (Windows): `winget install ClamAV.ClamAV`, copy `conf_examples\clamd.conf.sample` to `clamd.conf` and
  `freshclam.conf.sample` to `freshclam.conf` in the install folder, delete the line `Example` in both, add
  `TCPSocket 3310` and `TCPAddr 127.0.0.1` to `clamd.conf`, run `freshclam` once (downloads the signatures), then start
  `clamd`. Pixels connects by itself and the popover shows "ClamAV: connected". It is a background process, so start it
  only when you want it.
- **Hidden data in pixel values (LSB steganography)** is screened statistically on every opened picture and shown in
  the inspector ("Hidden data"). A hit is a notice, not a rejection: noisy honest photos can look similar. Set
  `PIXELS_SCRUB_LSB=1` to rewrite the lowest bit of every pixel, which destroys such a payload at a cost of at most
  1/255 per channel.
- **VirusTotal without uploading.** The inspector shows the SHA-256 of the original file with a link that looks the hash
  up on VirusTotal. The picture itself never leaves the computer.
- **Trailing data is refused by default.** Some phone photos (motion photos, multi-picture JPEGs)
  append a second image after the first. Set `PIXELS_REJECT_TRAILING_DATA=0` to allow them; the
  extra bytes are still discarded by re-encoding.
- **TIFF** has no end marker, so only the embedded-signature search applies to it.
- **Pillow decodes to 8 bits per channel.** 16-bit sources are reduced. A 16-bit pipeline needs a
  different decoder and arrives with the editing phase.
- **RAW** files are not accepted yet. URL import is not offered: it would need an outbound
  request, which Pixels never makes.

## Tests

`server/tests/security/` builds its fixtures in memory (no binaries in the repository). It checks
that these are all refused, with the right step and a readable reason: a renamed executable, a ZIP
appended to a PNG, a ZIP hidden in a JPEG comment, a truncated JPEG, a decompression bomb, a
script in EXIF, a PHP shell in a PNG text chunk, SVG, GIF and HTML. It also checks that valid
PNG, JPEG, WebP, TIFF and BMP files are accepted, that metadata and orientation are handled, that
the memory limit and timeout really stop the worker, and that the worker has no network.

```bash
cd server && uv run pytest tests/security
python -m tests.security.fixtures out/   # write the fixtures to disk for manual testing
```
