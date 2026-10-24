"""Container checks for video and audio files. Pure Python, no decoder, no third-party code.

The server never decodes video or audio. The browser does that with the platform's own sandboxed,
hardware-accelerated decoders (WebCodecs), which the operating system keeps patched. What the
server does is everything a decoder should not have to trust:

* walk the whole container (MP4/MOV boxes, WebM/Matroska elements, WAV chunks, MP3 frames) and
  require that every byte belongs to a known element and that nothing follows the end;
* check the codecs against an allowlist, and the size and duration against hard limits;
* refuse encrypted tracks and references to outside files;
* blank the metadata in place (GPS position, device names, tags, attachments, padding) without
  moving a single media byte, so no sample offset has to be rewritten.

The file is opened read-only through `mmap`; nothing here executes or interprets file content.
"""

from __future__ import annotations

import mmap
import shutil
import struct
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TypeVar

_T = TypeVar("_T")

HEAD_BYTES = 64
MAX_DEPTH = 12
MAX_ELEMENTS = 2_000_000
MAX_INDEX_BYTES = 256 * 1024 * 1024  # an MP4 'moov' or a WebM 'Tracks' larger than this is refused
MAX_SCAN_BYTES = 64 * 1024 * 1024

KIND_LABELS = {
    "mp4": "MP4 video",
    "mov": "QuickTime video",
    "webm": "WebM video",
    "mkv": "Matroska video",
    "m4a": "MPEG-4 audio",
    "wav": "WAV audio",
    "mp3": "MP3 audio",
}
MIME_TYPES = {
    "mp4": "video/mp4",
    "mov": "video/quicktime",
    "webm": "video/webm",
    "mkv": "video/x-matroska",
    "m4a": "audio/mp4",
    "wav": "audio/wav",
    "mp3": "audio/mpeg",
}
EXTENSIONS = {
    "mp4": {
        ".mp4",
        ".m4v",
        ".3gp",
        ".m4a",
    },  # many tools write audio-only .m4a with an 'isom' brand
    "mov": {".mov", ".qt"},
    "webm": {".webm"},
    "mkv": {".mkv"},
    "m4a": {".m4a", ".mp4"},
    "wav": {".wav", ".wave"},
    "mp3": {".mp3"},
}
ALL_EXTENSIONS = set().union(*EXTENSIONS.values())


class MediaError(Exception):
    """A file that cannot be accepted. `message` is shown to the user as it is."""

    def __init__(self, step: str, code: str, message: str) -> None:
        super().__init__(message)
        self.step, self.code, self.message = step, code, message


@dataclass
class MediaInfo:
    kind: str
    video_codecs: list[str] = field(default_factory=list)
    audio_codecs: list[str] = field(default_factory=list)
    unsupported: list[str] = field(default_factory=list)  # tracks that are kept but cannot be used
    width: int = 0
    height: int = 0
    duration: float = 0.0
    stripped: list[str] = field(default_factory=list)
    scan_ranges: list[tuple[int, int]] = field(default_factory=list)  # no compressed media inside
    blanks: list[tuple[int, bytes, int]] = field(default_factory=list)  # (offset, header, length)
    keep: tuple[int, int] | None = None  # copy only this byte range (MP3: drop the tags)

    def note_stripped(self, what: str) -> None:
        if what not in self.stripped:
            self.stripped.append(what)

    def to_json(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "label": KIND_LABELS[self.kind],
            "mime": MIME_TYPES[self.kind],
            "video_codecs": self.video_codecs,
            "audio_codecs": self.audio_codecs,
            "unsupported_tracks": self.unsupported,
            "width": self.width,
            "height": self.height,
            "duration": round(self.duration, 3),
            "metadata_removed": self.stripped,
        }


@dataclass(frozen=True)
class Limits:
    max_seconds: float
    max_edge: int


# --------------------------------------------------------------------------------------- detection
def detect_kind(head: bytes) -> str | None:
    """The container from its first bytes, or None. The extension decides nothing here."""
    if len(head) >= 12 and head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand == b"qt  ":
            return "mov"
        if brand in (b"M4A ", b"M4B "):
            return "m4a"
        if brand[:3] in (b"hei", b"hev", b"mif", b"msf", b"avi", b"avs"):  # HEIF/AVIF pictures
            return None
        return "mp4"
    if len(head) >= 8 and head[4:8] in (b"moov", b"wide", b"mdat", b"free", b"skip"):
        return "mov"  # old QuickTime files start without 'ftyp'
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "webm" if b"webm" in head[:HEAD_BYTES] else "mkv"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[:3] == b"ID3" or _mp3_header(head, 0) is not None:
        return "mp3"
    return None


