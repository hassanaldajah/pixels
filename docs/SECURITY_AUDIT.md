# Security audit (October 2026)

What was checked, what was found, and what is still a known limit. Everything below was run against the real code,
not read from documentation.

## Scope

- The Security Gate (`server/security/`) and every upload path.
- The HTTP surface: Host allow-list, Origin check, CORS, CSP, filenames, error messages.
- Static analysis of the server (`bandit`), dependency audits (`pip-audit`, `pnpm audit`), VirusTotal on the release (0/65).
- Steganography: can an image carry hidden data through pixels?

## Steganography test

Test images were built with a payload hidden in each place below, sent through the real upload route, and the result was
inspected.

| Where the payload hides | Result |
|-------------------------|--------|
| Text chunk (`tEXt`) in a PNG | **Removed** (metadata hygiene) |
| Private / unknown PNG chunk | **Removed** (re-encode drops it) |
| Bytes appended after the PNG end marker (`IEND`) | **Refused** (HTTP 422, polyglot check) |
| JPEG comment segment | **Removed** |
| Least-significant bits of the colour pixels (LSB) | **Survives** |
| Least-significant bits of the alpha channel | **Survives** |

**Reading.** Everything that hides *beside* the picture (chunks, comments, trailing data, polyglots) is neutralised,
because the file is decoded and written again as a clean 8-bit PNG. Data hidden *inside the pixel values* is part of
the picture itself. A lossless re-encode keeps every pixel, so the payload stays. This is a property of lossless
formats, not a bug in the gate. It is also harmless on its own: nothing in pixels executes pixel data, and the payload
is inert until some other program extracts and uses it.

Not done on purpose: silently rounding the low bits of every picture would damage honest images. If a scrub is wanted
it should be an opt-in export setting, not the default.

## Static analysis (bandit)

0 High, 1 Medium, 7 Low. All reviewed, none needs a change:

- B104 bind to all interfaces: only with the explicit `--lan` flag (and a token is required then).
- B105 "password" `x-pixels-token`: a header name, not a secret.
- B101 `assert` in `icc.py` and `inpaint.py`: internal invariants, not input checks.
- B404 / B603 subprocess: the sandbox worker. The command line is built from fixed parts and a scratch path, never from
  uploaded content, and no shell is used.

## HTTP probes

All passed: foreign Host rejected, foreign Origin rejected, no CORS headers, strict CSP present, random UUID filenames,
no stack traces or paths in error bodies.

## Added after the audit

- Hidden-data screen on every opened picture (`server/security/stego.py`): chi-square on pairs of values plus an
  LSB-randomness check for colour, and a near-opaque-alpha check. Tested on 60 honest synthetic photos (0 flagged) and
  on full, half and 30% payloads (20/20, 20/20, 17/20 found). Honest limits: a very small payload (a few hundred bytes
  in a large photo) is below what statistics can see; a hit is a notice only.
- Opt-in `PIXELS_SCRUB_LSB=1` to destroy such payloads.
- SHA-256 of the original file in the inspector, with a VirusTotal hash lookup (no upload).
- Windows firewall rule script and detection, so "OS network isolation" can be on for Windows too.

## Open items

1. **Pixel-domain steganography** still survives a normal import; it is now flagged when it is large enough to see, and
   `PIXELS_SCRUB_LSB=1` removes it.
2. **Dependabot `glib`**: a Linux-only dependency of Tauri, present in `Cargo.lock`. It is not compiled into the
   Windows build. Fixed when Tauri updates it.
3. Honest limits already documented in `SECURITY_GATE.md`: the sandbox is containment, not a jail; network isolation of
   the worker is OS-enforced on Linux, and on Windows once the firewall script has been run; ClamAV is optional.
