"""Encode a rendered image: PNG, JPEG, WebP, AVIF and TIFF, 8 or 16 bit, sRGB or Display P3."""

from __future__ import annotations

import io
import struct
import zlib
from dataclasses import dataclass
from typing import Any, Literal, cast

import numpy as np
import tifffile
from numpy.typing import NDArray
from PIL import Image
from PIL.TiffImagePlugin import IFDRational
from pydantic import BaseModel, ConfigDict, Field

from pipeline import icc

Array = NDArray[np.float32]
Format = Literal["png", "jpeg", "webp", "avif", "tiff"]
MEDIA_TYPES = {
    "png": "image/png",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "avif": "image/avif",
    "tiff": "image/tiff",
}
EXTENSIONS = {"png": "png", "jpeg": "jpg", "webp": "webp", "avif": "avif", "tiff": "tif"}


class ExportOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: Format = "png"
    quality: int = Field(default=90, ge=1, le=100)  # JPEG, WebP, AVIF
    lossless: bool = False  # WebP only
    bit_depth: Literal[8, 16] = 8  # PNG and TIFF only
    profile: Literal["sRGB", "Display P3"] = "sRGB"
    keep_camera_info: bool = False  # re-attach the safe EXIF subset captured at import
    keep_gps: bool = False
    background: str = Field(default="#ffffff", pattern=r"^#[0-9a-fA-F]{6}$")  # JPEG has no alpha
    dpi: int | None = Field(default=None, ge=36, le=2400)  # print resolution tag (PNG, JPEG, TIFF)


@dataclass(frozen=True)
class Encoded:
    data: bytes
    media_type: str
    extension: str


def _flatten(rgb: Array, alpha: Array, background: str) -> Array:
    """Composite onto a solid colour (JPEG has no alpha channel)."""
    bg = np.array([int(background[i : i + 2], 16) / 255 for i in (1, 3, 5)], dtype=np.float32)
    return rgb * alpha + bg * (np.float32(1.0) - alpha)


def _quantize(values: Array, bits: int) -> NDArray[np.uint8] | NDArray[np.uint16]:
    top = float(2**bits - 1)
    scaled = np.round(np.clip(values, 0.0, 1.0) * top)
    return cast(
        "NDArray[np.uint8] | NDArray[np.uint16]",
        scaled.astype(np.uint8 if bits == 8 else np.uint16),
    )


def _png16(array: NDArray[np.uint16], profile: bytes) -> bytes:
    """Minimal 16-bit PNG writer (Pillow cannot write 16-bit RGB)."""
    h, w, channels = array.shape

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload))
        )

    raw = array.astype(">u2").tobytes()
    stride = w * channels * 2
    rows = b"".join(b"\x00" + raw[y * stride : (y + 1) * stride] for y in range(h))
    ihdr = struct.pack(">IIBBBBB", w, h, 16, 6 if channels == 4 else 2, 0, 0, 0)
    iccp = b"ICC\x00\x00" + zlib.compress(profile, 9)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"iCCP", iccp)
        + chunk(b"IDAT", zlib.compress(rows, 6))
        + chunk(b"IEND", b"")
    )


# --- safe EXIF subset ----------------------------------------------------------------------------
EXIF_IFD0 = {
    0x010F: "Make",
    0x0110: "Model",
    0x0132: "DateTime",
    0x013B: "Artist",
    0x8298: "Copyright",
}
EXIF_SUB = {
    0x829A: "ExposureTime", 0x829D: "FNumber", 0x8827: "ISO", 0x9003: "DateTimeOriginal",
    0x920A: "FocalLength", 0xA434: "LensModel",
}  # fmt: skip
GPS_TAGS = (1, 2, 3, 4, 5, 6)  # lat ref, lat, lon ref, lon, alt ref, alt