def extension_matches(kind: str, filename: str) -> bool:
    suffix = Path(filename).suffix.lower()
    return not suffix or suffix in EXTENSIONS[kind]


def inspect(path: Path, kind: str, limits: Limits) -> MediaInfo:
    """Walk the container of `path`. Raises MediaError; returns what was found and what to blank."""
    with _mapped(path) as data:
        info = MediaInfo(kind)
        if kind in ("mp4", "mov", "m4a"):
            _Iso(data, info).run()
        elif kind in ("webm", "mkv"):
            _Ebml(data, info).run()
        elif kind == "wav":
            _wav(data, info)
        else:
            _mp3(data, info)
    _check_limits(info, limits)
    return info


def write_clean(src: Path, dst: Path, info: MediaInfo) -> None:
    """Copy `src` to `dst` with the metadata blanked. Media bytes are copied unchanged."""
    if info.keep is not None:
        start, end = info.keep
        with src.open("rb") as fin, dst.open("wb") as fout:
            fin.seek(start)
            remaining = end - start
            while remaining > 0:
                chunk = fin.read(min(remaining, 8 * 1024 * 1024))
                if not chunk:
                    break
                fout.write(chunk)
                remaining -= len(chunk)
        return
    shutil.copyfile(src, dst)
    with dst.open("r+b") as out:
        for offset, header, length in info.blanks:
            out.seek(offset)
            out.write(header)
            left = length - len(header)
            while left > 0:
                step = min(left, 1024 * 1024)
                out.write(bytes(step))
                left -= step


def scan_bytes(path: Path, info: MediaInfo) -> bytes:
    """The parts of the file that hold no compressed media: these are worth a content scan."""
    out = bytearray()
    with path.open("rb") as handle:
        for start, end in info.scan_ranges:
            if len(out) >= MAX_SCAN_BYTES:
                break
            handle.seek(start)
            out += handle.read(min(end - start, MAX_SCAN_BYTES - len(out)))
    return bytes(out)


# --------------------------------------------------------------------------------------- helpers
@contextmanager
def _mapped(path: Path) -> Iterator[mmap.mmap]:
    with path.open("rb") as handle, mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as data:
        yield data


def _check_limits(info: MediaInfo, limits: Limits) -> None:
    if not info.video_codecs and not info.audio_codecs:
        raise MediaError("codecs", "no_usable_track", _no_track_message(info))
    if info.duration > limits.max_seconds:
        raise MediaError(
            "structure",
            "too_long",
            f"The file is {info.duration / 60:,.0f} minutes long; the limit is "
            f"{limits.max_seconds / 60:,.0f} minutes.",
        )
    if max(info.width, info.height) > limits.max_edge:
        raise MediaError(
            "structure",
            "too_large_to_decode",
            f"The video is {info.width} x {info.height}; the largest side may be "
            f"{limits.max_edge} pixels.",
        )


def _no_track_message(info: MediaInfo) -> str:
    if info.unsupported:
        return (
            f"The file holds no video or audio Pixels can play ({', '.join(info.unsupported)}). "
            "Export it as H.264, HEVC, VP9 or AV1 video with AAC or Opus sound."
        )
    return "The file holds no video or audio track."


def _trailing_if_broken(read: Callable[[int, int], _T], pos: int, end: int) -> _T:
    """At the top level, bytes that do not form an element after a valid one are appended data."""
    try:
        return read(pos, end)
    except MediaError as error:
        if error.step == "polyglot":
            raise
        raise MediaError(
            "polyglot", "trailing_data", f"Unexplained data follows the media at byte {pos:,}."
        ) from None


def _fourcc(raw: bytes) -> str:
    return raw.decode("latin-1")


def _printable(raw: bytes) -> bool:
    return all(0x20 <= b <= 0x7E or b == 0xA9 for b in raw)  # 0xA9 is the QuickTime '©'


