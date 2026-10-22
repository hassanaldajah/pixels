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
