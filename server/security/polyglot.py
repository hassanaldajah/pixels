"""Polyglot and appended-payload detection.

Two independent checks, both run on the raw bytes before any decoder sees the file:

1. *Trailing data*: find where the image format says it ends (PNG IEND, JPEG EOI, RIFF size, BMP
   size, ISO-BMFF box layout) and flag anything meaningful after that point.
2. *Embedded signatures*: look anywhere in the file for executables and archives (PE, ELF, ZIP,
   RAR, 7-Zip, PDF). Signatures are validated beyond the first few bytes so compressed pixel data
   does not trigger false positives.

TIFF has no end marker; for TIFF only check 2 applies.
"""

from __future__ import annotations

import mmap
import re
import struct
from dataclasses import dataclass
from pathlib import Path

PADDING = frozenset(b"\x00\r\n \t")
_JPEG_MARKER = re.compile(rb"\xff[^\x00\xff\xd0-\xd7]", re.DOTALL)
_ELF = re.compile(rb"\x7fELF[\x01\x02][\x01\x02]\x01")
_ZIP_LOCAL = re.compile(rb"PK\x03\x04", re.DOTALL)
_ZIP_EOCD = re.compile(rb"PK\x05\x06", re.DOTALL)
_ZIP_METHODS = frozenset({0, 1, 6, 8, 9, 12, 14, 93, 95, 98})
_SIMPLE_SIGNATURES = (
    (re.compile(rb"Rar!\x1a\x07[\x00\x01]"), "a RAR archive"),
    (re.compile(rb"7z\xbc\xaf\x27\x1c\x00[\x02-\x05]"), "a 7-Zip archive"),
    (re.compile(rb"%PDF-1\.[0-7]"), "a PDF document"),
)
MAX_SIGNATURE_CANDIDATES = 10_000


@dataclass(frozen=True)
class Finding:
    code: str
    message: str
    offset: int | None = None


def _png_end(mm: mmap.mmap) -> int | None:
    size, pos = len(mm), 8
    while pos + 12 <= size:
        length, chunk = struct.unpack(">I4s", mm[pos : pos + 8])
        nxt = pos + 12 + length
        if nxt > size:
            return None
        if chunk == b"IEND":
            return int(nxt)
        pos = nxt
    return None


def _jpeg_end(mm: mmap.mmap) -> int | None:
    size, pos = len(mm), 2
    while True:
        match = _JPEG_MARKER.search(mm, pos)
        if match is None:
            return None
        start = match.start()
        marker = mm[start + 1]
        if marker == 0xD9:
            return start + 2
        if marker == 0x01 or 0xD0 <= marker <= 0xD8:
            pos = start + 2
            continue
        if start + 4 > size:
            return None
        (length,) = struct.unpack(">H", mm[start + 2 : start + 4])
        pos = start + 2 + max(length, 2)


def _webp_end(mm: mmap.mmap) -> int | None:
    (riff_size,) = struct.unpack("<I", mm[4:8])
    end = 8 + riff_size + (riff_size & 1)
    return end if end <= len(mm) else None


def _bmp_end(mm: mmap.mmap) -> int | None:
    (declared,) = struct.unpack("<I", mm[2:6])
    return declared if 0 < declared <= len(mm) else None


def _bmff_end(mm: mmap.mmap) -> int | None:
    size, pos = len(mm), 0
    while pos < size:
        if pos + 8 > size:
            return None
        (box_size,) = struct.unpack(">I", mm[pos : pos + 4])
        if box_size == 1:
            if pos + 16 > size:
                return None
            (box_size,) = struct.unpack(">Q", mm[pos + 8 : pos + 16])
        elif box_size == 0:
            return size
        if box_size < 8 or pos + box_size > size:
            return None
        pos += box_size
    return pos


_END_FINDERS = {
    "png": _png_end,
    "jpeg": _jpeg_end,
    "webp": _webp_end,
    "bmp": _bmp_end,
    "heif": _bmff_end,
    "avif": _bmff_end,
}


def find_trailing_data(kind: str, mm: mmap.mmap) -> Finding | None:
    finder = _END_FINDERS.get(kind)
    if finder is None:
        return None
    try:
        end = finder(mm)
    except (struct.error, IndexError):
        end = None
    if end is None:
        if kind in ("heif", "avif"):
            return Finding(
                "bad_layout",
                "The file's internal box layout is inconsistent (truncated, or extra data after "
                "the last box).",
            )
        return None  # truncated files are reported by structural validation
    tail = mm[end:]
    if not tail or all(b in PADDING for b in tail):
        return None
    return Finding(
        "trailing_data",
        f"{len(tail):,} bytes of extra data follow the end of the image (at byte {end:,}). "
        "Hidden data appended to an image is a common way to smuggle payloads.",
        end,
    )


def _plausible_zip_header(mm: mmap.mmap, at: int) -> bool:
    header = mm[at : at + 30]
    if len(header) < 30:
        return False
    version, _flags, method = struct.unpack("<HHH", header[4:10])
    (name_len,) = struct.unpack("<H", header[26:28])
    if version > 100 or method not in _ZIP_METHODS or not 1 <= name_len <= 255:
        return False
    name = mm[at + 30 : at + 30 + name_len]
    return len(name) == name_len and all(c >= 0x20 and c != 0x7F for c in name)


def _zip_end_of_directory(mm: mmap.mmap, at: int) -> bool:
    record = mm[at : at + 22]
    if len(record) < 22:
        return False
    _disk, _cd_disk, _entries_here, entries, cd_size, cd_offset, comment_len = struct.unpack(
        "<4xHHHHIIH", record
    )
    return bool(entries >= 1 and at + 22 + comment_len == len(mm) and cd_size + cd_offset <= at)


def find_embedded_payload(mm: mmap.mmap) -> Finding | None:
    marker = mm.find(b"This program cannot be run in DOS mode")
    if marker != -1:
        return Finding(
            "embedded_executable", "A Windows executable is embedded in the file.", marker
        )
    elf = _ELF.search(mm)
    if elf:
        return Finding(
            "embedded_executable", "A Linux executable is embedded in the file.", elf.start()
        )
    for count, hit in enumerate(_ZIP_LOCAL.finditer(mm)):
        if count > MAX_SIGNATURE_CANDIDATES:
            break
        if _plausible_zip_header(mm, hit.start()):
            return Finding(
                "embedded_archive", "A ZIP archive is embedded in the file.", hit.start()
            )
    for hit in _ZIP_EOCD.finditer(mm):
        if _zip_end_of_directory(mm, hit.start()):
            return Finding(
                "embedded_archive", "A ZIP archive is embedded in the file.", hit.start()
            )
    for pattern, what in _SIMPLE_SIGNATURES:
        found = pattern.search(mm)
        if found:
            return Finding(
                "embedded_archive", f"{what.capitalize()} is embedded in the file.", found.start()
            )
    return None


def analyze(path: Path, kind: str, *, reject_trailing: bool = True) -> list[Finding]:
    """All findings for `path`. An empty list means nothing suspicious was found."""
    findings: list[Finding] = []
    with path.open("rb") as handle, mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        if reject_trailing:
            trailing = find_trailing_data(kind, mm)
            if trailing:
                findings.append(trailing)
        embedded = find_embedded_payload(mm)
        if embedded:
            findings.append(embedded)
    return findings
