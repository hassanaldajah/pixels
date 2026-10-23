"""Presets: app-icon sets and store/social image sizes, delivered as in-memory ZIP files."""

from __future__ import annotations

import io
import json
import zipfile
from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageDraw

from pipeline.errors import PublicError
from pipeline.export import Encoded, ExportOptions, encode
from pipeline.geometry import _resize

Array = NDArray[np.float32]
Fit = Literal["cover", "contain"]
PLATFORMS = ("ios", "android", "macos", "windows", "web", "pwa")


@dataclass(frozen=True)
class SizePreset:
    id: str
    label: str
    group: str
    w: int
    h: int


SIZE_PRESETS: tuple[SizePreset, ...] = (
    SizePreset("appstore-iphone-69", 'App Store iPhone 6.9"', "App Store", 1320, 2868),
    SizePreset("appstore-iphone-67", 'App Store iPhone 6.7"', "App Store", 1290, 2796),
    SizePreset("appstore-iphone-65", 'App Store iPhone 6.5"', "App Store", 1284, 2778),
    SizePreset("appstore-iphone-55", 'App Store iPhone 5.5"', "App Store", 1242, 2208),
    SizePreset("appstore-ipad-13", 'App Store iPad 13"', "App Store", 2064, 2752),
    SizePreset("appstore-ipad-129", 'App Store iPad 12.9"', "App Store", 2048, 2732),
    SizePreset("appstore-mac", "App Store Mac", "App Store", 2880, 1800),
    SizePreset("play-phone", "Google Play phone screenshot", "Google Play", 1080, 1920),
    SizePreset("play-feature", "Google Play feature graphic", "Google Play", 1024, 500),
    SizePreset("github-social", "GitHub social preview", "Web", 1280, 640),
    SizePreset("open-graph", "Open Graph / link preview", "Web", 1200, 630),
    SizePreset("readme-banner", "README banner", "Web", 1280, 320),
    SizePreset("x-header", "X header", "Social", 1500, 500),
    SizePreset("x-post", "X post", "Social", 1600, 900),
    SizePreset("linkedin-banner", "LinkedIn banner", "Social", 1584, 396),
    SizePreset("linkedin-post", "LinkedIn post", "Social", 1200, 627),
    SizePreset("instagram-square", "Instagram square", "Social", 1080, 1080),
    SizePreset("instagram-portrait", "Instagram portrait", "Social", 1080, 1350),
    SizePreset("instagram-story", "Instagram story", "Social", 1080, 1920),
    SizePreset("youtube-thumbnail", "YouTube thumbnail", "Social", 1280, 720),
    SizePreset("facebook-cover", "Facebook cover", "Social", 820, 312),
)
SIZE_BY_ID = {p.id: p for p in SIZE_PRESETS}


def _hex(color: str) -> tuple[float, float, float]:
    return int(color[1:3], 16) / 255, int(color[3:5], 16) / 255, int(color[5:7], 16) / 255


def fit_to(
    image: Array, w: int, h: int, mode: Fit, focus: tuple[float, float], background: str | None
) -> Array:
    """Place `image` in a w x h frame: 'cover' crops to fill around `focus`, 'contain' letterboxes."""
    ih, iw = image.shape[:2]
    if mode == "cover":
        scale = max(w / iw, h / ih)
        sw, sh = max(w, round(iw * scale)), max(h, round(ih * scale))
        scaled = _resize(image, sw, sh)
        x0 = round(min(max(focus[0] * sw - w / 2, 0), sw - w))
        y0 = round(min(max(focus[1] * sh - h / 2, 0), sh - h))
        return np.ascontiguousarray(scaled[y0 : y0 + h, x0 : x0 + w])
    scale = min(w / iw, h / ih)
    sw, sh = max(1, round(iw * scale)), max(1, round(ih * scale))
    scaled = _resize(image, sw, sh)
    canvas = np.zeros((h, w, 4), dtype=np.float32)
    if background:
        canvas[..., :3] = _hex(background)
        canvas[..., 3] = 1.0
    x0, y0 = (w - sw) // 2, (h - sh) // 2
    canvas[y0 : y0 + sh, x0 : x0 + sw] = scaled
    if background:  # composite so semi-transparent edges blend with the background
        alpha = scaled[..., 3:4]
        canvas[y0 : y0 + sh, x0 : x0 + sw, :3] = scaled[..., :3] * alpha + np.array(
            _hex(background), dtype=np.float32
        ) * (1 - alpha)
        canvas[y0 : y0 + sh, x0 : x0 + sw, 3] = 1.0
    return canvas


