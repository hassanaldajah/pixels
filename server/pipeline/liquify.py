"""Liquify: push, bloat, pinch and restore pixels with a brush.

The strokes build a displacement field D (two numbers per pixel). The result takes, for every pixel centre p,
the colour of the picture at p - D(p) (bilinear, clamped at the edges), so the picture follows the brush.

Each dab touches a square window of whole pixels around floor(point); its weight is the soft round falloff
used by the other brushes (smoothstep of 1 - distance / r):

    push     D += w * strength * (point - previous point)       drags pixels along the stroke
    bloat    D += w * strength * 0.5 * (p - point)              pixels near the centre grow
    pinch    D -= w * strength * 0.5 * (p - point)              pixels near the centre shrink
    restore  D *= 1 - w * strength                              back toward the original

The GPU preview (lib/liquify.ts) builds the same field with the same steps and samples the same way.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray

from pipeline.ops import LiquifyStroke

Array = NDArray[np.float32]
F32 = np.float32


def field(strokes: list[LiquifyStroke], width: int, height: int) -> Array:
    """The displacement field, (H, W, 2) float32: x then y, in pixels."""
    d = np.zeros((height, width, 2), dtype=F32)
    for stroke in strokes:
        reach = math.ceil(stroke.r)
        offsets = np.arange(-reach, reach + 1)
        previous: list[float] | None = None
        for point in stroke.pts:
            px, py = point
            cx, cy = math.floor(px), math.floor(py)
            ys, xs = cy + offsets, cx + offsets
            ys, xs = ys[(ys >= 0) & (ys < height)], xs[(xs >= 0) & (xs < width)]
            if ys.size and xs.size:
                gx = (xs[None, :] + 0.5) - px
                gy = (ys[:, None] + 0.5) - py
                a = np.clip(1.0 - np.hypot(gx, gy) / stroke.r, 0.0, 1.0)
                w = (stroke.strength * a * a * (3.0 - 2.0 * a)).astype(F32)
                window = d[ys[0] : ys[-1] + 1, xs[0] : xs[-1] + 1]
                if stroke.mode == "push":
                    if previous is not None:
                        window[..., 0] += w * F32(px - previous[0])
                        window[..., 1] += w * F32(py - previous[1])
                elif stroke.mode in ("bloat", "pinch"):
                    sign = F32(0.5 if stroke.mode == "bloat" else -0.5)
                    window[..., 0] += w * sign * gx.astype(F32)
                    window[..., 1] += w * sign * gy.astype(F32)
                else:
                    window *= (F32(1) - w)[..., None]
            previous = point
    return d


def sample(image: Array, d: Array) -> Array:
    """out(p) = image at p - d(p), bilinear between pixel centres, clamped at the edges."""
    h, w = image.shape[:2]
    qx = np.arange(w, dtype=F32)[None, :] - d[..., 0]  # (p + 0.5 - d) - 0.5
    qy = np.arange(h, dtype=F32)[:, None] - d[..., 1]
    x0, y0 = np.floor(qx), np.floor(qy)
    tx, ty = (qx - x0)[..., None], (qy - y0)[..., None]
    x0i, y0i = x0.astype(np.int64), y0.astype(np.int64)

    def at(yy: NDArray[np.int64], xx: NDArray[np.int64]) -> Array:
        return image[np.clip(yy, 0, h - 1), np.clip(xx, 0, w - 1)]

    top = at(y0i, x0i) * (F32(1) - tx) + at(y0i, x0i + 1) * tx
    bottom = at(y0i + 1, x0i) * (F32(1) - tx) + at(y0i + 1, x0i + 1) * tx
    return np.asarray(top * (F32(1) - ty) + bottom * ty, dtype=F32)


def apply(image: Array, strokes: list[LiquifyStroke]) -> Array:
    if not strokes:
        return image
    h, w = image.shape[:2]
    return sample(image, field(strokes, w, h))
