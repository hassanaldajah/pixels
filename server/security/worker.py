"""Sandboxed decode-and-sanitise worker.

Runs in its own process (see sandbox.py for the resource limits) so that a decoder exploit cannot
touch the main server. It is the only code that ever decodes untrusted bytes.

    python -I worker.py --src IN --dst OUT.png --max-pixels N

Self-contained on purpose: standard library, Pillow, pillow-heif and NumPy only. Exactly one JSON
object is written to stdout.
"""

from __future__ import annotations

import argparse
import io
import json
import socket
import sys
import warnings
from typing import Any

ORIENTATION_OPS = {
    2: "FLIP_LEFT_RIGHT",
    3: "ROTATE_180",
    4: "FLIP_TOP_BOTTOM",
    5: "TRANSPOSE",
    6: "ROTATE_270",
    7: "TRANSVERSE",
    8: "ROTATE_90",
}
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP", "TIFF", "BMP", "HEIF", "AVIF"}
EXIF_GPS_IFD = 0x8825
EXIF_ORIENTATION = 0x0112
HIGH_DEPTH_MODES = {"I;16", "I;16L", "I;16B", "I;16N", "I", "F"}

# The only EXIF values that survive import, kept as validated primitives (never as raw bytes) so
# the user can choose to re-attach them on export. Everything else is dropped.
SAFE_IFD0 = (0x010F, 0x0110, 0x0132, 0x013B, 0x8298)  # Make, Model, DateTime, Artist, Copyright
SAFE_EXIF = (0x829A, 0x829D, 0x8827, 0x9003, 0x920A, 0xA434)  # exposure, f-number, ISO, taken, lens
SAFE_GPS = (1, 2, 3, 4, 5, 6)
EXIF_SUB_IFD = 0x8769
MAX_TEXT = 128


