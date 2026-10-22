"""Brush strokes: stamping, hardness, flow, erase, and painted local adjustments."""

from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError

from pipeline import paint, render
from pipeline.ops import Adjust, EditState, LocalAdjust, Paint, Stroke


def stroke(**kw: object) -> Stroke:
    return Stroke.model_validate({"r": 10, "pts": [[20, 20]], **kw})


def test_a_dab_is_round_and_soft() -> None:
    m = paint.mask(Paint(strokes=[stroke(hardness=0.0, flow=1.0)]), 40, 40)[..., 0]
    assert m[20, 20] > 0.97 and m[0, 0] == 0.0
    assert m[20, 20] > m[20, 25] > m[20, 29] > 0.0 and m[20, 31] == 0.0
    assert np.allclose(m[20, 14], m[14, 20], atol=1e-6)  # round


def test_hardness_keeps_the_centre_solid() -> None:
    hard = paint.mask(Paint(strokes=[stroke(hardness=0.9, flow=1.0)]), 40, 40)[..., 0]
    soft = paint.mask(Paint(strokes=[stroke(hardness=0.0, flow=1.0)]), 40, 40)[..., 0]
    assert hard[20, 25] > soft[20, 25] and hard.sum() > soft.sum()


def test_flow_builds_up_with_repeated_dabs() -> None:
    once = paint.mask(Paint(strokes=[stroke(flow=0.3)]), 40, 40)[20, 20, 0]
    twice = paint.mask(Paint(strokes=[stroke(flow=0.3, pts=[[20, 20], [20, 20]])]), 40, 40)[
        20, 20, 0
    ]
    assert twice > once and abs(twice - (1 - (1 - once) ** 2)) < 1e-5


def test_erase_rubs_paint_out() -> None:
    both = Paint(strokes=[stroke(flow=1.0), stroke(flow=1.0, erase=True, r=4)])
    m = paint.mask(both, 40, 40)[..., 0]
    assert m[20, 20] < 0.1 and m[20, 27] > 0.2  # a hole in the middle, paint around it


def test_dabs_outside_the_canvas_are_clipped() -> None:
    m = paint.mask(
        Paint(strokes=[stroke(pts=[[-50, -50], [500, 500], [0, 0]], flow=1.0, hardness=1.0)]),
        20,
        20,
    )
    assert m[0, 0, 0] > 0.5 and m.shape == (20, 20, 1)


def test_painted_adjustment_only_changes_painted_pixels() -> None:
    source = np.full((40, 40, 4), 0.4, dtype=np.float32)
    source[..., 3] = 1.0
    local = LocalAdjust(
        id="brush001",
        paint=Paint(strokes=[stroke(hardness=0.8, flow=1.0)]),
        adjust=Adjust(exposure=1.0),
    )
    out = render.render(source, EditState(local=[local]))
    assert (
        out[20, 20, 0] > 0.53
        and abs(out[2, 2, 0] - 0.4) < 1e-6
        and abs(out[39, 39, 0] - 0.4) < 1e-6
    )


def test_exactly_one_area_is_required() -> None:
    with pytest.raises(ValidationError):
        LocalAdjust.model_validate({"id": "nothing01"})
    with pytest.raises(ValidationError):
        LocalAdjust.model_validate(
            {
                "id": "both0001",
                "paint": {"strokes": []},
                "mask": {"kind": "linear", "x0": 0, "y0": 0, "x1": 1, "y1": 1},
            }
        )


def test_brush_limits() -> None:
    with pytest.raises(ValidationError):
        Stroke(r=0, pts=[[0, 0]])
    with pytest.raises(ValidationError):
        Stroke(r=5, pts=[])
    with pytest.raises(ValidationError):
        Paint(strokes=[Stroke(r=5, pts=[[0, 0]] * 4000)] * 11)
