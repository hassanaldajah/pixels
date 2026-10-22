"""Brush strokes as a mask: where a painted local adjustment (dodge, burn, brighten eyes, whiten teeth...) applies.

A stroke is a list of dabs (points). Each dab adds a soft round stamp to the mask:

    a   = clamp((1 - d) / max(1 - hardness, 0.001), 0, 1)       d = distance / radius
    dab = flow * a * a * (3 - 2a)                               (smoothstep falloff)
    paint:  m = m + (1 - m) * dab        erase:  m = m * (1 - dab)

Dabs are applied in order. The GPU preview rasterises the same strokes at the preview scale (lib/paintMask.ts).
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray

from pipeline.ops import Paint

Array = NDArray[np.float32]
F32 = np.float32


def mask(paint: Paint, width: int, height: int) -> Array:
    """The strokes as an (H, W, 1) array of 0..1, sampled at pixel centres of the full canvas."""
    m = np.zeros((height, width), dtype=F32)
    for stroke in paint.strokes:
        r = stroke.r
        soft = max(1.0 - stroke.hardness, 0.001)
        for x, y in stroke.pts:
            x0, x1 = max(0, math.floor(x - r)), min(width, math.ceil(x + r) + 1)
            y0, y1 = max(0, math.floor(y - r)), min(height, math.ceil(y + r) + 1)
            if x0 >= x1 or y0 >= y1:
                continue
            gx = np.arange(x0, x1, dtype=np.float64) + 0.5
            gy = (np.arange(y0, y1, dtype=np.float64) + 0.5)[:, None]
            d = np.hypot(gx - x, gy - y) / r
            a = np.clip((1.0 - d) / soft, 0.0, 1.0)
            dab = (stroke.flow * a * a * (3.0 - 2.0 * a)).astype(F32)
            region = m[y0:y1, x0:x1]
            if stroke.erase:
                region *= F32(1) - dab
            else:
                region += (F32(1) - region) * dab
    return m[..., None]