# ------------------------------------------------------------------------------------------- ISO
ISO_TOP = {
    b"ftyp", b"moov", b"mdat", b"free", b"skip", b"wide", b"uuid", b"meta", b"pdin",
    b"moof", b"mfra", b"sidx", b"styp", b"prft", b"emsg", b"ssix",
}  # fmt: skip
ISO_CONTAINERS = {
    b"moov", b"trak", b"mdia", b"minf", b"stbl", b"edts", b"dinf", b"mvex", b"tref",
    b"moof", b"traf", b"mfra",
}  # fmt: skip
ISO_STRIP = {b"udta", b"meta", b"uuid", b"free", b"skip", b"wide"}
ISO_TABLES = {
    b"stts", b"ctts", b"stsc", b"stsz", b"stz2", b"stco", b"co64", b"stss", b"sdtp", b"sgpd",
    b"sbgp", b"subs", b"saiz", b"saio", b"stps", b"cslg", b"padb", b"stdp",
}  # fmt: skip
ISO_VIDEO = {
    b"avc1": "H.264", b"avc3": "H.264", b"hvc1": "HEVC", b"hev1": "HEVC",
    b"av01": "AV1", b"vp09": "VP9", b"vp08": "VP8",
}  # fmt: skip
ISO_AUDIO = {
    b"mp4a": "AAC", b"Opus": "Opus", b"fLaC": "FLAC", b"ipcm": "PCM", b"lpcm": "PCM",
    b"sowt": "PCM", b"twos": "PCM", b"fl32": "PCM", b"fl64": "PCM", b"in24": "PCM",
    b"in32": "PCM", b".mp3": "MP3",
}  # fmt: skip
ISO_ENCRYPTED = {b"encv", b"enca", b"drms", b"drmi"}
ISO_HANDLERS_IGNORED = {b"text", b"sbtl", b"subt", b"tmcd", b"meta", b"hint", b"clcp", b"mdta"}


@dataclass
class _Track:
    handler: bytes = b""
    entry: bytes = b""
    width: int = 0
    height: int = 0


