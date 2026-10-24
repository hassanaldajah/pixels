"""Separable Gaussian blur with clamped edges and an explicit, truncated kernel (3 sigma).

The GPU engine uses the same kernel, so the preview and the export blur identically.
"""

from __future__ import annotations

import math
from typing import cast

import numpy as np
from numpy.typing import NDArray

MAX_RADIUS = 96  # sigma up to 32; the GPU shader uses the same cap


def kernel(sigma: float) -> NDArray[np.float32]:
    radius = min(MAX_RADIUS, max(1, math.ceil(3.0 * sigma)))
    x = np.arange(-radius, radius + 1, dtype=np.float64)
    weights = np.exp(-(x * x) / (2.0 * sigma * sigma))
    return cast(NDArray[np.float32], (weights / weights.sum()).astype(np.float32))


LENS_TAPS = 64  # points on a golden-angle spiral that cover the lens disc evenly
SPIN_TAPS = 32
GOLDEN_ANGLE = 2.39996323


def _round(v: NDArray[np.float64] | float) -> NDArray[np.int64]:
    """floor(v + 0.5): the same rounding as the shader (GLSL round() may go either way at .5)."""
    return np.floor(np.asarray(v, dtype=np.float64) + 0.5).astype(np.int64)


def _shifted(image: NDArray[np.float32], dx: int, dy: int) -> NDArray[np.float32]:
    """The image moved by (dx, dy) with clamped edges: out[y, x] = image[y + dy, x + dx]."""
    h, w = image.shape[:2]
    ys = np.clip(np.arange(h) + dy, 0, h - 1)
    xs = np.clip(np.arange(w) + dx, 0, w - 1)
    return image[ys][:, xs]


def motion_taps(length: float, angle_deg: float) -> list[tuple[int, int]]:
    half = min(MAX_RADIUS, max(1, math.ceil(3.0 * length)))
    a = math.radians(angle_deg)
    return [
        (int(_round(i * math.cos(a))), int(_round(-i * math.sin(a))))
        for i in range(-half, half + 1)
    ]


def lens_taps(radius: float) -> list[tuple[int, int]]:
    r_max = min(float(MAX_RADIUS), max(1.0, radius))
    taps = []
    for k in range(LENS_TAPS):
        r = r_max * math.sqrt((k + 0.5) / LENS_TAPS)
        t = k * GOLDEN_ANGLE
        taps.append((int(_round(r * math.cos(t))), int(_round(r * math.sin(t)))))
    return taps


def motion(image: NDArray[np.float32], length: float, angle_deg: float) -> NDArray[np.float32]:
    """Streaks along a line at `angle_deg` (0 = horizontal, counter-clockwise), like fast movement."""
    if length < 0.05:
        return image
    taps = motion_taps(length, angle_deg)
    out = np.zeros_like(image)
    for dx, dy in taps:
        out += _shifted(image, dx, dy)
    return (out / np.float32(len(taps))).astype(np.float32)


def lens(image: NDArray[np.float32], radius: float) -> NDArray[np.float32]:
    """A disc-shaped blur like an out-of-focus lens; bright points grow into round highlights."""
    if radius < 0.05:
        return image
    acc = np.zeros_like(image)
    total = np.zeros((*image.shape[:2], 1), dtype=np.float32)
    for dx, dy in lens_taps(radius * 1.5):
        sample = _shifted(image, dx, dy)
        lum = (
            np.float32(0.2126) * sample[..., 0:1]
            + np.float32(0.7152) * sample[..., 1:2]
            + np.float32(0.0722) * sample[..., 2:3]
        )
        weight = np.float32(1) + np.float32(8) * np.clip(
            (lum - np.float32(0.8)) / np.float32(0.2), 0, 1
        )
        acc += weight * sample
        total += weight
    return (acc / total).astype(np.float32)


def spin(image: NDArray[np.float32], amount: float) -> NDArray[np.float32]:
    """Rotates around the centre of the picture, like a spinning wheel; `amount` is the blur size."""
    if amount < 0.05:
        return image
    h, w = image.shape[:2]
    span = math.radians(amount * 0.75)  # up to 24 degrees either way
    cx, cy = w / 2.0, h / 2.0
    px = np.arange(w, dtype=np.float64)[None, :] + 0.5 - cx
    py = np.arange(h, dtype=np.float64)[:, None] + 0.5 - cy
    out = np.zeros_like(image)
    for k in range(SPIN_TAPS):
        t = span * (2.0 * k / (SPIN_TAPS - 1) - 1.0)
        c, s = math.cos(t), math.sin(t)
        xs = np.clip(np.floor(cx + c * px - s * py).astype(np.int64), 0, w - 1)
        ys = np.clip(np.floor(cy + s * px + c * py).astype(np.int64), 0, h - 1)
        out += image[ys, xs]
    return (out / np.float32(SPIN_TAPS)).astype(np.float32)


def apply_kind(
    image: NDArray[np.float32], kind: str, size: float, angle: float
) -> NDArray[np.float32]:
    if kind == "motion":
        return motion(image, size, angle)
    if kind == "lens":
        return lens(image, size)
    if kind == "spin":
        return spin(image, size)
    return gaussian(image, size)


def gaussian(image: NDArray[np.float32], sigma: float) -> NDArray[np.float32]:
    """Blur an (H, W, C) float32 image."""
    if sigma < 0.05:
        return image
    k = kernel(sigma)
    radius = (len(k) - 1) // 2
    h, w = image.shape[:2]
    padded = np.pad(image, ((0, 0), (radius, radius), (0, 0)), mode="edge")
    horizontal = np.zeros_like(image)
    for i, weight in enumerate(k):
        horizontal += weight * padded[:, i : i + w]
    padded = np.pad(horizontal, ((radius, radius), (0, 0), (0, 0)), mode="edge")
    out = np.zeros_like(image)
    for i, weight in enumerate(k):
        out += weight * padded[i : i + h]
    return out
