"""Selections: where the adjustments apply. A selection is a shape on the edited canvas (after geometry) with a
soft edge. The GPU preview (engine/shaders.ts, SELECT_FRAG) uses the same maths.

Signed distance `sd` (pixels, negative inside): rectangle = Chebyshev distance to the box, ellipse = the radius
ratio scaled by the smaller half-axis, polygon = distance to the nearest edge (even-odd inside test).
Coverage = clamp(0.5 - sd / max(feather, 1), 0, 1); `invert` flips it.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from pipeline.ops import Selection

Array = NDArray[np.float32]
F32 = np.float32


def _polygon_sd(
    px: NDArray[np.float64], py: NDArray[np.float64], pts: list[list[float]]
) -> NDArray[np.float64]:
    inside = np.zeros(px.shape, dtype=bool)
    dist = np.full(px.shape, np.inf)
    n = len(pts)
    for i in range(n):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % n]
        crosses = (ay > py) != (by > py)
        with np.errstate(divide="ignore", invalid="ignore"):
            x_at = (bx - ax) * (py - ay) / (by - ay) + ax
        inside ^= crosses & (px < x_at)
        ex, ey = bx - ax, by - ay
        length2 = ex * ex + ey * ey
        t = np.clip(((px - ax) * ex + (py - ay) * ey) / length2, 0.0, 1.0) if length2 > 0 else 0.0
        dist = np.minimum(dist, np.hypot(px - (ax + t * ex), py - (ay + t * ey)))
    return np.where(inside, -dist, dist)


def mask(selection: Selection, width: int, height: int) -> Array:
    """The selection as an (H, W, 1) array of 0..1, sampled at pixel centres of the full canvas."""
    px, py = np.meshgrid(
        np.arange(width, dtype=np.float64) + 0.5, np.arange(height, dtype=np.float64) + 0.5
    )
    if selection.kind == "polygon":
        sd = _polygon_sd(px, py, selection.points)
    else:
        cx, cy = selection.x + selection.w / 2, selection.y + selection.h / 2
        hx, hy = selection.w / 2, selection.h / 2
        if selection.kind == "rect":
            sd = np.maximum(np.abs(px - cx) - hx, np.abs(py - cy) - hy)
        else:
            sd = (np.hypot((px - cx) / hx, (py - cy) / hy) - 1.0) * min(hx, hy)
    value = np.clip(0.5 - sd / max(selection.feather, 1.0), 0.0, 1.0)
    if selection.invert:
        value = 1.0 - value
    return value.astype(F32)[..., None]


def apply_inside(before: Array, after: Array, selection: Selection | None) -> Array:
    """Keep `after` inside the selection and `before` outside it."""
    if selection is None:
        return after
    m = mask(selection, before.shape[1], before.shape[0])
    return np.asarray(before + (after - before) * m, dtype=F32)
