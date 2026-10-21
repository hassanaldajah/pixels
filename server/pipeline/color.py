"""Colour maths shared by every stage. The GLSL in apps/web/src/engine mirrors these formulas."""

from __future__ import annotations

from typing import cast

import numpy as np
from numpy.typing import NDArray

F32 = np.float32
Array = NDArray[np.float32]

LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=F32)


def srgb_to_linear(x: Array) -> Array:
    x = np.maximum(x, F32(0.0))
    return np.where(
        x <= F32(0.04045), x / F32(12.92), ((x + F32(0.055)) / F32(1.055)) ** F32(2.4)
    ).astype(F32)


def linear_to_srgb(x: Array) -> Array:
    x = np.maximum(x, F32(0.0))
    return np.where(
        x <= F32(0.0031308), x * F32(12.92), F32(1.055) * x ** F32(1.0 / 2.4) - F32(0.055)
    ).astype(F32)


def luma(rgb: Array) -> Array:
    return cast(
        Array, (rgb[..., 0] * LUMA[0] + rgb[..., 1] * LUMA[1] + rgb[..., 2] * LUMA[2]).astype(F32)
    )


def smoothstep(edge0: float, edge1: float, x: Array) -> Array:
    t = np.clip((x - F32(edge0)) / F32(edge1 - edge0), 0.0, 1.0).astype(F32)
    return cast(Array, (t * t * (F32(3.0) - F32(2.0) * t)).astype(F32))


def rgb_to_hsl(rgb: Array) -> tuple[Array, Array, Array]:
    """Returns hue in degrees [0, 360), saturation and lightness in [0, 1]."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    d = mx - mn
    lightness = (mx + mn) * F32(0.5)
    safe_d = np.where(d > F32(1e-6), d, F32(1.0))
    denom = np.maximum(F32(1.0) - np.abs(F32(2.0) * lightness - F32(1.0)), F32(1e-6))
    sat = np.where(d > F32(1e-6), d / denom, F32(0.0)).astype(F32)
    h = np.where(
        mx == r,
        np.mod((g - b) / safe_d, F32(6.0)),
        np.where(mx == g, (b - r) / safe_d + F32(2.0), (r - g) / safe_d + F32(4.0)),
    )
    hue = np.where(d > F32(1e-6), h * F32(60.0), F32(0.0)).astype(F32)
    return hue, np.clip(sat, 0.0, 1.0).astype(F32), lightness.astype(F32)


def hsl_to_rgb(hue: Array, sat: Array, lightness: Array) -> Array:
    a = sat * np.minimum(lightness, F32(1.0) - lightness)
    out = np.empty((*hue.shape, 3), dtype=F32)
    for channel, n in enumerate((0.0, 8.0, 4.0)):
        k = np.mod(F32(n) + hue / F32(30.0), F32(12.0))
        t = np.minimum(np.minimum(k - F32(3.0), F32(9.0) - k), F32(1.0))
        out[..., channel] = lightness - a * np.maximum(F32(-1.0), t)
    return out