class _Iso:
    def __init__(self, data: mmap.mmap, info: MediaInfo) -> None:
        self.data, self.info, self.count = data, info, 0
        self.duration = 0.0
        self.tracks: list[_Track] = []

    def _box(self, pos: int, end: int) -> tuple[int, bytes, int]:
        """(header length, type, total size) of the box at `pos`; it must fit before `end`."""
        if end - pos < 8:
            raise MediaError(
                "polyglot",
                "trailing_data",
                f"There are {end - pos} unexplained bytes at the end of the file.",
            )
        size, kind = struct.unpack_from(">I4s", self.data, pos)
        header = 8
        if size == 1:
            if end - pos < 16:
                raise MediaError("structure", "corrupt_media", "A box header is cut off.")
            (size,) = struct.unpack_from(">Q", self.data, pos + 8)
            header = 16
        elif size == 0:
            size = end - pos
        if size < header or pos + size > end:
            raise MediaError(
                "structure",
                "corrupt_media",
                f"The '{_fourcc(kind)}' box at byte {pos:,} runs past the end of its container.",
            )
        if not _printable(kind):
            raise MediaError(
                "structure", "corrupt_media", f"Byte {pos:,} does not start a valid box."
            )
        self.count += 1
        if self.count > MAX_ELEMENTS:
            raise MediaError("structure", "corrupt_media", "The file has too many boxes.")
        return header, kind, size

    def run(self) -> None:
        end, pos, first = len(self.data), 0, True
        seen_moov = seen_mdat = False
        while pos < end:
            if first:
                header, kind, size = self._box(pos, end)
            else:
                header, kind, size = _trailing_if_broken(self._box, pos, end)
            if first and kind != b"ftyp" and self.info.kind != "mov":
                raise MediaError(
                    "structure", "corrupt_media", "The file does not start with 'ftyp'."
                )
            first = False
            if kind == b"moov":
                if seen_moov:
                    raise MediaError("structure", "corrupt_media", "The file has two 'moov' boxes.")
                if size > MAX_INDEX_BYTES:
                    raise MediaError("structure", "corrupt_media", "The 'moov' index is too large.")
                seen_moov = True
                self.info.scan_ranges.append((pos, pos + header))
                self._walk(pos + header, pos + size, depth=1, track=None, parent=kind)
            elif kind == b"mdat":
                seen_mdat = True
            elif kind in (b"moof", b"mfra"):
                self._walk(pos + header, pos + size, depth=1, track=None, parent=kind)
            elif kind in ISO_STRIP:
                self.info.scan_ranges.append((pos, pos + size))
                self._blank(pos, size, "metadata" if kind in (b"meta", b"uuid") else "padding")
            elif kind in ISO_TOP:
                self.info.scan_ranges.append((pos, pos + size))
            else:
                self.info.scan_ranges.append((pos, pos + size))
                self._blank(pos, size, "unknown boxes")
            pos += size
        if not seen_moov:
            raise MediaError("structure", "corrupt_media", "The file has no 'moov' index.")
        if not seen_mdat and not any(t.entry for t in self.tracks):
            raise MediaError("structure", "corrupt_media", "The file holds no media data.")
        self._finish()

    def _blank(self, pos: int, size: int, what: str) -> None:
        if size >= 8:
            self.info.blanks.append((pos, struct.pack(">I4s", size, b"free"), size))
            if size > 0xFFFFFFFF:  # a 64-bit box keeps its large-size header
                self.info.blanks[-1] = (pos, struct.pack(">I4sQ", 1, b"free", size), size)
            self.info.note_stripped(what)

    def _walk(self, start: int, end: int, depth: int, track: _Track | None, parent: bytes) -> None:
        if depth > MAX_DEPTH:
            raise MediaError("structure", "corrupt_media", "Boxes are nested too deeply.")
        pos = start
        while pos < end:
            header, kind, size = self._box(pos, end)
            body, stop = pos + header, pos + size
            if kind in ISO_STRIP and parent in (b"moov", b"trak", b"mdia", b"minf"):
                self.info.scan_ranges.append((pos, stop))
                label = "location and device data" if kind in (b"udta", b"meta") else "padding"
                self._blank(pos, size, label)
            elif kind == b"trak":
                self.info.scan_ranges.append((pos, body))
                child = _Track()
                self.tracks.append(child)
                self._walk(body, stop, depth + 1, child, kind)
            elif kind in ISO_CONTAINERS:
                self.info.scan_ranges.append((pos, body))
                self._walk(body, stop, depth + 1, track, kind)
            elif parent in (b"moof", b"traf") or kind in ISO_TABLES:
                pass  # sample tables: numbers only, nothing to scan
            else:
                self.info.scan_ranges.append((pos, stop))
                self._leaf(kind, body, stop, track)
            pos = stop

    def _leaf(self, kind: bytes, body: int, stop: int, track: _Track | None) -> None:
        d = self.data
        if kind == b"mvhd" and stop - body >= 20:
            version = d[body]
            if version == 1 and stop - body >= 32:
                timescale, duration = struct.unpack_from(">IQ", d, body + 20)
            else:
                timescale, duration = struct.unpack_from(">II", d, body + 12)
            if timescale and duration != 0xFFFFFFFF and duration != 0xFFFFFFFFFFFFFFFF:
                self.duration = duration / timescale
        elif kind == b"tkhd" and track is not None and stop - body >= 84:
            w, h = struct.unpack_from(">II", d, stop - 8)
            track.width, track.height = w >> 16, h >> 16
        elif kind == b"hdlr" and track is not None and stop - body >= 12:
            track.handler = bytes(d[body + 8 : body + 12])
        elif kind == b"stsd" and track is not None and stop - body >= 16:
            (count,) = struct.unpack_from(">I", d, body + 4)
            if count < 1 or count > 16:
                raise MediaError("structure", "corrupt_media", "A track has a broken description.")
            _, entry, _ = self._box(body + 8, stop)
            track.entry = entry
        elif kind == b"dref" and stop - body >= 8:
            self._check_dref(body, stop)

    def _check_dref(self, body: int, stop: int) -> None:
        (count,) = struct.unpack_from(">I", self.data, body + 4)
        pos = body + 8
        for _ in range(min(count, 64)):
            if pos >= stop:
                break
            header, _kind, size = self._box(pos, stop)
            flags = int.from_bytes(self.data[pos + header + 1 : pos + header + 4], "big")
            if not flags & 1:
                raise MediaError(
                    "polyglot",
                    "external_reference",
                    "The video points to media in another file or on the internet. "
                    "Export it as one self-contained file.",
                )
            pos += size

    def _finish(self) -> None:
        info = self.info
        for t in self.tracks:
            if t.entry in ISO_ENCRYPTED:
                raise MediaError(
                    "codecs",
                    "encrypted",
                    "The file is copy-protected (encrypted); it cannot be opened.",
                )
            if t.handler == b"vide":
                name = ISO_VIDEO.get(t.entry)
                if name is None:
                    info.unsupported.append(f"video {_fourcc(t.entry).strip() or 'unknown'}")
                    continue
                info.video_codecs.append(name)
                if t.width * t.height > info.width * info.height:
                    info.width, info.height = t.width, t.height
            elif t.handler == b"soun":
                name = ISO_AUDIO.get(t.entry)
                if name is None:
                    info.unsupported.append(f"audio {_fourcc(t.entry).strip() or 'unknown'}")
                    continue
                info.audio_codecs.append(name)
            elif t.handler not in ISO_HANDLERS_IGNORED:
                info.unsupported.append(f"{_fourcc(t.handler).strip() or 'unknown'} track")
        if info.kind == "m4a" and info.video_codecs:
            info.kind = "mp4"
        info.duration = self.duration


