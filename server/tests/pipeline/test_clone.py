"""Clone stamp: shifted copies under a soft brush."""

from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError

from pipeline import clone, render
from pipeline.ops import ClonePaint, EditState


def stripes(w: int = 40, h: int = 20) -> np.ndarray:
    image = np.zeros((h, w, 4), dtype=np.float32)
    image[..., 3] = 1.0
    image[:, :, 0] = (np.arange(w) % 10 < 5).astype(np.float32)  # alternating red bars
    return image


def test_shifted_copies_with_clamped_edges() -> None:
    image = np.arange(5 * 6 * 4, dtype=np.float32).reshape(5, 6, 4)
    out = clone.shifted(image, 2, -1)
    assert np.array_equal(out[2, 1], image[1, 3]) and np.array_equal(out[0, 5], image[0, 5])


def test_full_flow_hard_stroke_copies_the_source() -> None:
    image = stripes()
    stroke = ClonePaint(dx=5, dy=0, r=6, hardness=1.0, flow=1.0, pts=[[10.0, 10.0]])
    out = clone.apply(image, [stroke])
    assert out[10, 10, 0] == image[10, 15, 0] != image[10, 10, 0]
    assert np.array_equal(out[0], image[0]) and np.array_equal(out[10, 30:], image[10, 30:])


def test_strokes_copy_from_the_picture_before_any_clone() -> None:
    image = stripes()
    a = ClonePaint(dx=5, dy=0, r=8, hardness=1.0, flow=1.0, pts=[[12.0, 10.0]])
    b = ClonePaint(dx=5, dy=0, r=8, hardness=1.0, flow=1.0, pts=[[7.0, 10.0]])
    once = clone.apply(image, [a, b])
    assert once[10, 12, 0] == image[10, 17, 0]  # not a copy of a copy


def test_soft_flow_blends() -> None:
    image = stripes()
    stroke = ClonePaint(dx=5, dy=0, r=6, hardness=1.0, flow=0.5, pts=[[10.0, 10.0]])
    out = clone.apply(image, [stroke])
    assert abs(out[10, 10, 0] - (image[10, 10, 0] + image[10, 15, 0]) / 2) < 1e-6


def test_clone_runs_before_adjustments_and_via_render() -> None:
    from pipeline.ops import Adjust

    image = stripes()
    stroke = ClonePaint(dx=5, dy=0, r=6, hardness=1.0, flow=1.0, pts=[[10.0, 10.0]])
    plain = render.render(image, EditState(clone=[stroke]))
    assert np.array_equal(plain, clone.apply(image, [stroke]))
    edited = render.render(image, EditState(clone=[stroke], adjust=Adjust(exposure=1.0)))
    assert edited[10, 10, 0] >= plain[10, 10, 0]


def test_clone_limits() -> None:
    ok = ClonePaint(dx=1, dy=1, r=5, pts=[[0, 0]])
    with pytest.raises(ValidationError):
        EditState(clone=[ok] * 61)
    with pytest.raises(ValidationError):
        ClonePaint(dx=1, dy=1, r=0, pts=[[0, 0]])
    with pytest.raises(ValidationError):
        ClonePaint(dx=1, dy=1, r=5, pts=[])
