"""Pixel art: turn any picture into a true pixel grid with a limited palette.

Steps, in this order:
 1. reduce the picture to a grid of cells (area average, `pixel_size` source pixels per cell);
 2. smooth the grid with a small edge-preserving (bilateral) filter, so noise does not become speckle;
 3. choose a palette: k-means on the cells, or one of the classic fixed palettes, or the user's own;
 4. snap every cell to the palette, with optional dithering (ordered Bayer, Floyd-Steinberg, Atkinson);
 5. optional outline;
 6. enlarge with nearest-neighbour so every art pixel is a crisp square.

Everything works on the small grid, so even a large photo is quick.
"""

from __future__ import annotations

import math
from typing import cast

import numpy as np
from numpy.typing import NDArray

from pipeline.ops import PixelArt

F32 = np.float32
Array = NDArray[np.float32]
MAX_CELLS_ERROR_DIFFUSION = 250_000
KMEANS_SAMPLES = 20_000
KMEANS_ITERATIONS = 14
ALPHA_CUTOFF = 0.5


def _hexes(values: str) -> list[str]:
    return values.split()


PALETTES: dict[str, list[str]] = {
    "gameboy": _hexes("0f380f 306230 8bac0f 9bbc0f"),
    "pico8": _hexes("000000 1D2B53 7E2553 008751 AB5236 5F574F C2C3C7 FFF1E8 FF004D FFA300 FFEC27 00E436 29ADFF 83769C FF77A8 FFCCAA"),
    "cga": _hexes("000000 55FFFF FF55FF FFFFFF"),
    "c64": _hexes("000000 FFFFFF 68372B 70A4B2 6F3D86 588D43 352879 B8C76F 6F4F25 433900 9A6759 444444 6C6C6C 9AD284 6C5EB5 959595"),
    "endesga32": _hexes("be4a2f d77643 ead4aa e4a672 b86f50 733e39 3e2731 a22633 e43b44 f77622 feae34 fee761 63c74d 3e8948 265c42 193c3e 124e89 0099db 2ce8f5 ffffff c0cbdc 8b9bb4 5a6988 3a4466 262b44 181425 ff0044 68386c b55088 f6757a e8b796 c28569"),
    # The common NTSC approximation of the NES palette.
    "nes": _hexes("7C7C7C 0000FC 0000BC 4428BC 940084 A80020 A81000 881400 503000 007800 006800 005800 004058 000000 BCBCBC 0078F8 0058F8 6844FC D800CC E40058 F83800 E45C10 AC7C00 00B800 00A800 00A844 008888 F8F8F8 3CBCFC 6888FC 9878F8 F878F8 F85898 F87858 FCA044 F8B800 B8F818 58D854 58F898 00E8D8 787878 FCFCFC A4E4FC B8B8F8 D8B8F8 F8B8F8 F8A4C0 F0D0B0 FCE0A8 F8D878 D8F878 B8F8B8 B8F8D8 00FCFC F8D8F8"),
}  # fmt: skip


def hex_to_rgb(value: str) -> tuple[float, float, float]:
    v = value.lstrip("#")
    return int(v[0:2], 16) / 255, int(v[2:4], 16) / 255, int(v[4:6], 16) / 255


def palette_array(names: list[str]) -> Array:
    return np.array([hex_to_rgb(h) for h in names], dtype=F32)


def parse_palette_text(text: str, limit: int = 64) -> list[str]:
    """Colours from a .hex file (one RRGGBB per line) or a GIMP .gpl palette. Used by the web app's importer."""
    found: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or (line.startswith(("#", "GIMP", "Name", "Columns")) and not _looks_hex(line)):
            continue
        parts = line.replace(",", " ").split()
        if _looks_hex(parts[0]):
            found.append("#" + parts[0].lstrip("#").lower())
        elif len(parts) >= 3 and all(p.isdigit() and int(p) < 256 for p in parts[:3]):
            r, g, b = (int(p) for p in parts[:3])
            found.append(f"#{r:02x}{g:02x}{b:02x}")
    return found[:limit]


def _looks_hex(token: str) -> bool:
    body = token.lstrip("#")
    return len(body) == 6 and all(c in "0123456789abcdefABCDEF" for c in body)