# ------------------------------------------------------------------------------------------ EBML
EBML_HEADER = 0x1A45DFA3
DOCTYPE = 0x4282
DOCTYPE_READ_VERSION = 0x4285
SEGMENT = 0x18538067
CLUSTER = 0x1F43B675
SEEKHEAD, INFO, TRACKS, CUES = 0x114D9B74, 0x1549A966, 0x1654AE6B, 0x1C53BB6B
CHAPTERS, TAGS, ATTACHMENTS = 0x1043A770, 0x1254C367, 0x1941A469
VOID, CRC32 = 0xEC, 0xBF
TIMECODE_SCALE, DURATION = 0x2AD7B1, 0x4489
TRACK_ENTRY, TRACK_TYPE, CODEC_ID = 0xAE, 0x83, 0x86
VIDEO, PIXEL_WIDTH, PIXEL_HEIGHT = 0xE0, 0xB0, 0xBA
CONTENT_ENCODINGS, CONTENT_ENCODING, CONTENT_ENCRYPTION = 0x6D80, 0x6240, 0x5035
CLUSTER_CHILDREN = {0xE7, 0xA7, 0xAB, 0xA3, 0xA0, 0x5854, VOID, CRC32}
SEGMENT_CHILDREN = {SEEKHEAD, INFO, TRACKS, CUES, CLUSTER, CHAPTERS, TAGS, ATTACHMENTS, VOID, CRC32}
EBML_VIDEO = {
    "V_VP8": "VP8", "V_VP9": "VP9", "V_AV1": "AV1",
    "V_MPEG4/ISO/AVC": "H.264", "V_MPEGH/ISO/HEVC": "HEVC",
}  # fmt: skip
EBML_AUDIO = {
    "A_OPUS": "Opus", "A_VORBIS": "Vorbis", "A_FLAC": "FLAC", "A_MPEG/L3": "MP3",
    "A_PCM/INT/LIT": "PCM", "A_PCM/FLOAT/IEEE": "PCM",
}  # fmt: skip
UNKNOWN = -1