class Reject(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _block_network() -> None:
    """Defence in depth: the worker has no reason to open a socket, so make that fail loudly."""

    def deny(*_args: Any, **_kwargs: Any) -> Any:
        raise OSError("network access is disabled in the Pixels decoder sandbox")

    socket.socket = deny  # type: ignore[assignment,misc]
    socket.create_connection = deny
    socket.getaddrinfo = deny


def _high_depth_to_rgb(image: Any) -> Any:
    """16/32-bit grey and float images become 8-bit RGB (Pillow cannot hold 16-bit RGB)."""
    import numpy as np
    from PIL import Image

    array = np.asarray(image)
    if image.mode == "F":
        array = (array.astype(np.float32).clip(0.0, 1.0) * 255.0).astype(np.uint8)
    elif array.dtype != np.uint8:
        array = (array.astype(np.uint32) >> 8).clip(0, 255).astype(np.uint8)
    return Image.fromarray(array, "L").convert("RGB")


def _to_rgb_or_rgba(image: Any) -> Any:
    """Return an 8-bit RGB or RGBA image. CMYK is left alone so its ICC profile can be applied."""
    mode = image.mode
    if mode in ("RGB", "RGBA", "CMYK"):
        return image
    if mode in HIGH_DEPTH_MODES:
        return _high_depth_to_rgb(image)
    if mode == "P":
        return image.convert("RGBA" if "transparency" in image.info else "RGB")
    if mode in ("LA", "La", "PA", "RGBa"):
        return image.convert("RGBA")
    if mode in ("L", "1") and "transparency" in image.info:
        return image.convert("RGBA")
    return image.convert("RGB")


def _apply_icc(image: Any, icc: bytes | None, notes: list[str]) -> tuple[Any, bool]:
    """Convert to sRGB with the embedded profile. Returns (image, profile_was_applied)."""
    from PIL import ImageCms

    def fallback() -> Any:
        return image.convert("RGB") if image.mode == "CMYK" else image

    if not icc:
        return fallback(), False
    has_alpha = image.mode == "RGBA"
    try:
        source = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        if image.mode == "RGB" and "srgb" in ImageCms.getProfileDescription(source).lower():
            return image, False
        base = image.convert("RGB") if has_alpha else image
        converted = ImageCms.profileToProfile(
            base,
            source,
            ImageCms.createProfile("sRGB"),
            renderingIntent=ImageCms.Intent.PERCEPTUAL,
            outputMode="RGB",
        )
        if converted is None:
            raise ValueError("colour transform returned nothing")
        if has_alpha:
            converted.putalpha(image.getchannel("A"))
        return converted, True
    except Exception as exc:
        notes.append(f"The embedded colour profile could not be applied ({type(exc).__name__}).")
        return fallback(), False


def _safe_value(value: Any, depth: int = 0) -> Any:
    """A JSON-safe copy of an EXIF value, or None if it is not a plain string, number or rational."""
    if isinstance(value, str):
        cleaned = "".join(c for c in value if c.isprintable() and c not in "<>&\"'")[
            :MAX_TEXT
        ].strip()
        return cleaned or None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if -(2**31) <= value < 2**32 else None
    numerator = getattr(value, "numerator", None)
    denominator = getattr(value, "denominator", None)
    if isinstance(numerator, int) and isinstance(denominator, int) and denominator != 0:
        return [numerator, denominator]
    if isinstance(value, tuple) and depth == 0 and len(value) <= 4:
        items = [_safe_value(v, 1) for v in value]
        return items if all(i is not None for i in items) else None
    return None


def _extract_safe_exif(exif: Any) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {"ifd0": {}, "exif": {}, "gps": {}}
    for bucket, source, tags in (
        ("ifd0", exif, SAFE_IFD0),
        ("exif", exif.get_ifd(EXIF_SUB_IFD), SAFE_EXIF),
        ("gps", exif.get_ifd(EXIF_GPS_IFD), SAFE_GPS),
    ):
        for tag in tags:
            cleaned = _safe_value(source.get(tag))
            if cleaned is not None:
                out[bucket][str(tag)] = cleaned
    return out


def _describe_metadata(
    image: Any, source_format: str
) -> tuple[list[str], int, dict[str, dict[str, Any]]]:
    """Names of the metadata blocks the file carried, its EXIF orientation, and the safe subset."""
    removed: list[str] = []
    orientation = 1
    safe: dict[str, dict[str, Any]] = {"ifd0": {}, "exif": {}, "gps": {}}
    try:
        exif = image.getexif()
        safe = _extract_safe_exif(exif)
        if len(exif) or "exif" in image.info:
            removed.append("EXIF")
        if exif.get_ifd(EXIF_GPS_IFD):
            removed.append("GPS location")
        orientation = int(exif.get(EXIF_ORIENTATION, 1) or 1)
    except Exception:
        removed.append("EXIF (unreadable)")
    info = image.info
    if "xmp" in info or "XML:com.adobe.xmp" in info:
        removed.append("XMP")
    if "photoshop" in info:
        removed.append("IPTC/Photoshop")
    if source_format == "PNG" and getattr(image, "text", None):
        removed.append("text chunks")
    if info.get("icc_profile"):
        removed.append("ICC profile (applied, then removed)")
    return removed, orientation, safe


def process(src: str, dst: str, max_pixels: int) -> dict[str, Any]:
    import pillow_heif
    from PIL import Image, ImageFile

    pillow_heif.register_heif_opener()
    Image.MAX_IMAGE_PIXELS = max_pixels
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    warnings.simplefilter("ignore")  # camera EXIF quirks must not reject a good picture
    warnings.simplefilter("error", Image.DecompressionBombWarning)  # but a bomb warning is an error

    notes: list[str] = []
    bomb_errors = (Image.DecompressionBombError, Image.DecompressionBombWarning)

    # Pass 1: header only. Dimensions are checked before a single pixel is decoded.
    try:
        with Image.open(src) as probe:
            source_format = probe.format or "unknown"
            source_mode = probe.mode
            width, height = probe.size
            if source_format not in ALLOWED_FORMATS:
                raise Reject("format_not_allowed", f"{source_format} images are not accepted.")
            if width * height > max_pixels:
                raise Reject(
                    "decompression_bomb",
                    f"The image is {width:,} x {height:,} pixels ({width * height / 1e6:,.0f} MP), "
                    f"above the {max_pixels / 1e6:,.0f} MP limit.",
                )
            probe.verify()
    except bomb_errors as exc:
        raise Reject(
            "decompression_bomb", f"Decompression-bomb protection triggered: {exc}"
        ) from exc
    except Reject:
        raise
    except Exception as exc:
        raise Reject(
            "corrupt_image", f"The image structure is invalid ({type(exc).__name__}: {exc})."
        ) from exc

    # Pass 2: full decode of the first frame.
    try:
        image = Image.open(src)
        frames = int(getattr(image, "n_frames", 1))
        if frames > 1:
            image.seek(0)
            notes.append(f"The file has {frames} frames; only the first one was imported.")
        image.load()
    except bomb_errors as exc:
        raise Reject(
            "decompression_bomb", f"Decompression-bomb protection triggered: {exc}"
        ) from exc
    except MemoryError as exc:
        raise Reject(
            "too_large_to_decode", "Decoding this image needs more memory than the sandbox allows."
        ) from exc
    except Exception as exc:
        raise Reject(
            "corrupt_image", f"The image is truncated or corrupt ({type(exc).__name__}: {exc})."
        ) from exc

    removed, orientation, safe_exif = _describe_metadata(image, source_format)
    icc = image.info.get("icc_profile")

    image = _to_rgb_or_rgba(image)
    image, icc_applied = _apply_icc(image, icc if isinstance(icc, bytes) else None, notes)

    orientation_applied = 1
    if source_format not in ("HEIF", "AVIF") and orientation in ORIENTATION_OPS:
        # libheif already applies HEIF/AVIF rotation; every other format relies on the EXIF tag.
        image = image.transpose(getattr(Image.Transpose, ORIENTATION_OPS[orientation]))
        orientation_applied = orientation

    image.info.clear()  # nothing from the source file reaches the PNG writer
    image.save(dst, format="PNG", compress_level=3)
    return {
        "ok": True,
        "width": image.width,
        "height": image.height,
        "has_alpha": image.mode == "RGBA",
        "source_format": source_format,
        "source_mode": source_mode,
        "frames": frames,
        "metadata_removed": removed,
        "icc_applied": icc_applied,
        "orientation_applied": orientation_applied,
        "safe_exif": safe_exif,
        "notes": notes,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", required=True)
    parser.add_argument("--dst", required=True)
    parser.add_argument("--max-pixels", type=int, required=True)
    args = parser.parse_args(argv)
    _block_network()
    try:
        result: dict[str, Any] = process(args.src, args.dst, args.max_pixels)
    except Reject as rejection:
        result = {"ok": False, "code": rejection.code, "message": rejection.message}
    except MemoryError:
        result = {
            "ok": False,
            "code": "too_large_to_decode",
            "message": "Out of memory while decoding.",
        }
    except Exception as exc:
        result = {"ok": False, "code": "internal_error", "message": f"{type(exc).__name__}: {exc}"}
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()
    return 0 if result.get("ok") else 3


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
