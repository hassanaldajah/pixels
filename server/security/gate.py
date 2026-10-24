"""The Security Gate pipeline (Module S).

Order of execution, with the spec's step numbers:

    1 size  ->  2 magic  ->  3 allowlist  ->  6 polyglot  ->  7 malware  ->  8 sandbox
    (the sandboxed worker then performs 4 bomb, 5 structure, 8 decode, 9 sanitise, 10 metadata)

Steps 4, 5, 9 and 10 need a decoder, so they run inside the sandbox rather than in the server.
Step 11 (quarantine & log) is the caller's `SecurityLog.rejected`. The server only ever receives
the sanitised PNG back; the original bytes are deleted by the caller.
"""

from __future__ import annotations

import hashlib
import json
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.config import Settings
from security import magic, polyglot, stego
from security.errors import GateRejection
from security.sandbox import SandboxCapabilities, capabilities, run_sandboxed
from security.scanners import ClamdClient, YaraScanner

WORKER = Path(__file__).with_name("worker.py")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

STEPS: tuple[tuple[str, str], ...] = (
    ("size", "Size & count limits"),
    ("magic", "File signature matches"),
    ("allowlist", "Format allowlist"),
    ("bomb", "Decompression-bomb check"),
    ("structure", "Structural validation"),
    ("polyglot", "Hidden-payload & polyglot scan"),
    ("malware", "Malware scan"),
    ("sandbox", "Sandboxed decoding"),
    ("sanitize", "Re-encoded to a clean format"),
    ("metadata", "Metadata stripped"),
)
STEP_LABELS = dict(STEPS)
WORKER_CODE_TO_STEP = {
    "decompression_bomb": "bomb",
    "corrupt_image": "structure",
    "format_not_allowed": "allowlist",
    "too_large_to_decode": "sandbox",
    "internal_error": "sandbox",
}
Progress = Callable[[str, str, int, int], None]


@dataclass
class StepResult:
    id: str
    label: str
    status: str = "pending"  # pending | passed | partial | failed
    detail: str = ""

    def to_json(self) -> dict[str, str]:
        return {"id": self.id, "label": self.label, "status": self.status, "detail": self.detail}


@dataclass
class GateResult:
    clean_path: Path
    meta: dict[str, Any]
    steps: list[StepResult]
    notices: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {
            "meta": self.meta,
            "steps": [s.to_json() for s in self.steps],
            "notices": self.notices,
            "verdict": "Passed Pixels security checks",
        }


class _Tracker:
    def __init__(
        self, on_progress: Progress | None, steps: tuple[tuple[str, str], ...] = STEPS
    ) -> None:
        self.steps = {sid: StepResult(sid, label) for sid, label in steps}
        self._on_progress = on_progress

    def done(self, step: str, status: str = "passed", detail: str = "") -> None:
        result = self.steps[step]
        result.status, result.detail = status, detail
        if self._on_progress:
            finished = sum(1 for s in self.steps.values() if s.status != "pending")
            self._on_progress(step, result.label, finished, len(self.steps))

    def reject(self, step: str, code: str, message: str, status_code: int = 422) -> GateRejection:
        self.steps[step].status, self.steps[step].detail = "failed", message
        return GateRejection(
            code, step, message, status_code, [s.to_json() for s in self.steps.values()]
        )

    def snapshot(self) -> list[StepResult]:
        return list(self.steps.values())