class _Ebml:
    def __init__(self, data: mmap.mmap, info: MediaInfo) -> None:
        self.data, self.info, self.count = data, info, 0
        self.scale = 1_000_000
        self.raw_duration = 0.0

    def _vint(self, pos: int, end: int, keep_marker: bool) -> tuple[int, int]:
        """(value, length) of the variable-length integer at `pos`; UNKNOWN for an all-ones size."""
        if pos >= end:
            raise MediaError("structure", "corrupt_media", "An element header is cut off.")
        first = self.data[pos]
        length = 1
        while length <= 8 and not first & (0x80 >> (length - 1)):
            length += 1
        if length > 8 or pos + length > end:
            raise MediaError("structure", "corrupt_media", f"Byte {pos:,} is not a valid element.")
        value = first if keep_marker else first & (0xFF >> length)
        for i in range(1, length):
            value = (value << 8) | self.data[pos + i]
        if not keep_marker and value == (1 << (7 * length)) - 1:
            return UNKNOWN, length
        return value, length

    def _element(self, pos: int, end: int) -> tuple[int, int, int]:
        """(id, header length, payload size or UNKNOWN) of the element at `pos`."""
        eid, id_len = self._vint(pos, end, keep_marker=True)
        if id_len > 4:
            raise MediaError("structure", "corrupt_media", f"Byte {pos:,} is not a valid element.")
        size, size_len = self._vint(pos + id_len, end, keep_marker=False)
        header = id_len + size_len
        if size != UNKNOWN and pos + header + size > end:
            raise MediaError(
                "structure",
                "corrupt_media",
                f"The element at byte {pos:,} runs past the end of its container.",
            )
        self.count += 1
        if self.count > MAX_ELEMENTS:
            raise MediaError("structure", "corrupt_media", "The file has too many elements.")
        return eid, header, size

    def run(self) -> None:
        end = len(self.data)
        eid, header, size = self._element(0, end)
        if eid != EBML_HEADER or size == UNKNOWN:
            raise MediaError("structure", "corrupt_media", "The EBML header is missing.")
        self.info.scan_ranges.append((0, header + size))
        self._header(header, header + size)
        pos, segments = header + size, 0
        while pos < end:
            eid, header, size = _trailing_if_broken(self._element, pos, end)
            if eid == VOID and size != UNKNOWN:
                pos += header + size
                continue
            if eid != SEGMENT:
                raise MediaError(
                    "polyglot",
                    "trailing_data",
                    f"Unexplained data follows the video at byte {pos:,}.",
                )
            segments += 1
            if segments > 1:
                raise MediaError(
                    "structure", "corrupt_media", "The file holds more than one segment."
                )
            stop = end if size == UNKNOWN else pos + header + size
            self.info.scan_ranges.append((pos, pos + header))
            self._segment(pos + header, stop)
            pos = stop
        if segments == 0:
            raise MediaError("structure", "corrupt_media", "The file has no segment.")
        self.info.duration = self.raw_duration * self.scale / 1e9

    def _header(self, start: int, end: int) -> None:
        doctype, read_version = "", 1
        for eid, body, size in self._children(start, end):
            if eid == DOCTYPE:
                doctype = (
                    bytes(self.data[body : body + size]).rstrip(b"\0").decode("ascii", "replace")
                )
            elif eid == DOCTYPE_READ_VERSION:
                read_version = self._uint(body, size)
        if doctype not in ("webm", "matroska"):
            raise MediaError(
                "allowlist", "format_not_allowed", f"'{doctype}' files are not accepted."
            )
        if read_version > 4:
            raise MediaError(
                "structure", "corrupt_media", "The file needs a newer Matroska reader."
            )
        self.info.kind = "webm" if doctype == "webm" else "mkv"

    def _children(self, start: int, end: int) -> Iterator[tuple[int, int, int]]:
        pos = start
        while pos < end:
            eid, header, size = self._element(pos, end)
            if size == UNKNOWN:
                raise MediaError("structure", "corrupt_media", "An element has no size.")
            yield eid, pos + header, size
            pos += header + size

    def _uint(self, body: int, size: int) -> int:
        if size > 8:
            raise MediaError("structure", "corrupt_media", "A number field is too long.")
        return int.from_bytes(self.data[body : body + size], "big")

    def _segment(self, start: int, end: int) -> None:
        pos, seen_tracks = start, False
        while pos < end:
            eid, header, size = self._element(pos, end)
            if eid not in SEGMENT_CHILDREN:
                raise MediaError(
                    "structure",
                    "corrupt_media",
                    f"The file holds an unknown element (0x{eid:X}) at byte {pos:,}.",
                )
            if size == UNKNOWN:
                if eid != CLUSTER:
                    raise MediaError("structure", "corrupt_media", "An element has no size.")
                pos = self._open_cluster(pos + header, end)
                continue
            body, stop = pos + header, pos + header + size
            if eid in (CLUSTER, CUES):
                pass  # compressed media and seek tables
            elif eid in (TAGS, ATTACHMENTS):
                self.info.scan_ranges.append((pos, stop))
                self._void(pos, stop, "tags" if eid == TAGS else "attached files")
            else:
                if size > MAX_INDEX_BYTES:
                    raise MediaError("structure", "corrupt_media", "An index element is too large.")
                self.info.scan_ranges.append((pos, stop))
                if eid == INFO:
                    self._info(body, stop)
                elif eid == TRACKS:
                    seen_tracks = True
                    self._tracks(body, stop)
            pos = stop
        if not seen_tracks:
            raise MediaError("structure", "corrupt_media", "The file has no track list.")

    def _open_cluster(self, pos: int, end: int) -> int:
        """A cluster written without a size ends where the next non-cluster element begins."""
        while pos < end:
            eid, header, size = self._element(pos, end)
            if eid not in CLUSTER_CHILDREN:
                return pos
            if size == UNKNOWN:
                raise MediaError("structure", "corrupt_media", "A block has no size.")
            pos += header + size
        return pos

    def _void(self, pos: int, stop: int, what: str) -> None:
        length = stop - pos
        for size_len in range(1, 9):
            payload = length - 1 - size_len
            if 0 <= payload < (1 << (7 * size_len)) - 1:
                marker = 1 << (7 * size_len)
                header = bytes([VOID]) + (marker | payload).to_bytes(size_len, "big")
                self.info.blanks.append((pos, header, length))
                self.info.note_stripped(what)
                return

    def _info(self, start: int, end: int) -> None:
        for eid, body, size in self._children(start, end):
            if eid == TIMECODE_SCALE:
                self.scale = self._uint(body, size) or 1_000_000
            elif eid == DURATION and size in (4, 8):
                fmt = ">f" if size == 4 else ">d"
                (value,) = struct.unpack_from(fmt, self.data, body)
                if value == value and 0 <= value < 1e15:  # not NaN, not absurd
                    self.raw_duration = value

    def _tracks(self, start: int, end: int) -> None:
        info = self.info
        for eid, body, size in self._children(start, end):
            if eid != TRACK_ENTRY:
                continue
            kind, codec, width, height = 0, "", 0, 0
            for cid, cbody, csize in self._children(body, body + size):
                if cid == TRACK_TYPE:
                    kind = self._uint(cbody, csize)
                elif cid == CODEC_ID:
                    codec = (
                        bytes(self.data[cbody : cbody + csize])
                        .rstrip(b"\0")
                        .decode("ascii", "replace")
                    )
                elif cid == VIDEO:
                    for vid, vbody, vsize in self._children(cbody, cbody + csize):
                        if vid == PIXEL_WIDTH:
                            width = self._uint(vbody, vsize)
                        elif vid == PIXEL_HEIGHT:
                            height = self._uint(vbody, vsize)
                elif cid == CONTENT_ENCODINGS and self._encrypted(cbody, cbody + csize):
                    raise MediaError(
                        "codecs",
                        "encrypted",
                        "The file is copy-protected (encrypted); it cannot be opened.",
                    )
            if kind == 1:
                name = EBML_VIDEO.get(codec)
                if name is None:
                    info.unsupported.append(f"video {codec or 'unknown'}")
                    continue
                info.video_codecs.append(name)
                if width * height > info.width * info.height:
                    info.width, info.height = width, height
            elif kind == 2:
                name = EBML_AUDIO.get(codec) or ("AAC" if codec.startswith("A_AAC") else None)
                if name is None:
                    info.unsupported.append(f"audio {codec or 'unknown'}")
                    continue
                info.audio_codecs.append(name)

    def _encrypted(self, start: int, end: int) -> bool:
        return any(
            eid == CONTENT_ENCODING
            and any(cid == CONTENT_ENCRYPTION for cid, _, _ in self._children(body, body + size))
            for eid, body, size in self._children(start, end)
        )