# --- steps ------------------------------------------------------------------------------------------
def to_cells(image: Array, size: int) -> Array:
    """Area-average the picture into cells of `size` x `size` source pixels (edge pixels repeat)."""
    h, w = image.shape[:2]
    gh, gw = math.ceil(h / size), math.ceil(w / size)
    padded = np.pad(image, ((0, gh * size - h), (0, gw * size - w), (0, 0)), mode="edge")
    premul = padded.copy()
    premul[..., :3] *= padded[..., 3:4]
    cells = premul.reshape(gh, size, gw, size, 4).mean(axis=(1, 3))
    alpha = cells[..., 3:4]
    cells[..., :3] = np.where(alpha > 1e-6, cells[..., :3] / np.maximum(alpha, F32(1e-6)), F32(0.0))
    return cast(Array, cells.astype(F32))


def bilateral(cells: Array, strength: float) -> Array:
    """3x3 bilateral filter on the cell grid: smooths flat areas, keeps edges."""
    if strength <= 0:
        return cells
    sigma = F32(0.04 + strength / 100.0 * 0.25)
    rgb = cells[..., :3]
    padded = np.pad(rgb, ((1, 1), (1, 1), (0, 0)), mode="edge")
    h, w = rgb.shape[:2]
    acc = np.zeros_like(rgb)
    norm = np.zeros((*rgb.shape[:2], 1), dtype=F32)
    for dy in range(3):
        for dx in range(3):
            neighbour = padded[dy : dy + h, dx : dx + w]
            distance = ((neighbour - rgb) ** 2).sum(axis=-1, keepdims=True)
            weight = np.exp(-distance / (2 * sigma * sigma)).astype(F32)
            if (dy, dx) != (1, 1):
                weight = weight * F32(0.7)
            acc += neighbour * weight
            norm += weight
    out = cells.copy()
    out[..., :3] = acc / norm
    return out


def kmeans(points: Array, k: int, seed: int = 7) -> Array:
    """Deterministic k-means (k-means++ start) on RGB points."""
    rng = np.random.default_rng(seed)
    if len(points) > KMEANS_SAMPLES:
        points = points[rng.choice(len(points), KMEANS_SAMPLES, replace=False)]
    unique = np.unique(np.round(points, 3), axis=0)
    if len(unique) <= k:
        return unique.astype(F32)
    centres = [points[rng.integers(len(points))]]
    for _ in range(1, k):
        d2 = np.min(((points[:, None, :] - np.array(centres)[None]) ** 2).sum(-1), axis=1)
        total = float(d2.sum())
        centres.append(
            points[rng.choice(len(points), p=d2 / total)]
            if total > 0
            else points[rng.integers(len(points))]
        )
    c = np.array(centres, dtype=F32)
    for _ in range(KMEANS_ITERATIONS):
        labels = ((points[:, None, :] - c[None]) ** 2).sum(-1).argmin(axis=1)
        for i in range(k):
            members = points[labels == i]
            if len(members):
                c[i] = members.mean(axis=0)
    return np.clip(c, 0.0, 1.0).astype(F32)


def _nearest(colors: Array, palette: Array) -> NDArray[np.int64]:
    flat = colors.reshape(-1, 3)
    out = np.empty(len(flat), dtype=np.int64)
    step = 65_536
    for i in range(0, len(flat), step):
        chunk = flat[i : i + step]
        out[i : i + step] = ((chunk[:, None, :] - palette[None]) ** 2).sum(-1).argmin(axis=1)
    return out.reshape(colors.shape[:-1])


def _bayer(n: int) -> NDArray[np.float32]:
    m = np.array([[0, 2], [3, 1]], dtype=np.float32)
    while m.shape[0] < n:
        m = np.block([[4 * m, 4 * m + 2], [4 * m + 3, 4 * m + 1]])
    return ((m + 0.5) / (n * n)).astype(F32)


def _spread(palette_size: int) -> float:
    return float(1.0 / max(1.5, palette_size ** (1 / 3)))