def _build_exif(safe: dict[str, Any], keep_gps: bool) -> bytes | None:
    """Rebuild an EXIF block from validated primitives only (never from the original bytes)."""
    exif = Image.Exif()
    ifd0 = safe.get("ifd0", {})
    for tag in EXIF_IFD0:
        if tag_value := ifd0.get(str(tag)):
            exif[tag] = tag_value
    sub = {int(k): _decode_value(v) for k, v in safe.get("exif", {}).items() if int(k) in EXIF_SUB}
    if sub:
        exif[0x8769] = sub
    gps = safe.get("gps", {})
    if keep_gps and gps:
        exif[0x8825] = {int(k): _decode_value(v) for k, v in gps.items() if int(k) in GPS_TAGS}
    return exif.tobytes() if len(exif) else None


def _decode_value(value: Any) -> Any:
    """JSON stores rationals as [numerator, denominator] pairs and tuples of them as lists."""
    if isinstance(value, list):
        if len(value) == 2 and all(isinstance(v, int) for v in value):
            return IFDRational(value[0], value[1])
        return tuple(_decode_value(v) for v in value)
    return value


def _dpi(options: ExportOptions) -> dict[str, Any]:
    return {"dpi": (options.dpi, options.dpi)} if options.dpi else {}


def encode(rgba: Array, options: ExportOptions, safe_exif: dict[str, Any] | None = None) -> Encoded:
    rgb = rgba[..., :3]
    if options.profile == "Display P3":
        rgb = icc.to_display_p3(rgb)
    profile = icc.profile_bytes(options.profile)
    has_alpha = bool((rgba[..., 3] < 0.999).any())
    exif = (
        _build_exif(safe_exif, options.keep_gps)
        if (options.keep_camera_info and safe_exif)
        else None
    )
    fmt = options.format
    buffer = io.BytesIO()

    if fmt in ("png", "tiff") and options.bit_depth == 16:
        planes = np.concatenate([rgb, rgba[..., 3:4]], axis=-1) if has_alpha else rgb
        array = _quantize(planes, 16)
        if fmt == "png":
            data = _png16(array, profile)  # type: ignore[arg-type]
        else:
            tifffile.imwrite(
                buffer,
                array,
                photometric="rgb",
                extrasamples=("unassalpha",) if has_alpha else None,
                compression="zlib",
                extratags=[(34675, 7, len(profile), profile, True)],  # ICC profile
            )
            data = buffer.getvalue()
        return Encoded(data, MEDIA_TYPES[fmt], EXTENSIONS[fmt])

    if fmt == "jpeg":
        flat = _flatten(rgb, rgba[..., 3:4], options.background)
        Image.fromarray(_quantize(flat, 8), "RGB").save(
            buffer,
            "JPEG",
            quality=options.quality,
            optimize=True,
            subsampling=0 if options.quality >= 90 else 2,
            icc_profile=profile,
            exif=exif or b"",
            dpi=(options.dpi, options.dpi) if options.dpi else (72, 72),
        )
        return Encoded(buffer.getvalue(), MEDIA_TYPES["jpeg"], EXTENSIONS["jpeg"])

    mode = "RGBA" if has_alpha else "RGB"
    planes = np.concatenate([rgb, rgba[..., 3:4]], axis=-1) if has_alpha else rgb
    image = Image.fromarray(_quantize(planes, 8), mode)
    if fmt == "png":
        image.save(
            buffer, "PNG", icc_profile=profile, exif=exif or b"", compress_level=6, **_dpi(options)
        )
    elif fmt == "webp":
        image.save(
            buffer, "WEBP", quality=options.quality, lossless=options.lossless, icc_profile=profile, exif=exif or b"",
            method=4,
        )  # fmt: skip
    elif fmt == "avif":
        image.save(buffer, "AVIF", quality=options.quality, icc_profile=profile, exif=exif or b"")
    else:  # 8-bit tiff
        image.save(
            buffer, "TIFF", compression="tiff_adobe_deflate", icc_profile=profile, **_dpi(options)
        )
    return Encoded(buffer.getvalue(), MEDIA_TYPES[fmt], EXTENSIONS[fmt])
