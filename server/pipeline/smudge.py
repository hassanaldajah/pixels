"""Smudge: drag colour along a stroke, like a finger through wet paint.

Every dab covers a square window of whole pixels around floor(point). The first dab of a stroke only picks up
the colour under it. Each later dab lays the carried colour down with a soft round falloff (the same dab shape
as pipeline/paint.py, scaled by `strength`), then picks some of the new surface up again:

    surface = surface + (carried - surface) * w          w = strength * smoothstep(a)
    carried = carried + (surface - carried) * (1 - strength)

The carried patch is indexed relative to the dab, so moving the dab drags the colour with it. No resampling
is involved, which is why the GPU preview (lib/smudge.ts) can repeat it exactly. Strokes apply in order.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray

from pipeline.ops import SmudgeStroke

Array = NDArray[np.float32]
F32 = np.float32


def apply(image: Array, strokes: list[SmudgeStroke]) -> Array:
    if not strokes:
        return image
    out = image.copy()
    h, w = out.shape[:2]
    for stroke in strokes:
        reach = math.ceil(stroke.r)
        soft = max(1.0 - stroke.hardness, 0.001)
        offsets = np.arange(-reach, reach + 1)
        carried: Array | None = None
        for px, py in stroke.pts:
            cx, cy = math.floor(px), math.floor(py)
            ys, xs = cy + offsets, cx + offsets
            inside = (ys[:, None] >= 0) & (ys[:, None] < h) & (xs[None, :] >= 0) & (xs[None, :] < w)
            yi, xi = np.clip(ys, 0, h - 1), np.clip(xs, 0, w - 1)
            surface = out[yi][:, xi]
            if carried is None:
                carried = surface.copy()
                continue
            d = np.hypot((xs[None, :] + 0.5) - px, (ys[:, None] + 0.5) - py) / stroke.r
            a = np.clip((1.0 - d) / soft, 0.0, 1.0)
            weight = (stroke.strength * a * a * (3.0 - 2.0 * a) * inside).astype(F32)[..., None]
            surface = surface + (carried - surface) * weight
            carried = carried + (surface - carried) * F32(1.0 - stroke.strength)
            rows, cols = np.nonzero(inside)
            out[yi[rows], xi[cols]] = surface[rows, cols]
    return out
