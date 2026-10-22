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
