"""Selections: signed-distance masks, feather, invert, and limiting the adjustments."""

from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError

from pipeline import render, selection
from pipeline.ops import Adjust, EditState, Selection


def test_rectangle_mask() -> None:
    m = selection.mask(Selection(kind="rect", x=2, y=2, w=4, h=4), 8, 8)[..., 0]
    assert m[2:6, 2:6].min() == 1.0 and m[0, 0] == 0.0 and m[7, 7] == 0.0
    assert m.sum() == 16.0  # one-pixel edge: pixel centres land exactly on the boundary pixels


def test_feather_makes_a_soft_edge() -> None:
    hard = selection.mask(Selection(kind="rect", x=10, y=10, w=20, h=20), 40, 40)[..., 0]
    soft = selection.mask(Selection(kind="rect", x=10, y=10, w=20, h=20, feather=6), 40, 40)[..., 0]
    assert set(np.unique(hard)) <= {0.0, 1.0}
    row = soft[20, 4:16]
    assert np.all(np.diff(row) >= 0) and 0.0 < soft[20, 9] < 1.0 and soft[20, 20] == 1.0


def test_ellipse_and_invert() -> None:
    e = Selection(kind="ellipse", x=0, y=0, w=20, h=10)
    m = selection.mask(e, 20, 10)[..., 0]
    assert m[5, 10] == 1.0 and m[0, 0] == 0.0
    inv = selection.mask(e.model_copy(update={"invert": True}), 20, 10)[..., 0]
    assert np.allclose(inv, 1 - m)


def test_polygon_even_odd() -> None:
    triangle = Selection(kind="polygon", points=[[0, 0], [10, 0], [0, 10]])
    m = selection.mask(triangle, 10, 10)[..., 0]
    assert m[1, 1] == 1.0 and m[8, 8] == 0.0 and m[2, 2] == 1.0


def test_selection_is_validated() -> None:
    with pytest.raises(ValidationError):
        Selection(kind="polygon", points=[[0, 0], [1, 1]])
    with pytest.raises(ValidationError):
        Selection(kind="rect", w=0)
    with pytest.raises(ValidationError):
        Selection(kind="polygon", points=[[0, 0]] * 200)


def test_adjustments_apply_only_inside_the_selection() -> None:
    source = np.full((10, 10, 4), 0.4, dtype=np.float32)
    source[..., 3] = 1.0
    state = EditState(
        adjust=Adjust(exposure=1.0),
        selection=Selection(kind="rect", x=0, y=0, w=5, h=10),
    )
    out = render.render(source, state)
    assert out[5, 2, 0] > 0.5 and np.allclose(out[5, 8, :3], 0.4, atol=1e-6)


def test_selection_without_adjustments_changes_nothing() -> None:
    source = np.random.default_rng(3).random((6, 6, 4), dtype=np.float32)
    state = EditState(selection=Selection(kind="ellipse", x=1, y=1, w=4, h=4, feather=3))
    assert np.array_equal(render.render(source, state), source)


def _halves() -> np.ndarray:
    """20 x 10: left half red, right half blue, with a red square in the blue half (like lib/fill.test.ts)."""
    px = np.zeros((10, 20, 4), np.float32)
    px[...] = (10 / 255, 10 / 255, 250 / 255, 1.0)
    px[:, :10] = (250 / 255, 10 / 255, 10 / 255, 1.0)
    px[2:5, 14:17] = (250 / 255, 10 / 255, 10 / 255, 1.0)
    return px


def test_wand_matches_the_paint_bucket_counts() -> None:
    img = _halves()
    assert selection.wand_area(img, 2, 2, 10, True).sum() == 100
    assert selection.wand_area(img, 2, 2, 10, False).sum() == 109
    assert selection.wand_area(img, 15, 3, 10, True).sum() == 9
    assert selection.wand_area(img, -1, 3, 10, True).sum() == 0


def test_wand_selection_limits_edits_and_feathers() -> None:
    img = _halves()
    wand = Selection(kind="wand", x=2, y=2, tolerance=10)
    m = selection.mask(wand, 20, 10, img)[..., 0]
    assert m[5, 2] == 1 and m[5, 15] == 0
    soft = selection.mask(wand.model_copy(update={"feather": 4}), 20, 10, img)[..., 0]
    assert 0 < soft[5, 10] < 1
    inv = selection.mask(wand.model_copy(update={"invert": True}), 20, 10, img)[..., 0]
    assert inv[5, 2] == 0 and inv[5, 15] == 1


def test_wand_handles_a_large_snaking_area_quickly() -> None:
    import time

    img = np.zeros((1200, 1200, 4), np.float32)
    img[..., 3] = 1
    img[::4, :] = 1.0  # white walls every 4 rows, open alternately at the left and the right
    img[::8, -2:] = 0
    img[4::8, :2] = 0
    img[..., 3] = 1
    start = time.perf_counter()
    area = selection.wand_area(img, 5, 1, 5, True)
    assert time.perf_counter() - start < 5
    assert area[1197, 600] == 1  # the path snakes all the way down
