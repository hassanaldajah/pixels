"""Adjustments, in the order documented in docs/PIPELINE.md.

Pixels arrive as float32 RGBA, straight alpha, sRGB-encoded, 0..1. Alpha is never changed.
`scale` is render pixels per source pixel (1.0 for the final render); radii given in source
pixels are multiplied by it so a downscaled preview blurs proportionally.
"""

from __future__ import annotations

import math
from typing import cast

import numpy as np
from numpy.typing import NDArray

from pipeline import curves
from pipeline.blur import gaussian
from pipeline.color import (
    F32,
    hsl_to_rgb,
    linear_to_srgb,
    luma,
    rgb_to_hsl,
    smoothstep,
    srgb_to_linear,
)
from pipeline.ops import HSL_CENTERS, Adjust

Array = NDArray[np.float32]
HSL_HALF_WIDTH = 60.0
NR_SIGMA = 1.5  # source pixels
SQRT2 = 1.4142135


def has_point_adjustments(a: Adjust) -> bool:
    base = Adjust()
    return (
        a.model_copy(
            update={
                "noise_reduction": 0.0,
                "blur": 0.0,
                "sharpen": base.sharpen,
                "vignette": base.vignette,
                "grain": base.grain,
            }
        )
        != base
    )


def _clamp(rgb: Array) -> Array:
    return np.clip(rgb, 0.0, 1.0).astype(F32)


def point_stage(rgb: Array, a: Adjust) -> Array:
    """Stages 1-9: everything that only needs the pixel itself."""
    # 1. white balance and exposure, in linear light
    lin = srgb_to_linear(rgb)
    gains = np.array(
        [
            1.0 + 0.25 * a.temperature / 100.0,
            1.0 - 0.2 * a.tint / 100.0,
            1.0 - 0.25 * a.temperature / 100.0,
        ],
        dtype=F32,
    )
    lin = lin * gains * F32(2.0**a.exposure)
    rgb = linear_to_srgb(lin)

    # 2. whites / blacks move the end points
    if a.whites or a.blacks:
        wp = F32(1.0 - 0.25 * a.whites / 100.0)
        bp = F32(-0.25 * a.blacks / 100.0)
        rgb = (rgb - bp) / (wp - bp)

    # 3. shadows / highlights, masked by luminance
    if a.shadows or a.highlights:
        y = luma(np.clip(rgb, 0.0, 1.0))
        shadow_mask = F32(1.0) - smoothstep(0.0, 0.6, y)
        highlight_mask = smoothstep(0.4, 1.0, y)
        stops = (
            F32(1.5 * a.shadows / 100.0) * shadow_mask
            + F32(1.5 * a.highlights / 100.0) * highlight_mask
        )
        rgb = rgb * (F32(2.0) ** stops)[..., None]

    # 4. contrast around mid grey
    if a.contrast:
        rgb = (rgb - F32(0.5)) * F32(1.0 + a.contrast / 100.0) + F32(0.5)

    rgb = _clamp(rgb)

    # 5. saturation and vibrance
    if a.saturation or a.vibrance:
        grey = luma(rgb)[..., None]
        chroma = (rgb.max(axis=-1) - rgb.min(axis=-1))[..., None]
        boost = F32(1.0 + a.saturation / 100.0) + F32(a.vibrance / 100.0) * (F32(1.0) - chroma)
        rgb = _clamp(grey + (rgb - grey) * boost)

    # 6. HSL per colour band
    if any(a.hsl.hue) or any(a.hsl.sat) or any(a.hsl.lum):
        hue, sat, light = rgb_to_hsl(rgb)
        d_hue = np.zeros_like(hue)
        d_sat = np.zeros_like(hue)
        d_lum = np.zeros_like(hue)
        for i, center in enumerate(HSL_CENTERS):
            dist = np.abs(np.mod(hue - F32(center) + F32(180.0), F32(360.0)) - F32(180.0))
            w = np.maximum(F32(0.0), F32(1.0) - dist / F32(HSL_HALF_WIDTH))
            d_hue += w * F32(a.hsl.hue[i] * 0.3)
            d_sat += w * F32(a.hsl.sat[i] / 100.0)
            d_lum += w * F32(a.hsl.lum[i] / 100.0 * 0.3)
        hue = np.mod(hue + d_hue, F32(360.0)).astype(F32)
        sat = np.clip(sat * (F32(1.0) + d_sat), 0.0, 1.0).astype(F32)
        light = np.clip(light + d_lum * sat, 0.0, 1.0).astype(F32)
        rgb = _clamp(hsl_to_rgb(hue, sat, light))

    # 7. levels
    lv = a.levels
    if lv.black != 0.0 or lv.white != 1.0 or lv.gamma != 1.0:
        rgb = np.clip((rgb - F32(lv.black)) / F32(lv.white - lv.black), 0.0, 1.0)
        rgb = (rgb ** F32(1.0 / lv.gamma)).astype(F32)

    # 8-9. curves: master, then per channel
    c = a.curves
    if not curves.is_identity(c.master):
        rgb = curves.apply_lut(rgb, curves.curve_lut(c.master))
    for channel, points in enumerate((c.r, c.g, c.b)):
        if not curves.is_identity(points):
            rgb[..., channel] = curves.apply_lut(rgb[..., channel], curves.curve_lut(points))
    return _clamp(rgb)


