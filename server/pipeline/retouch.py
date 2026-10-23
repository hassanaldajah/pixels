"""Classical retouching, no AI: cut out a plain background, smooth skin, enlarge with high-quality resampling.

Every function takes and returns an (H, W, 4) float32 RGBA picture with straight (non-premultiplied) alpha,
values 0..1.
"""

from __future__ import annotations

import math
from collections import deque

import numpy as np
from numpy.typing import NDArray

from pipeline.errors import PublicError
from pipeline.inpaint import blur, resize

F32 = np.float32
Array = NDArray[np.float32]
Bool = NDArray[np.bool_]

FLOOD_EDGE = 1024  # the "connected to the border" search runs at this size
SMOOTH_EDGE = 1600  # skin smoothing is computed at this size and applied at full size


# --- background cut-out ------------------------------------------------------------------------------
def background_colour(rgb: Array) -> Array:
    """The colour that most of the picture's border has (the median of a thin frame around it)."""
    h, w = rgb.shape[:2]
    band = max(1, round(min(h, w) * 0.015))
    edge = np.concatenate(
        [
            rgb[:band].reshape(-1, 3),
            rgb[-band:].reshape(-1, 3),
            rgb[:, :band].reshape(-1, 3),
            rgb[:, -band:].reshape(-1, 3),
        ]
    )
    return np.asarray(np.median(edge, axis=0), dtype=F32)


def _connected_to_border(candidate: Bool) -> Bool:
    """Pixels of `candidate` that can be reached from the picture's edge through other candidate pixels."""
    h, w = candidate.shape
    cand = bytearray(candidate.astype(np.uint8).tobytes())
    seen = bytearray(h * w)
    queue: deque[int] = deque()

    def push(i: int) -> None:
        if cand[i] and not seen[i]:
            seen[i] = 1
            queue.append(i)

    for x in range(w):
        push(x)
        push((h - 1) * w + x)
    for y in range(h):
        push(y * w)
        push(y * w + w - 1)
    while queue:
        i = queue.popleft()
        y, x = divmod(i, w)
        if x > 0:
            push(i - 1)
        if x < w - 1:
            push(i + 1)
        if y > 0:
            push(i - w)
        if y < h - 1:
            push(i + w)
    return np.frombuffer(seen, dtype=np.uint8).reshape(h, w).astype(bool)


def cutout(
    image: Array,
    tolerance: float = 30.0,
    feather: float = 1.5,
    contiguous: bool = True,
    colour: tuple[float, float, float] | None = None,
) -> Array:
    """Make a plain background transparent.

    `tolerance` (0-100) is how far a pixel's colour may differ from the background colour. With `contiguous`
    only background that touches the picture's edge goes (a white shirt on a white wall keeps its shirt);
    without it, every pixel of that colour goes. Works best on even backgrounds such as studio shots.
    """
    h, w = image.shape[:2]
    rgb = image[..., :3]
    target = background_colour(rgb) if colour is None else np.asarray(colour, dtype=F32)
    distance = np.sqrt(((rgb - target) ** 2).sum(axis=-1)) / math.sqrt(3.0)
    limit = 0.02 + 0.45 * (tolerance / 100.0)
    near = distance < limit
    if contiguous:
        scale = min(1.0, FLOOD_EDGE / max(h, w))
        if scale < 1.0:
            sw, sh = max(1, round(w * scale)), max(1, round(h * scale))
            small = resize(near.astype(F32)[..., None], sw, sh)[..., 0] > 0.5
            reached = resize(_connected_to_border(small).astype(F32)[..., None], w, h)[..., 0] > 0.5
            background = reached & near
        else:
            background = _connected_to_border(near)
    else:
        background = near
    if not background.any():
        raise PublicError("No background of that colour was found. Try a higher tolerance.")
    keep = 1.0 - blur(background.astype(F32), max(0.0, feather))
    keep = np.where(background & (keep > 0.98), 0.0, keep)  # fully inside the background: gone
    if float(keep.mean()) < 0.001:
        raise PublicError("That would remove the whole picture. Try a lower tolerance.")
    out = image.copy()
    out[..., 3] = image[..., 3] * np.clip(keep, 0.0, 1.0)
    return out