# ------------------------------------------------------------------------------------------- WAV
WAV_KEEP = {b"fmt ", b"data", b"fact", b"cue ", b"smpl", b"inst", b"acid"}
WAV_FORMATS = {1: "PCM", 3: "PCM", 6: "PCM", 7: "PCM"}


def _wav(data: mmap.mmap, info: MediaInfo) -> None:
    end = len(data)
    (riff_size,) = struct.unpack_from("<I", data, 4)
    declared = riff_size + 8
    if declared > end:
        raise MediaError("structure", "corrupt_media", "The WAV file is cut off.")
    if end - declared > 1:  # one pad byte is tolerated
        raise MediaError(
            "polyglot",
            "trailing_data",
            f"There are {end - declared:,} bytes after the end of the audio.",
        )
    info.scan_ranges.append((0, 12))
    pos, fmt, data_bytes, block_rate = 12, None, -1, 0
    while pos < declared:
        if declared - pos < 8:
            raise MediaError("structure", "corrupt_media", "A WAV chunk header is cut off.")
        cid, size = struct.unpack_from("<4sI", data, pos)
        stop = pos + 8 + size + (size & 1)
        if pos + 8 + size > declared:
            raise MediaError(
                "structure", "corrupt_media", "A WAV chunk runs past the end of the file."
            )
        if cid == b"fmt " and size >= 16:
            tag, channels, rate, _byte_rate, align, bits = struct.unpack_from(
                "<HHIIHH", data, pos + 8
            )
            if tag == 0xFFFE and size >= 40:
                (tag,) = struct.unpack_from("<H", data, pos + 8 + 24)
            if tag not in WAV_FORMATS or not 1 <= channels <= 32 or not 8000 <= rate <= 384_000:
                raise MediaError(
                    "codecs",
                    "codec_not_allowed",
                    "The WAV file uses a compression Pixels does not accept.",
                )
            if bits not in (8, 16, 24, 32, 64) or align == 0:
                raise MediaError(
                    "structure", "corrupt_media", "The WAV format description is invalid."
                )
            fmt, block_rate = WAV_FORMATS[tag], align * rate
        elif cid == b"data":
            if fmt is None or data_bytes >= 0:
                raise MediaError(
                    "structure", "corrupt_media", "The WAV file's chunks are out of order."
                )
            data_bytes = size
        if cid in WAV_KEEP:
            if cid != b"data":
                info.scan_ranges.append((pos, stop))
        else:
            info.scan_ranges.append((pos, stop))
            info.blanks.append((pos, struct.pack("<4sI", b"JUNK", size), 8 + size))
            info.note_stripped(
                "tags" if cid in (b"LIST", b"id3 ", b"ID3 ", b"bext", b"iXML") else "unknown chunks"
            )
        pos = stop
    if fmt is None or data_bytes < 0:
        raise MediaError("structure", "corrupt_media", "The WAV file has no audio data.")
    info.audio_codecs.append(fmt)
    info.duration = data_bytes / block_rate if block_rate else 0.0