def noise_reduction(rgb: Array, amount: float, scale: float) -> Array:
    """Stage 10: blend toward a blur, but not across edges."""
    if amount <= 0:
        return rgb
    blurred = gaussian(rgb, NR_SIGMA * scale)
    diff = np.abs(rgb - blurred).max(axis=-1)
    weight = F32(amount / 100.0) * (F32(1.0) - smoothstep(0.02, 0.12, diff))
    return (rgb + (blurred - rgb) * weight[..., None]).astype(F32)


def sharpen(rgb: Array, amount: float, radius: float, threshold: float, scale: float) -> Array:
    """Stage 11: unsharp mask."""
    if amount <= 0:
        return rgb
    blurred = gaussian(rgb, radius * scale)
    detail = rgb - blurred
    if threshold > 0:
        t = threshold / 255.0
        gate = smoothstep(t, t + 0.02, np.abs(luma(detail)))
        detail = detail * gate[..., None]
    return (rgb + detail * F32(amount / 100.0)).astype(F32)


def vignette(rgb: Array, amount: float, midpoint: float, feather: float) -> Array:
    """Stage 12."""
    if amount == 0:
        return rgb
    h, w = rgb.shape[:2]
    u = ((np.arange(w, dtype=F32) + F32(0.5)) / F32(w) - F32(0.5)) * F32(2.0)
    v = ((np.arange(h, dtype=F32) + F32(0.5)) / F32(h) - F32(0.5)) * F32(2.0)
    dist = np.sqrt(u[None, :] ** 2 + v[:, None] ** 2).astype(F32)
    edge0 = midpoint / 100.0 * SQRT2
    falloff = smoothstep(edge0, edge0 + feather / 100.0 * SQRT2, dist)[..., None]
    k = F32(amount / 100.0)
    if amount < 0:
        return (rgb * (F32(1.0) + k * falloff)).astype(F32)
    return (rgb + (F32(1.0) - rgb) * k * falloff).astype(F32)


def pcg_hash(x: NDArray[np.uint32], y: NDArray[np.uint32], seed: int) -> NDArray[np.uint32]:
    """Integer hash with the same result in NumPy and GLSL."""
    with np.errstate(over="ignore"):
        v = (
            x * np.uint32(747796405)
            + y * np.uint32(2891336453)
            + np.uint32(seed) * np.uint32(277803737)
        )
        state = v * np.uint32(747796405) + np.uint32(2891336453)
        word = ((state >> ((state >> np.uint32(28)) + np.uint32(4))) ^ state) * np.uint32(277803737)
        return cast(NDArray[np.uint32], ((word >> np.uint32(22)) ^ word).astype(np.uint32))


def grain(rgb: Array, amount: float, size: float, seed: int, scale: float) -> Array:
    """Stage 13: zero-mean monochrome grain, strongest in the mid-tones."""
    if amount <= 0:
        return rgb
    h, w = rgb.shape[:2]
    cell = max(1, math.floor(size * scale + 0.5))
    cx = (np.arange(w, dtype=np.uint32) // np.uint32(cell))[None, :]
    cy = (np.arange(h, dtype=np.uint32) // np.uint32(cell))[:, None]
    bits = pcg_hash(np.broadcast_to(cx, (h, w)), np.broadcast_to(cy, (h, w)), seed)
    noise = (bits >> np.uint32(8)).astype(F32) / F32(8388608.0) - F32(1.0)
    mask = F32(1.0) - F32(0.5) * np.abs(F32(2.0) * luma(rgb) - F32(1.0))
    return cast(Array, (rgb + (noise * mask * F32(amount / 100.0 * 0.15))[..., None]).astype(F32))


def apply(rgba: Array, a: Adjust, scale: float = 1.0) -> Array:
    """Run every adjustment on an (H, W, 4) float32 image and return a new one."""
    if a.is_identity():
        return rgba
    rgb = rgba[..., :3]
    if has_point_adjustments(a):
        rgb = point_stage(rgb, a)
    rgb = noise_reduction(rgb, a.noise_reduction, scale)
    if a.blur > 0:  # stage 10b: plain Gaussian blur (soften, background blur)
        rgb = gaussian(rgb, a.blur * scale)
    rgb = sharpen(rgb, a.sharpen.amount, a.sharpen.radius, a.sharpen.threshold, scale)
    rgb = vignette(rgb, a.vignette.amount, a.vignette.midpoint, a.vignette.feather)
    rgb = grain(rgb, a.grain.amount, a.grain.size, a.grain.seed, scale)
    out = np.empty_like(rgba)
    out[..., :3] = _clamp(rgb)
    out[..., 3] = rgba[..., 3]
    return out