def _flatten(image: Array, background: str) -> Array:
    out = image.copy()
    alpha = image[..., 3:4]
    out[..., :3] = image[..., :3] * alpha + np.array(_hex(background), dtype=np.float32) * (
        1 - alpha
    )
    out[..., 3] = 1.0
    return out


def _png(image: Array, size: int, flatten: str | None = None) -> bytes:
    resized = _resize(image, size, size)
    if flatten:
        resized = _flatten(resized, flatten)
    return encode(resized, ExportOptions(format="png")).data


def _pil(image: Array, size: int) -> Image.Image:
    resized = _resize(image, size, size)
    rgba = np.round(np.clip(resized, 0, 1) * 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def _safe_zone(
    image: Array, content: float, background: tuple[float, float, float, float] | None
) -> Array:
    """The artwork scaled to `content` (0..1) of a square frame, centred."""
    size = image.shape[0]
    inner = max(1, round(size * content))
    art = _resize(image, inner, inner)
    frame = np.zeros((size, size, 4), dtype=np.float32)
    if background:
        frame[:] = np.array(background, dtype=np.float32)
    off = (size - inner) // 2
    frame[off : off + inner, off : off + inner] = art
    if background:
        alpha = art[..., 3:4]
        frame[off : off + inner, off : off + inner, :3] = art[..., :3] * alpha + np.array(
            background[:3], dtype=np.float32
        ) * (1 - alpha)
        frame[off : off + inner, off : off + inner, 3] = 1.0
    return frame


def _round(png_bytes: bytes) -> bytes:
    with Image.open(io.BytesIO(png_bytes)) as image:
        rgba = image.convert("RGBA")
    mask = Image.new("L", rgba.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, rgba.width - 1, rgba.height - 1), fill=255)
    rgba.putalpha(Image.fromarray(np.minimum(np.asarray(rgba.getchannel("A")), np.asarray(mask))))
    out = io.BytesIO()
    rgba.save(out, "PNG")
    return out.getvalue()


IOS_ICONS = (
    # (idiom, point size, scale)
    ("iphone", 20, 2), ("iphone", 20, 3), ("iphone", 29, 2), ("iphone", 29, 3),
    ("iphone", 40, 2), ("iphone", 40, 3), ("iphone", 60, 2), ("iphone", 60, 3),
    ("ipad", 20, 1), ("ipad", 20, 2), ("ipad", 29, 1), ("ipad", 29, 2),
    ("ipad", 40, 1), ("ipad", 40, 2), ("ipad", 76, 1), ("ipad", 76, 2), ("ipad", 83.5, 2),
    ("ios-marketing", 1024, 1),
)  # fmt: skip
ANDROID_DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ADAPTIVE_FOREGROUND = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
ICNS_SIZES = (16, 32, 64, 128, 256, 512, 1024)
PWA_SIZES = (72, 96, 128, 144, 152, 192, 384, 512)


