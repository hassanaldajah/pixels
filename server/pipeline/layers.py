"""Layers: pictures placed above the edited image and blended into it (docs/PIPELINE.md, "Layers").

Each layer is moved and scaled onto the canvas with the same premultiplied bilinear sampling the
geometry ops use, then blended with the W3C compositing formulas (source-over with a blend mode).
The GPU preview (engine/shaders.ts, BLEND_FRAG) implements the same maths.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
from numpy.typing import NDArray

from pipeline import geometry
from pipeline.ops import Layer

Array = NDArray[np.float32]
F32 = np.float32
EPS = F32(1e-6)
LayerLoader = Callable[[str], Array]


def placement(layer: Layer) -> NDArray[np.float64]:
    """Forward matrix: layer pixel -> canvas pixel (scale about the layer's top-left, then move)."""
    s = layer.scale
    return np.array([[s, 0.0, layer.x], [0.0, s, layer.y], [0.0, 0.0, 1.0]])


def place(source: Array, layer: Layer, width: int, height: int) -> Array:
    """The layer drawn on a transparent canvas of the given size."""
    h, w = source.shape[:2]
    if layer.scale == 1.0 and float(layer.x).is_integer() and float(layer.y).is_integer():
        out = np.zeros((height, width, 4), dtype=F32)  # whole-pixel move: an exact copy
        x, y = int(layer.x), int(layer.y)
        x0, y0, x1, y1 = max(0, x), max(0, y), min(width, x + w), min(height, y + h)
        if x0 < x1 and y0 < y1:
            out[y0:y1, x0:x1] = source[y0 - y : y1 - y, x0 - x : x1 - x]
        return out
    step = geometry.Step(None, placement(layer), width, height, (0.0, 0.0, 0.0, 0.0))  # type: ignore[arg-type]
    inverse = np.asarray(np.linalg.inv(placement(layer)), dtype=np.float64)
    return geometry._sample(source, inverse, step)


def _soft_light(cb: Array, cs: Array) -> Array:
    d = np.where(cb <= 0.25, ((F32(16) * cb - F32(12)) * cb + F32(4)) * cb, np.sqrt(cb))
    return np.where(
        cs <= 0.5,
        cb - (F32(1) - F32(2) * cs) * cb * (F32(1) - cb),
        cb + (F32(2) * cs - F32(1)) * (d - cb),
    )


def blend_rgb(mode: str, cb: Array, cs: Array) -> Array:
    """B(Cb, Cs) from the W3C Compositing and Blending spec, on straight (non-premultiplied) colour."""
    if mode == "normal":
        return cs
    if mode == "multiply":
        return np.asarray(cb * cs, dtype=F32)
    if mode == "screen":
        return cb + cs - cb * cs
    if mode == "overlay":  # hard light with the layers swapped
        return np.where(
            cb <= 0.5, F32(2) * cb * cs, F32(1) - F32(2) * (F32(1) - cb) * (F32(1) - cs)
        )
    if mode == "darken":
        return np.minimum(cb, cs)
    if mode == "lighten":
        return np.maximum(cb, cs)
    if mode == "difference":
        return np.asarray(np.abs(cb - cs), dtype=F32)
    if mode == "soft-light":
        return _soft_light(cb, cs)
    raise ValueError(f"unknown blend mode {mode!r}")


def blend(base: Array, top: Array, mode: str, opacity: float) -> Array:
    """Source-over compositing of `top` onto `base` with a blend mode. Both are straight RGBA in 0..1."""
    cb, ab = base[..., :3], base[..., 3:4]
    cs, as_ = top[..., :3], top[..., 3:4] * F32(opacity)
    mixed = (F32(1) - ab) * cs + ab * np.clip(blend_rgb(mode, cb, cs), 0.0, 1.0)
    premultiplied = as_ * mixed + (F32(1) - as_) * ab * cb
    alpha = as_ + ab * (F32(1) - as_)
    rgb = np.where(alpha > EPS, premultiplied / np.maximum(alpha, EPS), F32(0))
    return np.concatenate([np.clip(rgb, 0.0, 1.0), alpha], axis=-1).astype(F32)


def composite(base: Array, layers: list[Layer], load: LayerLoader | None) -> Array:
    """Blend every visible layer, bottom to top, onto the edited picture."""
    visible = [layer for layer in layers if layer.visible and layer.opacity > 0]
    if not visible:
        return base
    if load is None:
        raise ValueError("This edit has layers but their pictures are not available.")
    height, width = base.shape[:2]
    out = base
    for layer in visible:
        placed = place(load(layer.image_id), layer, width, height)
        out = blend(out, placed, layer.blend, layer.opacity / 100.0)
    return out
