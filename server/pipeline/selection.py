"""Selections: where the adjustments apply. A selection is a shape on the edited canvas (after geometry) with a
soft edge. The GPU preview (engine/shaders.ts, SELECT_FRAG) uses the same maths.

Signed distance `sd` (pixels, negative inside): rectangle = Chebyshev distance to the box, ellipse = the radius
ratio scaled by the smaller half-axis, polygon = distance to the nearest edge (even-odd inside test).
Coverage = clamp(0.5 - sd / max(feather, 1), 0, 1); `invert` flips it.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from pipeline.blur import gaussian
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


def _row_runs(row: NDArray[np.bool_]) -> tuple[NDArray[np.int64], NDArray[np.int64]]:
    """Starts and (exclusive) ends of the True runs in one row."""
    edges = np.flatnonzero(np.diff(np.concatenate(([False], row, [False])).astype(np.int8)))
    return edges[0::2], edges[1::2]


def wand_area(image: Array, sx: float, sy: float, tolerance: float, contiguous: bool) -> Array:
    """Pixels whose colour is close to the clicked one: 1 inside, 0 outside, (H, W) float32.

    The same test as the paint bucket and the GPU preview (lib/fill.ts floodMask): colours as 8-bit RGBA,
    squared distance at most ((tolerance / 100) * 255)^2 * 4, and 4-connected regions.
    """
    h, w = image.shape[:2]
    x0, y0 = int(np.floor(sx)), int(np.floor(sy))
    if not (0 <= x0 < w and 0 <= y0 < h):
        return np.zeros((h, w), dtype=F32)
    rgba = np.empty((h, w, 4), dtype=np.int32)
    rgba[..., : image.shape[2]] = np.rint(np.clip(image, 0, 1) * 255).astype(np.int32)
    if image.shape[2] == 3:
        rgba[..., 3] = 255
    diff = rgba - rgba[y0, x0]
    distance: NDArray[np.int64] = np.einsum("ijk,ijk->ij", diff, diff)
    close: NDArray[np.bool_] = distance <= ((tolerance / 100.0) * 255.0) ** 2 * 4
    if not contiguous:
        return close.astype(F32)
    filled = np.zeros((h, w), dtype=bool)
    runs: dict[int, tuple[NDArray[np.int64], NDArray[np.int64]]] = {}
    stack = [(y0, x0, x0)]  # a row and the column range a neighbouring run covers
    while stack:
        y, a, b = stack.pop()
        if y not in runs:
            runs[y] = _row_runs(close[y])
        starts, ends = runs[y]
        for s, e in zip(
            starts[(ends > a) & (starts <= b)], ends[(ends > a) & (starts <= b)], strict=True
        ):
            if filled[y, s]:
                continue  # a run is always filled whole, so its first pixel tells
            filled[y, s:e] = True
            if y > 0:
                stack.append((y - 1, int(s), int(e) - 1))
            if y < h - 1:
                stack.append((y + 1, int(s), int(e) - 1))
    return filled.astype(F32)


def mask(selection: Selection, width: int, height: int, image: Array | None = None) -> Array:
    """The selection as an (H, W, 1) array of 0..1, sampled at pixel centres of the full canvas.
    A wand selection needs the picture it was made on (`image`: the canvas before adjustments)."""
    if selection.kind == "wand":
        if image is None:
            raise ValueError("a wand selection needs the picture")
        area = wand_area(image, selection.x, selection.y, selection.tolerance, selection.contiguous)
        if selection.feather > 0:
            area = gaussian(area[..., None], selection.feather / 2.0)[..., 0]
        value = 1.0 - area if selection.invert else area
        return np.asarray(value, dtype=F32)[..., None]
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
    m = mask(selection, before.shape[1], before.shape[0], before)
    return np.asarray(before + (after - before) * m, dtype=F32)