# --- skin smoothing ----------------------------------------------------------------------------------
def skin_mask(rgb: Array) -> Array:
    """A soft 0..1 map of where skin-coloured pixels are (the classic YCbCr range)."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = 0.5 + (-0.168736 * r - 0.331264 * g + 0.5 * b)
    cr = 0.5 + (0.5 * r - 0.418688 * g - 0.081312 * b)
    m = (cb >= 77 / 255) & (cb <= 127 / 255) & (cr >= 133 / 255) & (cr <= 173 / 255) & (y > 0.12)
    return np.asarray(blur(m.astype(F32), 3.0), dtype=F32)


def smooth_skin(
    image: Array, amount: float = 50.0, radius: float = 8.0, protect: float = 50.0
) -> Array:
    """Even out skin while keeping eyes, hair and edges sharp.

    `amount` 0-100 is how much, `radius` (pixels at full size) how coarse the blemishes it evens out are,
    `protect` 0-100 how strongly real edges are kept.
    """
    h, w = image.shape[:2]
    rgb = np.ascontiguousarray(image[..., :3])
    scale = min(1.0, SMOOTH_EDGE / max(h, w))
    sw, sh = max(1, round(w * scale)), max(1, round(h * scale))
    small = resize(rgb, sw, sh) if scale < 1.0 else rgb
    sigma = max(0.5, radius * scale)
    low = np.stack([blur(small[..., c], sigma) for c in range(3)], axis=-1)
    mask = skin_mask(small)
    spread = (
        0.04 + 0.12 * (100.0 - protect) / 100.0
    )  # how different from its blur a pixel may be and still smooth
    diff = np.abs(small - low).max(axis=-1)
    weight = np.exp(-(diff**2) / (2 * spread * spread)) * mask * (amount / 100.0)
    smoothed = small + (low - small) * weight[..., None]
    if scale < 1.0:
        # apply the change (not the blurred picture) at full size so the fine detail stays
        change = resize(smoothed - small, w, h)
        out_rgb = rgb + change
    else:
        out_rgb = smoothed
    out = image.copy()
    out[..., :3] = np.clip(out_rgb, 0.0, 1.0)
    return out


# --- enlarging ---------------------------------------------------------------------------------------
def _local_range(rgb: Array) -> tuple[Array, Array]:
    """Per-pixel minimum and maximum over the 3x3 neighbourhood."""
    h, w = rgb.shape[:2]
    padded = np.pad(rgb, ((1, 1), (1, 1), (0, 0)), mode="edge")
    shifted = [padded[dy : dy + h, dx : dx + w] for dy in range(3) for dx in range(3)]
    return np.min(shifted, axis=0), np.max(shifted, axis=0)


def upscale(image: Array, factor: float = 2.0, sharpen: float = 40.0) -> Array:
    """Enlarge with Lanczos resampling (alpha handled premultiplied) and a halo-limited sharpening pass."""
    h, w = image.shape[:2]
    nw, nh = max(1, round(w * factor)), max(1, round(h * factor))
    alpha = image[..., 3:4]
    premultiplied = np.concatenate([image[..., :3] * alpha, alpha], axis=-1)
    big = np.clip(resize(premultiplied, nw, nh), 0.0, 1.0)
    a = big[..., 3:4]
    rgb = np.where(a > 1e-4, big[..., :3] / np.maximum(a, 1e-4), 0.0).astype(F32)
    # Lanczos rings (a bright/dark rim beside an edge): keep every pixel inside the range of the original's
    # neighbourhood, which removes the rim without softening the edge
    low_src, high_src = _local_range(np.ascontiguousarray(image[..., :3]))
    floor = np.clip(resize(low_src, nw, nh), 0.0, 1.0)
    ceiling = np.clip(resize(high_src, nw, nh), 0.0, 1.0)
    rgb = np.clip(rgb, floor, ceiling)
    amount = sharpen / 100.0
    if amount > 0:
        sigma = 0.55 * max(1.0, factor)
        low = np.stack([blur(rgb[..., c], sigma) for c in range(3)], axis=-1)
        detail = (rgb - low) * (1.2 * amount)
        limit = (
            0.10  # never push a pixel more than this away from where it was: no bright/dark halos
        )
        rgb = np.clip(rgb + np.clip(detail, -limit, limit), floor - 0.04, ceiling + 0.04)
        rgb = np.clip(rgb, 0.0, 1.0)
    return np.concatenate([rgb, a], axis=-1).astype(F32)