class SecurityGate:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.yara = YaraScanner()
        self.clam = ClamdClient(settings.clamd_host, settings.clamd_port, settings.clamd_socket)

    # ----------------------------------------------------------------------------- status
    def status(self) -> dict[str, Any]:
        s = self.settings
        sandbox: SandboxCapabilities = capabilities()
        clam_up = self.clam.available()
        return {
            "clamav": {
                "available": clam_up,
                "required": s.clamav_required,
                "install_hint": (
                    None
                    if clam_up
                    else "Install ClamAV and start clamd (Windows: winget install ClamAV.ClamAV; "
                    "macOS: brew install clamav; Linux: apt install clamav-daemon) to add "
                    "signature-based scanning. The other checks still run."
                ),
            },
            "yara": {
                "available": self.yara.available,
                "rules": self.yara.rule_count,
                "error": self.yara.error,
            },
            "sandbox": sandbox.to_json(),
            "limits": {
                "max_file_bytes": s.max_file_bytes,
                "max_batch_files": s.max_batch_files,
                "max_pixels": s.max_pixels,
                "worker_memory_bytes": s.worker_memory_bytes,
                "worker_timeout_seconds": s.worker_timeout_seconds,
                "strict_extension_match": s.strict_extension_match,
                "reject_trailing_data": s.reject_trailing_data,
            },
            "allowed_formats": sorted(magic.ALLOWED_KINDS),
        }

    # ----------------------------------------------------------------------------- pipeline
    def inspect(
        self,
        upload: Path,
        *,
        filename: str,
        clean_png: Path,
        on_progress: Progress | None = None,
    ) -> GateResult:
        """Run the whole pipeline on `upload`. Blocking; call it from a worker thread."""
        track = _Tracker(on_progress)
        notices: list[str] = []
        kind = self._check_size_and_type(upload, filename, track)
        self._check_payload(upload, kind, track)
        self._check_malware(upload, track, notices)
        original_sha = _sha256(upload)
        meta = self._decode_in_sandbox(upload, clean_png, track, notices)
        meta["detected_kind"] = kind
        meta["sha256_original"] = original_sha
        meta["stego"] = self._screen_pixels(clean_png, notices)
        meta["sha256_clean"] = _sha256(clean_png)
        return GateResult(clean_png, meta, track.snapshot(), notices)

    def _screen_pixels(self, clean_png: Path, notices: list[str]) -> dict[str, Any]:
        """Hidden-data screen on the sanitised picture; optionally scrub the low bits afterwards."""
        try:
            report = stego.analyse(clean_png)
            if report.suspicious:
                notices.extend(report.findings)
            if self.settings.scrub_lsb:
                stego.scrub(clean_png)
                report.scrubbed = True
                notices.append(
                    "The lowest bits of every pixel were rewritten to remove any hidden data."
                )
        except Exception as exc:  # a screening failure must never block a clean picture
            return {
                "checked": False,
                "suspicious": False,
                "findings": [f"Screen failed: {type(exc).__name__}"],
                "scrubbed": False,
            }
        return report.to_json()

    def _check_size_and_type(self, upload: Path, filename: str, track: _Tracker) -> str:
        s = self.settings
        size = upload.stat().st_size
        if size == 0:
            raise track.reject("size", "empty_file", "The file is empty.")
        if size > s.max_file_bytes:
            raise track.reject(
                "size",
                "file_too_large",
                f"The file is {size / 1024**2:,.0f} MB; the limit is {s.max_file_bytes / 1024**2:,.0f} MB.",
                413,
            )
        track.done("size", detail=f"{size / 1024**2:,.2f} MB")

        with upload.open("rb") as handle:
            head = handle.read(magic.HEAD_BYTES)
        kind = magic.detect_kind(head)
        has_name = bool(Path(filename).suffix)
        if kind not in magic.ALLOWED_KINDS:
            claimed_image = any(magic.extension_matches(k, filename) for k in magic.ALLOWED_KINDS)
            if claimed_image:
                raise track.reject(
                    "magic",
                    "type_mismatch",
                    f"The file is named {Path(filename).suffix.lower()} but its contents are "
                    f"{_article(magic.label(kind))}, not an image.",
                )
            track.done("magic", detail=f"Detected {magic.label(kind)}")
            raise track.reject("allowlist", "format_not_allowed", _not_allowed_message(kind))
        if (
            self.settings.strict_extension_match
            and has_name
            and not magic.extension_matches(kind, filename)
        ):
            raise track.reject(
                "magic",
                "type_mismatch",
                f"The file is named {Path(filename).suffix.lower()} but its contents are "
                f"{magic.label(kind)}. Rename it or re-export it from the app that made it.",
            )
        track.done("magic", detail=f"Detected {magic.label(kind)}")
        track.done("allowlist", detail=f"{magic.label(kind)} is allowed")
        return kind

    def _check_payload(self, upload: Path, kind: str, track: _Tracker) -> None:
        findings = polyglot.analyze(
            upload, kind, reject_trailing=self.settings.reject_trailing_data
        )
        if findings:
            first = findings[0]
            raise track.reject("polyglot", first.code, first.message)
        detail = "No data after the image end, no embedded executables or archives"
        if kind in ("tiff",):
            detail = "TIFF has no end marker: checked for embedded executables and archives only"
        track.done("polyglot", detail=detail)

    def _check_malware(self, upload: Path, track: _Tracker, notices: list[str]) -> None:
        verdict = self.clam.scan_file(upload)
        if verdict.status == "infected":
            raise track.reject(
                "malware", "malware_detected", f"ClamAV flagged this file: {verdict.detail}."
            )
        if verdict.status != "clean" and self.settings.clamav_required:
            raise track.reject(
                "malware",
                "clamav_required",
                f"ClamAV is required but unavailable ({verdict.detail}).",
            )
        hits = self.yara.scan_file(upload)
        if hits:
            raise track.reject("malware", "suspicious_content", f"{hits[0].description}.")

        engines = []
        if verdict.status == "clean":
            engines.append("ClamAV")
        if self.yara.available:
            engines.append(f"{self.yara.rule_count} YARA rules")
        if verdict.status == "clean" and self.yara.available:
            track.done("malware", detail=f"Clean ({' + '.join(engines)})")
            return
        if verdict.status == "skipped":
            notices.append(f"ClamAV skipped this file: {verdict.detail}.")
        elif verdict.status == "unavailable":
            notices.append(
                "ClamAV is not installed or not running, so signature scanning was skipped. "
                "Install it to add that layer; all other checks ran."
            )
        if not self.yara.available:
            notices.append(f"YARA rules could not be loaded ({self.yara.error}).")
        track.done("malware", "partial", f"Ran: {', '.join(engines) or 'nothing'}")

    def _decode_in_sandbox(
        self, upload: Path, clean_png: Path, track: _Tracker, notices: list[str]
    ) -> dict[str, Any]:
        s = self.settings
        outcome = run_sandboxed(
            worker_command(upload, clean_png, s.max_pixels),
            scratch=clean_png.parent,
            timeout=s.worker_timeout_seconds,
            memory_bytes=s.worker_memory_bytes,
            cpu_seconds=s.worker_cpu_seconds,
        )  # fmt: skip
        if outcome.timed_out:
            clean_png.unlink(missing_ok=True)
            raise track.reject(
                "sandbox", "decode_timeout",
                f"Decoding took longer than {s.worker_timeout_seconds:.0f} s and was stopped.",
            )  # fmt: skip
        try:
            result: dict[str, Any] = json.loads(outcome.stdout.decode("utf-8", "replace"))
        except ValueError:
            clean_png.unlink(missing_ok=True)
            raise track.reject(
                "sandbox",
                "decoder_crashed",
                "The sandboxed decoder was stopped (it hit the memory/CPU limit or crashed). "
                "The file was rejected.",
            ) from None
        if not result.get("ok"):
            clean_png.unlink(missing_ok=True)
            code = str(result.get("code", "internal_error"))
            step = WORKER_CODE_TO_STEP.get(code, "sandbox")
            raise track.reject(step, code, str(result.get("message", "The image was rejected.")))
        if not _is_png(clean_png):
            clean_png.unlink(missing_ok=True)
            raise track.reject(
                "sanitize", "sanitize_failed", "The sanitised image could not be verified."
            )

        track.done("bomb", detail=f"{result['width']:,} x {result['height']:,} px")
        track.done("structure", detail="Fully decoded without errors")
        track.done("sandbox", detail="Decoded in a resource-limited process")
        track.done("sanitize", detail="Pixels re-encoded as a fresh 8-bit PNG")
        removed = result.get("metadata_removed") or []
        track.done(
            "metadata",
            detail=("Removed: " + ", ".join(removed)) if removed else "No metadata found",
        )
        notices.extend(result.get("notes", []))
        return {
            k: result[k]
            for k in ("width", "height", "has_alpha", "source_format", "source_mode", "frames",
                      "metadata_removed", "icc_applied", "orientation_applied", "safe_exif")
        }  # fmt: skip


def worker_command(src: Path, dst: Path, max_pixels: int) -> list[str]:
    """The command that starts the decoder. A frozen build re-runs its own executable in worker mode."""
    arguments = ["--src", str(src), "--dst", str(dst), "--max-pixels", str(max_pixels)]
    if getattr(sys, "frozen", False):
        return [sys.executable, "--decode-worker", *arguments]
    return [sys.executable, "-I", str(WORKER), *arguments]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _is_png(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            return handle.read(8) == PNG_SIGNATURE
    except OSError:
        return False


def _article(text: str) -> str:
    return ("an " if text[:1].lower() in "aeiou" else "a ") + text


def _not_allowed_message(kind: str) -> str:
    if kind == "svg":
        return (
            "SVG files are not accepted: they can carry scripts. Export the artwork as PNG first."
        )
    if kind == "gif":
        return "GIF is not an accepted format. Convert it to PNG or WebP."
    if kind == "unknown":
        return (
            "This file is not a recognised image. Accepted: PNG, JPEG, WebP, TIFF, BMP, HEIC, AVIF."
        )
    return f"{magic.label(kind)} files are not images. Accepted: PNG, JPEG, WebP, TIFF, BMP, HEIC, AVIF."