# ------------------------------------------------------------------------------------------- MP3
MP3_BITRATES = {
    1: (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320),
    2: (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),
}
MP3_RATES = {3: (44100, 48000, 32000), 2: (22050, 24000, 16000), 0: (11025, 12000, 8000)}
MP3_TAIL_SLACK = 4096  # a last frame cut short by the encoder is common; it is dropped


def _mp3_header(data: bytes | mmap.mmap, pos: int) -> tuple[int, int, int] | None:
    """(frame length, sample rate, samples per frame) of an MPEG-1/2/2.5 Layer III frame, or None."""
    if pos + 4 > len(data):
        return None
    b1, b2, b3 = data[pos + 1], data[pos + 2], data[pos + 3]
    if data[pos] != 0xFF or b1 & 0xE0 != 0xE0:
        return None
    version, layer = (b1 >> 3) & 3, (b1 >> 1) & 3
    bitrate_index, rate_index, padding = b2 >> 4, (b2 >> 2) & 3, (b2 >> 1) & 1
    if version == 1 or layer != 1 or bitrate_index in (0, 15) or rate_index == 3 or b3 & 3 == 2:
        return None
    rate = MP3_RATES[version][rate_index]
    bitrate = MP3_BITRATES[1 if version == 3 else 2][bitrate_index] * 1000
    samples = 1152 if version == 3 else 576
    return samples // 8 * bitrate // rate + padding, rate, samples


def _mp3(data: mmap.mmap, info: MediaInfo) -> None:
    start, end = 0, len(data)
    if data[:3] == b"ID3":
        if end < 10:
            raise MediaError("structure", "corrupt_media", "The MP3 tag is cut off.")
        sizes = data[6:10]
        if any(b & 0x80 for b in sizes):
            raise MediaError("structure", "corrupt_media", "The MP3 tag size is invalid.")
        tag = (sizes[0] << 21) | (sizes[1] << 14) | (sizes[2] << 7) | sizes[3]
        start = 10 + tag + (10 if data[5] & 0x10 else 0)
        info.scan_ranges.append((0, min(start, end)))
        info.note_stripped("tags")
    if end - start >= 128 and data[end - 128 : end - 125] == b"TAG":
        info.scan_ranges.append((end - 128, end))
        end -= 128
        info.note_stripped("tags")
    if end - start >= 32 and data[end - 32 : end - 24] == b"APETAGEX":
        size, flags = struct.unpack_from("<II", data, end - 32 + 12)
        tag_start = end - size - (32 if flags & 0x80000000 else 0)
        if tag_start < start:
            raise MediaError("structure", "corrupt_media", "The MP3 tag is invalid.")
        info.scan_ranges.append((tag_start, end))
        end = tag_start
        info.note_stripped("tags")

    pos, frames, seconds, first = start, 0, 0.0, -1
    while pos < end:
        frame = _mp3_header(data, pos)
        if frame is None or pos + frame[0] > end:
            if frames > 0 and end - pos <= MP3_TAIL_SLACK:
                end = pos  # drop the cut-off tail
                break
            if frames == 0 and pos - start < MP3_TAIL_SLACK and data[pos] == 0:
                pos += 1  # zero padding before the first frame
                continue
            where = "starts" if frames == 0 else "breaks"
            raise MediaError(
                "structure",
                "corrupt_media",
                f"The MP3 audio {where} with invalid data at byte {pos:,}.",
            )
        if first < 0:
            first = pos
        length, rate, samples = frame
        frames += 1
        seconds += samples / rate
        if frames > MAX_ELEMENTS:
            raise MediaError("structure", "corrupt_media", "The MP3 file has too many frames.")
        pos += length
    if frames == 0:
        raise MediaError("structure", "corrupt_media", "The file holds no MP3 audio.")
    info.keep = (first, end)
    info.audio_codecs.append("MP3")
    info.duration = seconds
