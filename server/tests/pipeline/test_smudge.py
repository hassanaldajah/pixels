"""Smudge: colour is dragged along the stroke, and nothing outside the dabs changes."""

from __future__ import annotations

import numpy as np

from pipeline import smudge
from pipeline.ops import SmudgeStroke


def halves() -> np.ndarray:
    img = np.zeros((20, 40, 4), np.float32)
    img[..., 3] = 1
    img[:, :20, 0] = 1.0  # left half red, right half black
    return img


def test_dragging_from_red_into_black_carries_red() -> None:
    stroke = SmudgeStroke(
        r=4, hardness=0.6, strength=0.8, pts=[[x + 0.5, 10.5] for x in range(14, 30)]
    )
    out = smudge.apply(halves(), [stroke])
    assert out[10, 24, 0] > 0.3  # red reached the black half
    assert out[0, 24, 0] == 0 and out[19, 35, 0] == 0  # far away: untouched
    assert np.all(out[..., 3] == 1)


def test_first_dab_only_picks_up_and_weak_strength_carries_less() -> None:
    one = SmudgeStroke(r=4, strength=1, pts=[[22.5, 10.5]])
    assert np.array_equal(smudge.apply(halves(), [one]), halves())
    pts = [[x + 0.5, 10.5] for x in range(14, 30)]
    strong = smudge.apply(halves(), [SmudgeStroke(r=4, strength=0.9, pts=pts)])
    weak = smudge.apply(halves(), [SmudgeStroke(r=4, strength=0.2, pts=pts)])
    assert strong[10, 26, 0] > weak[10, 26, 0]


def test_dabs_at_the_edge_stay_inside() -> None:
    stroke = SmudgeStroke(r=6, strength=0.7, pts=[[1, 1], [3, 2], [-5, -5], [38, 18], [45, 25]])
    out = smudge.apply(halves(), [stroke])
    assert out.shape == (20, 40, 4) and np.isfinite(out).all()
