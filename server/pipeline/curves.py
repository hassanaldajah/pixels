"""Tone curves: monotone cubic (Fritsch-Carlson / PCHIP) through the control points, as a 256-entry LUT.

apps/web/src/engine/curves.ts implements the same algorithm; both are checked against the golden
values in tests so the preview and the export agree.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

LUT_SIZE = 256


def _sign(v: float) -> int:
    return (v > 0) - (v < 0)


def _derivatives(xs: list[float], ys: list[float]) -> list[float]:
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    delta = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    if n == 2:
        return [delta[0], delta[0]]
    d = [0.0] * n
    for k in range(1, n - 1):
        if delta[k - 1] * delta[k] <= 0:
            d[k] = 0.0
        else:
            w1 = 2 * h[k] + h[k - 1]
            w2 = h[k] + 2 * h[k - 1]
            d[k] = (w1 + w2) / (w1 / delta[k - 1] + w2 / delta[k])

    def edge(h0: float, h1: float, d0: float, d1: float) -> float:
        value = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1)
        if _sign(value) != _sign(d0):
            return 0.0
        if _sign(d0) != _sign(d1) and abs(value) > 3 * abs(d0):
            return 3 * d0
        return value

    d[0] = edge(h[0], h[1], delta[0], delta[1])
    d[-1] = edge(h[-1], h[-2], delta[-1], delta[-2])
    return d


def curve_lut(points: list[list[float]]) -> NDArray[np.float32]:
    pts = sorted(points)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    d = _derivatives(xs, ys)
    lut = np.empty(LUT_SIZE, dtype=np.float32)
    for i in range(LUT_SIZE):
        x = i / (LUT_SIZE - 1)
        if x <= xs[0]:
            y = ys[0]
        elif x >= xs[-1]:
            y = ys[-1]
        else:
            k = 0
            while x > xs[k + 1]:
                k += 1
            h = xs[k + 1] - xs[k]
            t = (x - xs[k]) / h
            t2, t3 = t * t, t * t * t
            y = (
                (2 * t3 - 3 * t2 + 1) * ys[k]
                + (t3 - 2 * t2 + t) * h * d[k]
                + (-2 * t3 + 3 * t2) * ys[k + 1]
                + (t3 - t2) * h * d[k + 1]
            )
        lut[i] = min(1.0, max(0.0, y))
    return lut


def is_identity(points: list[list[float]]) -> bool:
    return sorted(points) == [[0.0, 0.0], [1.0, 1.0]]


def apply_lut(values: NDArray[np.float32], lut: NDArray[np.float32]) -> NDArray[np.float32]:
    """Linear interpolation between LUT entries, like a GPU texture lookup."""
    return np.interp(np.clip(values, 0.0, 1.0), np.arange(LUT_SIZE) / (LUT_SIZE - 1), lut).astype(
        np.float32
    )
