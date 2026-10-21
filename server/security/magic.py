"""Magic-byte detection. The real type comes from the file signature, never from the extension."""

from __future__ import annotations

import struct
from pathlib import PurePath

# Formats that may enter Pixels. SVG is deliberately absent: it can carry scripts.
ALLOWED_KINDS = frozenset({"png", "jpeg", "webp", "tiff", "bmp", "heif", "avif"})

KIND_LABELS = {
    "png": "PNG",
    "jpeg": "JPEG",
    "webp": "WebP",
    "tiff": "TIFF",
    "bmp": "BMP",
    "heif": "HEIC/HEIF",
    "avif": "AVIF",
    "gif": "GIF",
    "svg": "SVG/XML",
    "html": "HTML",
    "zip": "ZIP archive",
    "pe": "Windows executable",
    "elf": "Linux executable",
    "macho": "macOS executable",
    "pdf": "PDF",
    "rar": "RAR archive",
    "7z": "7-Zip archive",
    "gzip": "gzip archive",
    "script": "script",
}

EXTENSIONS: dict[str, frozenset[str]] = {
    "png": frozenset({".png"}),
    "jpeg": frozenset({".jpg", ".jpeg", ".jpe", ".jfif"}),
    "webp": frozenset({".webp"}),
    "tiff": frozenset({".tif", ".tiff"}),
    "bmp": frozenset({".bmp", ".dib"}),
    "heif": frozenset({".heic", ".heif", ".hif"}),
    "avif": frozenset({".avif"}),
}

HEIF_BRANDS = {
    b"heic",
    b"heix",
    b"hevc",
    b"hevx",
    b"heim",
    b"heis",
    b"hevm",
    b"hevs",
    b"mif1",
    b"msf1",
}
AVIF_BRANDS = {b"avif", b"avis"}
BMP_DIB_SIZES = {12, 40, 52, 56, 64, 108, 124}

HEAD_BYTES = 4096


def _isobmff_kind(head: bytes) -> str | None:
    if len(head) < 12 or head[4:8] != b"ftyp":
        return None
    (box_size,) = struct.unpack(">I", head[:4])
    end = min(max(box_size, 16), len(head))
    major = head[8:12]
    compatible = {head[i : i + 4] for i in range(16, end - 3, 4)}
    brands = {major} | compatible
    if brands & AVIF_BRANDS:
        return "avif"
    if brands & HEIF_BRANDS:
        return "heif"
    return None


def detect_kind(head: bytes) -> str:
    """Return the detected kind ('png', 'zip', ...) or 'unknown'. Pure function of the first bytes."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if head[:4] in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"):
        return "tiff"
    if head[:2] == b"BM" and len(head) >= 18:
        (dib,) = struct.unpack("<I", head[14:18])
        if dib in BMP_DIB_SIZES:
            return "bmp"
    iso = _isobmff_kind(head)
    if iso:
        return iso
    if head.startswith(b"GIF87a") or head.startswith(b"GIF89a"):
        return "gif"
    if head.startswith(b"PK\x03\x04") or head.startswith(b"PK\x05\x06"):
        return "zip"
    if head.startswith(b"MZ"):
        return "pe"
    if head.startswith(b"\x7fELF"):
        return "elf"
    if head[:4] in (
        b"\xfe\xed\xfa\xce",
        b"\xfe\xed\xfa\xcf",
        b"\xce\xfa\xed\xfe",
        b"\xcf\xfa\xed\xfe",
    ):
        return "macho"
    if head.startswith(b"%PDF-"):
        return "pdf"
    if head.startswith(b"Rar!\x1a\x07"):
        return "rar"
    if head.startswith(b"7z\xbc\xaf\x27\x1c"):
        return "7z"
    if head.startswith(b"\x1f\x8b\x08"):
        return "gzip"
    if head.startswith(b"#!"):
        return "script"
    text = head.lstrip(b"\xef\xbb\xbf \t\r\n")[:64].lower()
    if text.startswith((b"<svg", b"<?xml")):
        return "svg"
    if text.startswith((b"<!doctype html", b"<html", b"<script", b"<head", b"<body")):
        return "html"
    return "unknown"


def label(kind: str) -> str:
    return KIND_LABELS.get(kind, "unrecognised data")


def extension_matches(kind: str, filename: str) -> bool:
    suffix = PurePath(filename).suffix.lower()
    return suffix in EXTENSIONS.get(kind, frozenset())
