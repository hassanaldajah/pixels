"""Local adjustments: graduated and radial filters (adjustments limited by a gradient)."""

from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError

from pipeline import render
from pipeline.ops import Adjust, EditState, LayerMask, LocalAdjust


def grey(w: int, h: int, v: float = 0.4) -> np.ndarray:
    out = np.full((h, w, 4), v, dtype=np.float32)
    out[..., 3] = 1.0
    return out


def local(**kw: object) -> LocalAdjust:
    return LocalAdjust.model_validate({"id": "local01", **kw})


def test_graduated_filter_brightens_only_where_opaque() -> None:
    top_to_bottom = LayerMask(kind="linear", x0=0, y0=0, x1=0, y1=20)
    state = EditState(local=[local(mask=top_to_bottom, adjust=Adjust(exposure=1.0))])
    out = render.render(grey(10, 20), state)
    column = out[:, 5, 0]
    assert column[0] < 0.42 and column[-1] > 0.52 and np.all(np.diff(column) >= -1e-6)


def test_radial_filter_and_invert() -> None:
    mask = LayerMask(kind="radial", x0=10, y0=10, x1=20, y1=10)
    state = EditState(local=[local(mask=mask, adjust=Adjust(exposure=1.0))])
    out = render.render(grey(20, 20), state)
    assert out[10, 10, 0] > 0.53 and abs(out[0, 0, 0] - 0.4) < 1e-6
    inverted = render.render(
        grey(20, 20),
        EditState(
            local=[
                local(mask=mask.model_copy(update={"invert": True}), adjust=Adjust(exposure=1.0))
            ]
        ),
    )
    assert abs(inverted[10, 10, 0] - 0.4) < 0.03 and inverted[0, 0, 0] > 0.53


def test_hidden_or_empty_adjustments_change_nothing() -> None:
    mask = LayerMask(kind="linear", x0=0, y0=0, x1=10, y1=0)
    source = grey(10, 4)
    hidden = EditState(local=[local(mask=mask, adjust=Adjust(exposure=2), visible=False)])
    empty = EditState(local=[local(mask=mask)])
    assert np.array_equal(render.render(source, hidden), source)
    assert np.array_equal(render.render(source, empty), source)


def test_filters_stack_on_top_of_global_edits() -> None:
    mask = LayerMask(kind="linear", x0=0, y0=0, x1=0, y1=10)
    state = EditState(
        adjust=Adjust(exposure=0.5),
        local=[local(mask=mask, adjust=Adjust(exposure=0.5))],
    )
    out = render.render(grey(4, 10), state)
    global_only = render.render(grey(4, 10), EditState(adjust=Adjust(exposure=0.5)))
    assert (
        np.allclose(out[0], global_only[0], atol=0.01)
        and out[-1, 0, 0] > global_only[-1, 0, 0] + 0.05
    )


def test_local_adjustments_are_validated() -> None:
    mask = LayerMask(kind="linear", x0=0, y0=0, x1=1, y1=1)
    with pytest.raises(ValidationError):
        LocalAdjust.model_validate({"id": "BAD ID", "mask": mask.model_dump()})
    with pytest.raises(ValidationError):
        EditState(local=[local(mask=mask)] * 2)
    with pytest.raises(ValidationError):
        EditState(local=[local(mask=mask, id=f"local{i:03d}") for i in range(9)])


def test_tone_weight_curves() -> None:
    from pipeline.render import tone_weight

    ramp = np.linspace(0, 1, 11, dtype=np.float32)
    image = np.stack([ramp, ramp, ramp, np.ones_like(ramp)], axis=-1)
    shadows = tone_weight(image, "shadows")[..., 0]
    highlights = tone_weight(image, "highlights")[..., 0]
    mids = tone_weight(image, "midtones")[..., 0]
    assert shadows[0] == 1 and shadows[-1] == 0 and np.all(np.diff(shadows) <= 0)
    assert highlights[0] == 0 and highlights[-1] == 1 and np.all(np.diff(highlights) >= 0)
    assert mids[5] == 1 and mids[0] == 0 and mids[-1] == 0
    assert np.all((mids >= 0) & (mids <= 1))
