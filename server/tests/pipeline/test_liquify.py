"""Liquify: the displacement field and the resampling (mirrored by lib/liquify.ts)."""

from __future__ import annotations

import numpy as np

from pipeline import liquify
from pipeline.ops import LiquifyStroke


def stripes() -> np.ndarray:
    img = np.zeros((40, 40, 4), np.float32)
    img[..., 3] = 1
    img[:, ::8, 0] = 1.0  # vertical red lines every 8 pixels
    return img


def test_no_strokes_and_zero_field_change_nothing() -> None:
    img = stripes()
    assert liquify.apply(img, []) is img
    assert np.array_equal(liquify.sample(img, np.zeros((40, 40, 2), np.float32)), img)


def test_push_moves_pixels_along_the_stroke() -> None:
    push = LiquifyStroke(mode="push", r=10, strength=1, pts=[[16.5, 20.5], [20.5, 20.5]])
    d = liquify.field([push], 40, 40)
    assert d[20, 18, 0] > 2 and abs(d[20, 18, 1]) < 1e-6  # pushed to the right
    assert np.all(d[0, :, :] == 0)  # far away: still
    out = liquify.apply(stripes(), [push])
    assert not np.array_equal(out[20], stripes()[20]) and np.array_equal(out[0], stripes()[0])


def test_bloat_and_pinch_are_opposite_and_restore_undoes() -> None:
    bloat = LiquifyStroke(mode="bloat", r=12, strength=0.8, pts=[[20.5, 20.5]])
    pinch = bloat.model_copy(update={"mode": "pinch"})
    assert np.allclose(liquify.field([bloat], 40, 40), -liquify.field([pinch], 40, 40))
    restore = LiquifyStroke(mode="restore", r=30, strength=1, pts=[[20.5, 20.5]] * 6)
    left = liquify.field([bloat, restore], 40, 40)
    assert np.abs(left).max() < np.abs(liquify.field([bloat], 40, 40)).max() * 0.05


def test_edges_are_clamped() -> None:
    push = LiquifyStroke(mode="push", r=20, strength=1, pts=[[0, 0], [30, 30], [80, 80]])
    out = liquify.apply(stripes(), [push])
    assert np.isfinite(out).all() and out.shape == (40, 40, 4)