def quantize(
    rgb: Array, palette: Array, dither: str, strength: float, opaque: NDArray[np.bool_]
) -> NDArray[np.int64]:
    h, w = rgb.shape[:2]
    if dither == "none" or strength <= 0:
        return _nearest(rgb, palette)
    if dither.startswith("bayer"):
        n = int(dither[5:])
        threshold = _bayer(n)
        tiled = np.tile(threshold, (math.ceil(h / n), math.ceil(w / n)))[:h, :w]
        offset = (tiled - F32(0.5))[..., None] * F32(strength * _spread(len(palette)))
        return _nearest(np.clip(rgb + offset, 0.0, 1.0), palette)
    # error diffusion: sequential, so it is limited to a sensible grid size
    if h * w > MAX_CELLS_ERROR_DIFFUSION:
        return quantize(rgb, palette, "bayer4", strength, opaque)
    work = rgb.copy()
    out = np.zeros((h, w), dtype=np.int64)
    atkinson = dither == "atkinson"
    k = F32(strength)
    for y in range(h):
        for x in range(w):
            pixel = work[y, x]
            index = int(((palette - pixel) ** 2).sum(axis=1).argmin())
            out[y, x] = index
            if not opaque[y, x]:
                continue
            error = (pixel - palette[index]) * k
            if atkinson:
                share = error / F32(8.0)
                for dx, dy in ((1, 0), (2, 0), (-1, 1), (0, 1), (1, 1), (0, 2)):
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < w and 0 <= yy < h:
                        work[yy, xx] += share
            else:
                for dx, dy, weight in (
                    (1, 0, 7 / 16),
                    (-1, 1, 3 / 16),
                    (0, 1, 5 / 16),
                    (1, 1, 1 / 16),
                ):
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < w and 0 <= yy < h:
                        work[yy, xx] += error * F32(weight)
    return out


def outline_mask(rgb: Array, opaque: NDArray[np.bool_]) -> NDArray[np.bool_]:
    """Cells that border transparency, or border a clearly lighter cell (the darker side gets the line)."""
    luma = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=F32)
    padded_l = np.pad(luma, 1, mode="edge")
    padded_o = np.pad(opaque, 1, mode="constant", constant_values=False)
    h, w = luma.shape
    edge = np.zeros_like(opaque)
    for dy, dx in ((0, 1), (2, 1), (1, 0), (1, 2)):
        neighbour_l = padded_l[dy : dy + h, dx : dx + w]
        neighbour_o = padded_o[dy : dy + h, dx : dx + w]
        edge |= opaque & ~neighbour_o
        edge |= opaque & neighbour_o & ((neighbour_l - luma) > 0.28)
    return edge


def apply(image: Array, options: PixelArt) -> tuple[Array, dict[str, object]]:
    """Returns the pixel-art RGBA picture and a few facts about it (grid size, palette, notes)."""
    h, w = image.shape[:2]
    cells = bilateral(to_cells(image, options.pixel_size), options.smooth)
    opaque = cells[..., 3] >= ALPHA_CUTOFF
    rgb = cells[..., :3]
    notes: list[str] = []

    if options.palette == "auto":
        points = rgb[opaque] if opaque.any() else rgb.reshape(-1, 3)
        palette = kmeans(points, options.colors)
    elif options.palette == "custom":
        if not options.custom_palette:
            raise ValueError("Choose or import a palette first.")
        palette = palette_array(options.custom_palette)
    else:
        palette = palette_array(PALETTES[options.palette])

    if (
        options.dither in ("floyd", "atkinson")
        and rgb.shape[0] * rgb.shape[1] > MAX_CELLS_ERROR_DIFFUSION
    ):
        notes.append(
            "The grid is too large for error diffusion; ordered dithering (Bayer 4x4) was used instead."
        )
    indices = quantize(rgb, palette, options.dither, options.dither_strength, opaque)
    snapped = palette[indices]
    if options.outline:
        edge = outline_mask(snapped, opaque)
        snapped = np.where(
            edge[..., None], np.array(hex_to_rgb(options.outline_color), dtype=F32), snapped
        )

    out_cells = np.empty((*snapped.shape[:2], 4), dtype=F32)
    out_cells[..., :3] = np.where(opaque[..., None], snapped, F32(0.0))
    out_cells[..., 3] = opaque.astype(F32)

    gw = out_cells.shape[1]
    gh = out_cells.shape[0]
    if options.scale == 0:
        big = np.repeat(
            np.repeat(out_cells, options.pixel_size, axis=0), options.pixel_size, axis=1
        )
        result = np.ascontiguousarray(big[:h, :w])
    else:
        result = np.repeat(np.repeat(out_cells, options.scale, axis=0), options.scale, axis=1)
    info: dict[str, object] = {
        "grid": [gw, gh],
        "colors": len(np.unique(indices[opaque])) if opaque.any() else 0,
        "palette": [
            f"#{round(c[0] * 255):02x}{round(c[1] * 255):02x}{round(c[2] * 255):02x}"
            for c in palette
        ],
        "notes": notes,
    }
    return result, info
