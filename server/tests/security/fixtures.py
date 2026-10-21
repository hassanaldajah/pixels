"""Builds the Security Gate fixtures: one valid image and one file per attack class.

Everything is generated in memory so the repository carries no binary samples. Run this module
(`python -m tests.security.fixtures OUT_DIR`) to write them to disk for manual testing.
"""

from __future__ import annotations

import io
import struct
import sys
import zipfile
import zlib
from pathlib import Path

from PIL import Image

SCRIPT_STRING = "<script>alert(document.cookie)</script>"


def gradient(width: int = 64, height: int = 48, mode: str = "RGB") -> Image.Image:
    image = Image.new(mode, (width, height))
    pixels = image.load()
    assert pixels is not None
    for y in range(height):
        for x in range(width):
            value = (x * 4 % 256, y * 5 % 256, (x + y) * 3 % 256)
            pixels[x, y] = value + ((200,) if mode == "RGBA" else ())
    return image


def encode(image: Image.Image, fmt: str, **options: object) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, **options)
    return buffer.getvalue()


def valid_png() -> bytes:
    return encode(gradient(), "PNG")


def valid_png_rgba() -> bytes:
    return encode(gradient(mode="RGBA"), "PNG")


def valid_jpeg() -> bytes:
    return encode(gradient(), "JPEG", quality=90)


def jpeg_with_gps_and_orientation(orientation: int = 6) -> bytes:
    """A 40x20 JPEG that claims to be rotated and carries a GPS position and a camera make."""
    exif = Image.Exif()
    exif[0x010F] = "FixtureCam"
    exif[0x0112] = orientation
    gps = exif.get_ifd(0x8825)
    gps[1], gps[2], gps[3], gps[4] = "N", (51.0, 30.0, 0.0), "W", (0.0, 7.0, 0.0)
    return encode(gradient(40, 20), "JPEG", exif=exif.tobytes())


def valid_webp() -> bytes:
    return encode(gradient(), "WEBP", lossless=True)


def valid_tiff() -> bytes:
    return encode(gradient(), "TIFF")


def valid_bmp() -> bytes:
    return encode(gradient(), "BMP")


def valid_avif() -> bytes:
    return encode(gradient(), "AVIF", quality=80)


def valid_heic() -> bytes:
    import pillow_heif

    pillow_heif.register_heif_opener()
    return encode(gradient(), "HEIF", quality=80)


def png_with_text_chunk() -> bytes:
    from PIL.PngImagePlugin import PngInfo

    info = PngInfo()
    info.add_text("Comment", "harmless text that must not survive")
    return encode(gradient(), "PNG", pnginfo=info)


# --- malicious fixtures -----------------------------------------------------------------------


def renamed_executable() -> bytes:
    """A Windows PE stub. Upload it as photo.png."""
    dos_header = b"MZ" + b"\x90\x00" * 30 + struct.pack("<I", 0x80)
    stub = b"This program cannot be run in DOS mode.\r\r\n$" + b"\x00" * 64
    return dos_header.ljust(0x80, b"\x00") + b"PE\x00\x00" + stub


def zip_in_png() -> bytes:
    """A completely valid PNG with a ZIP archive appended (a classic polyglot)."""
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("payload/run.bat", "@echo off\r\necho pwned\r\n")
    return valid_png() + archive.getvalue()


def zip_hidden_in_jpeg_comment() -> bytes:
    """A ZIP stored inside a JPEG COM segment, so nothing follows the image end marker."""
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_STORED) as zf:
        zf.writestr("payload/run.bat", "@echo off\r\necho pwned\r\n")
    data = archive.getvalue()
    jpeg = valid_jpeg()
    comment = b"\xff\xfe" + struct.pack(">H", len(data) + 2) + data
    return jpeg[:2] + comment + jpeg[2:]


def truncated_jpeg() -> bytes:
    data = valid_jpeg()
    return data[: len(data) // 2]


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload))
    )


def decompression_bomb(width: int = 30_000, height: int = 30_000) -> bytes:
    """A tiny, header-valid PNG that claims to be 900 megapixels."""
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00" * 64)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", idat)
        + _png_chunk(b"IEND", b"")
    )


def jpeg_with_script_in_exif() -> bytes:
    exif = Image.Exif()
    exif[0x010E] = SCRIPT_STRING  # ImageDescription
    return encode(gradient(), "JPEG", exif=exif.tobytes())


def php_in_png_text_chunk() -> bytes:
    """A valid PNG whose tEXt chunk carries a PHP web shell (the classic upload-bypass trick)."""
    png = valid_png()
    ihdr_end = 8 + 25  # signature + IHDR chunk
    shell = _png_chunk(b"tEXt", b"Comment\x00<?php system($_GET['c']); ?>")
    return png[:ihdr_end] + shell + png[ihdr_end:]


def svg_file() -> bytes:
    return b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def gif_file() -> bytes:
    return encode(gradient(8, 8).convert("P"), "GIF")


def html_file() -> bytes:
    return b"<!DOCTYPE html><html><body><script>alert(1)</script></body></html>"


def write_all(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    files = {
        "valid.png": valid_png(),
        "valid.jpg": valid_jpeg(),
        "renamed_exe.png": renamed_executable(),
        "zip_in_png.png": zip_in_png(),
        "zip_in_jpeg_comment.jpg": zip_hidden_in_jpeg_comment(),
        "truncated.jpg": truncated_jpeg(),
        "bomb.png": decompression_bomb(),
        "exif_script.jpg": jpeg_with_script_in_exif(),
        "vector.svg": svg_file(),
    }
    for name, data in files.items():
        (out_dir / name).write_bytes(data)


if __name__ == "__main__":
    write_all(Path(sys.argv[1] if len(sys.argv) > 1 else "fixtures-out"))