def app_icons(
    square: Array, platforms: list[str], background: str = "#000000"
) -> tuple[bytes, list[str]]:
    """Build the icon set from a square RGBA image (ideally 1024 px or more). Returns (zip, file list)."""
    unknown = set(platforms) - set(PLATFORMS)
    if unknown:
        raise PublicError(f"Unknown platforms: {', '.join(sorted(unknown))}")
    files: dict[str, bytes] = {}
    bg = (*_hex(background), 1.0)

    if "ios" in platforms:
        entries = []
        for idiom, points, scale in IOS_ICONS:
            px = round(points * scale)
            name = f"Icon-{px}.png" if idiom != "ios-marketing" else "Icon-1024-marketing.png"
            files[f"ios/AppIcon.appiconset/{name}"] = _png(
                square, px, flatten=background
            )  # iOS forbids alpha
            entries.append(
                {
                    "size": f"{points:g}x{points:g}",
                    "idiom": idiom,
                    "filename": name,
                    "scale": f"{scale}x",
                }
            )
        files["ios/AppIcon.appiconset/Contents.json"] = json.dumps(
            {"images": entries, "info": {"version": 1, "author": "pixels"}}, indent=2
        ).encode()

    if "android" in platforms:
        for density, px in ANDROID_DENSITIES.items():
            files[f"android/res/mipmap-{density}/ic_launcher.png"] = _png(square, px)
            files[f"android/res/mipmap-{density}/ic_launcher_round.png"] = _round(_png(square, px))
        for density, px in ADAPTIVE_FOREGROUND.items():
            frame = _safe_zone(
                _resize(square, px, px), 66 / 108, None
            )  # keep art inside the 66dp safe zone
            files[f"android/res/mipmap-{density}/ic_launcher_foreground.png"] = encode(
                frame, ExportOptions(format="png")
            ).data
        files["android/res/values/ic_launcher_background.xml"] = (
            f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{background}</color>\n</resources>\n'
        ).encode()
        files["android/res/mipmap-anydpi-v26/ic_launcher.xml"] = (
            b'<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            b'    <background android:drawable="@color/ic_launcher_background"/>\n'
            b'    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n'
        )
        files["android/play-store-512.png"] = _png(square, 512)

    if "macos" in platforms:
        buffer = io.BytesIO()
        _pil(square, 1024).save(buffer, "ICNS", sizes=[(s, s) for s in ICNS_SIZES])
        files["macos/AppIcon.icns"] = buffer.getvalue()

    if "windows" in platforms:
        buffer = io.BytesIO()
        _pil(square, 256).save(buffer, "ICO", sizes=[(s, s) for s in ICO_SIZES])
        files["windows/app.ico"] = buffer.getvalue()

    if "web" in platforms:
        for px in (16, 32, 48):
            files[f"web/favicon-{px}x{px}.png"] = _png(square, px)
        buffer = io.BytesIO()
        _pil(square, 48).save(buffer, "ICO", sizes=[(16, 16), (32, 32), (48, 48)])
        files["web/favicon.ico"] = buffer.getvalue()
        files["web/apple-touch-icon.png"] = _png(square, 180, flatten=background)
        files["web/android-chrome-192x192.png"] = _png(square, 192)
        files["web/android-chrome-512x512.png"] = _png(square, 512)
        files["web/site.webmanifest"] = json.dumps(
            {"name": "", "short_name": "", "icons": [
                {"src": "android-chrome-192x192.png", "sizes": "192x192", "type": "image/png"},
                {"src": "android-chrome-512x512.png", "sizes": "512x512", "type": "image/png"}],
             "theme_color": background, "background_color": background, "display": "standalone"}, indent=2,
        ).encode()  # fmt: skip

    if "pwa" in platforms:
        icons = []
        for px in PWA_SIZES:
            files[f"pwa/icons/icon-{px}x{px}.png"] = _png(square, px)
            icons.append(
                {
                    "src": f"icons/icon-{px}x{px}.png",
                    "sizes": f"{px}x{px}",
                    "type": "image/png",
                    "purpose": "any",
                }
            )
        maskable = _safe_zone(
            _resize(square, 512, 512), 0.8, bg
        )  # maskable icons keep a 10% margin
        files["pwa/icons/maskable-512x512.png"] = encode(maskable, ExportOptions(format="png")).data
        icons.append(
            {
                "src": "icons/maskable-512x512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "maskable",
            }
        )
        files["pwa/manifest-icons.json"] = json.dumps({"icons": icons}, indent=2).encode()

    return _zip(files), sorted(files)


def _zip(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(
                zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0)), data, zipfile.ZIP_DEFLATED
            )
    return buffer.getvalue()


def sized_images(
    image: Array,
    ids: list[str],
    *,
    mode: Fit,
    focus: tuple[float, float],
    background: str | None,
    export: ExportOptions,
) -> tuple[bytes, list[str]]:
    files: dict[str, bytes] = {}
    for preset_id in ids:
        preset = SIZE_BY_ID.get(preset_id)
        if preset is None:
            raise PublicError(f"Unknown size preset: {preset_id}")
        framed = fit_to(image, preset.w, preset.h, mode, focus, background)
        encoded: Encoded = encode(framed, export)
        files[f"{preset.id}-{preset.w}x{preset.h}.{encoded.extension}"] = encoded.data
    return _zip(files), sorted(files)
