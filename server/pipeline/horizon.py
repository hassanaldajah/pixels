"""Auto horizon detection for the Straighten tool.

Finds the dominant near-horizontal edge direction (weighted by edge strength) and returns the
Straighten angle that levels it. Positive angles are clockwise, as everywhere else.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from PIL import Image

from pipeline.blur import gaussian
from pipeline.color import luma

F32 = np.float32
SEARCH_DEGREES = 25.0
BIN_DEGREES = 0.1
PROBE_EDGE = 512
EDGE_SMOOTHING = 2.5


@dataclass(frozen=True)
class Horizon:
    angle: float  # the Straighten angle to apply (clockwise positive); 0 when nothing reliable was found
    confidence: float  # 0..1: how much of the strong near-horizontal edge energy agrees


def estimate(rgba: NDArray[np.float32]) -> Horizon:
    h, w = rgba.shape[:2]
    scale = min(1.0, PROBE_EDGE / max(h, w))
    if scale < 1.0:
        planes = [
            np.asarray(
                Image.fromarray(np.ascontiguousarray(rgba[..., c]), "F").resize(
                    (max(2, round(w * scale)), max(2, round(h * scale))), Image.Resampling.BOX
                )
            )
            for c in range(4)
        ]
        rgba = np.stack(planes, axis=-1).astype(F32)
    grey = luma(rgba[..., :3] * rgba[..., 3:4] + F32(0.5) * (F32(1.0) - rgba[..., 3:4]))
    grey = gaussian(grey[..., None], EDGE_SMOOTHING)[
        ..., 0
    ]  # smooth stair-steps so diagonal pixels do not bias the angle
    gy, gx = np.gradient(grey)
    magnitude = np.hypot(gx, gy)
    if magnitude.max() < 1e-4:
        return Horizon(0.0, 0.0)
    strong = magnitude > np.percentile(magnitude, 90)
    # Edge direction is perpendicular to the gradient; map it to (-90, 90].
    edge_angle = np.degrees(np.arctan2(gy, gx)) + 90.0
    edge_angle = (edge_angle + 90.0) % 180.0 - 90.0
    near = strong & (np.abs(edge_angle) <= SEARCH_DEGREES)
    if near.sum() < 50:
        return Horizon(0.0, 0.0)
    weights = (magnitude[near] ** 2).astype(np.float64)
    bins = np.arange(-SEARCH_DEGREES, SEARCH_DEGREES + BIN_DEGREES, BIN_DEGREES)
    histogram, _ = np.histogram(edge_angle[near], bins=bins, weights=weights)
    kernel = np.exp(-0.5 * (np.arange(-8, 9) / 4.0) ** 2)  # ~0.4 degree smoothing
    smooth = np.convolve(histogram, kernel / kernel.sum(), mode="same")
    peak = int(smooth.argmax())
    peak_angle = float(bins[peak] + BIN_DEGREES / 2)
    window = np.abs(bins[:-1] + BIN_DEGREES / 2 - peak_angle) <= 1.0
    all_strong_energy = float((magnitude[strong] ** 2).sum())
    confidence = float(histogram[window].sum() / max(all_strong_energy, 1e-9))
    return Horizon(round(-peak_angle, 2), round(min(1.0, confidence * 4.0), 3))
