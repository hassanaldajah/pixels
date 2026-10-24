"""The Security Gate for video and audio.

    1 size  ->  2 magic  ->  3 allowlist  ->  4 structure  ->  5 codecs  ->  6 polyglot
    ->  7 malware  ->  8 metadata

Nothing is decoded here (see `security.media`). The clean copy differs from the upload only in
blanked metadata; the browser then decodes it with the platform's sandboxed decoders, and every
export is a fresh encode, so no original byte reaches an exported file.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.config import Settings
from security import media
from security.gate import Progress, StepResult, _Tracker
from security.scanners import ClamdClient, YaraScanner

MEDIA_STEPS: tuple[tuple[str, str], ...] = (
    ("size", "Size & length limits"),
    ("magic", "File signature matches"),
    ("allowlist", "Format allowlist"),
    ("structure", "Structural validation"),
    ("codecs", "Codec allowlist"),
    ("polyglot", "Hidden-payload & polyglot scan"),
    ("malware", "Malware scan"),
    ("metadata", "Metadata stripped"),
)


@dataclass
class MediaGateResult:
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


class MediaGate:
    def __init__(self, settings: Settings, yara: YaraScanner, clam: ClamdClient) -> None:
        self.settings, self.yara, self.clam = settings, yara, clam

    def inspect(
        self, upload: Path, *, filename: str, clean: Path, on_progress: Progress | None = None
    ) -> MediaGateResult:
        """Blocking; call it from a worker thread. Raises GateRejection."""
        s = self.settings
        track = _Tracker(on_progress, MEDIA_STEPS)
        notices: list[str] = []

        size = upload.stat().st_size
        if size == 0:
            raise track.reject("size", "empty_file", "The file is empty.")
        if size > s.max_media_bytes:
            raise track.reject(
                "size",
                "file_too_large",
                f"The file is {size / 1024**2:,.0f} MB; the limit is {s.max_media_bytes / 1024**2:,.0f} MB.",
                413,
            )
        track.done("size", detail=f"{size / 1024**2:,.2f} MB")

        with upload.open("rb") as handle:
            kind = media.detect_kind(handle.read(media.HEAD_BYTES))
        if kind is None:
            raise track.reject(
                "magic",
                "type_mismatch",
                "The contents are not a video or audio file Pixels accepts "
                "(MP4, MOV, WebM, MKV, M4A, WAV or MP3).",
            )
        if Path(filename).suffix and not media.extension_matches(kind, filename):
            raise track.reject(
                "magic",
                "type_mismatch",
                f"The file is named {Path(filename).suffix.lower()} but its contents are "
                f"{media.KIND_LABELS[kind]}. Rename it or re-export it from the app that made it.",
            )
        track.done("magic", detail=f"Detected {media.KIND_LABELS[kind]}")
        track.done("allowlist", detail=f"{media.KIND_LABELS[kind]} is allowed")

        limits = media.Limits(max_seconds=s.max_media_seconds, max_edge=s.max_video_edge)
        try:
            info = media.inspect(upload, kind, limits)
        except media.MediaError as error:
            raise track.reject(error.step, error.code, error.message) from None
        track.done("structure", detail="Every byte belongs to a known element")
        codecs = ", ".join(info.video_codecs + info.audio_codecs)
        track.done("codecs", detail=f"{codecs} allowed")
        if info.unsupported:
            notices.append(
                f"Some tracks cannot be played and are ignored: {', '.join(info.unsupported)}."
            )
        track.done("polyglot", detail="No data after the end, no references to other files")

        self._check_malware(upload, info, track, notices)

        media.write_clean(upload, clean, info)
        stripped = ", ".join(info.stripped) if info.stripped else "none found"
        track.done("metadata", detail=f"Removed: {stripped}")

        meta = {
            **info.to_json(),
            "bytes": clean.stat().st_size,
            "sha256_original": _sha256(upload),
            "sha256_clean": _sha256(clean),
        }
        return MediaGateResult(clean, meta, track.snapshot(), notices)

    def _check_malware(
        self, upload: Path, info: media.MediaInfo, track: _Tracker, notices: list[str]
    ) -> None:
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
        # Compressed video is random-looking data: short rules would match it by chance. YARA reads
        # the headers, indexes and metadata instead, which is where a hidden script would live.
        hits = self.yara.scan_bytes(media.scan_bytes(upload, info))
        if hits:
            raise track.reject("malware", "suspicious_content", f"{hits[0].description}.")
        engines = (["ClamAV"] if verdict.status == "clean" else []) + (
            [f"{self.yara.rule_count} YARA rules on headers and metadata"]
            if self.yara.available
            else []
        )
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
        track.done("malware", "partial", f"Ran: {', '.join(engines) or 'nothing'}")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(4 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()
