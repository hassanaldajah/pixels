from __future__ import annotations

import numpy as np
import pytest
from pydantic import TypeAdapter

from pipeline import geometry
from pipeline.ops import GeoOp

from .helpers import gradient, indexed

ADAPTER = TypeAdapter(list[GeoOp])
MAX = 10**9


def ops(*items: dict) -> list:
    return ADAPTER.validate_python(list(items))


def run(image, *items: dict):
    return geometry.apply(image, ops(*items), MAX)


def test_rotate90_moves_every_pixel_exactly() -> None:
    src = indexed(3, 5)
    out = run(src, {"type": "rotate90", "turns": 1})
    assert out.shape == (5, 3, 4)
    for y in range(3):
        for x in range(5):
            assert out[x, 3 - 1 - y, 0] == src[y, x, 0]  # clockwise: (x, y) -> (h-1-y, x)


@pytest.mark.parametrize("turns", [1, 2, 3])
def test_four_quarter_turns_are_the_identity(turns: int) -> None:
    src = gradient(7, 9)
    out = run(
        src,
        *([{"type": "rotate90", "turns": turns}] * (4 // np.gcd(4, turns) if turns != 2 else 2)),
    )
    assert np.array_equal(out, src)


def test_flips() -> None:
    src = indexed(4, 6)
    assert np.array_equal(run(src, {"type": "flip", "axis": "h"}), src[:, ::-1])
    assert np.array_equal(run(src, {"type": "flip", "axis": "v"}), src[::-1])


def test_crop_is_exact_and_clipped_to_the_image() -> None:
    src = indexed(10, 12)
    assert np.array_equal(run(src, {"type": "crop", "x": 2, "y": 3, "w": 4, "h": 5}), src[3:8, 2:6])
    clipped = run(src, {"type": "crop", "x": 10, "y": 8, "w": 50, "h": 50})
    assert clipped.shape == (2, 2, 4)


def test_generic_sampler_matches_exact_copy_for_a_quarter_turn() -> None:
    src = gradient(20, 30)
    exact = run(src, {"type": "rotate90", "turns": 1})
    sampled = run(src, {"type": "rotate", "angle": 90, "expand": True})
    assert sampled.shape == exact.shape
    assert np.abs(sampled - exact)[2:-2, 2:-2].max() < 1e-4


def test_rotate_expands_and_leaves_transparent_corners() -> None:
    src = gradient(20, 40)
    out = run(src, {"type": "rotate", "angle": 30, "expand": True})
    expected_w = int(np.ceil(40 * np.cos(np.radians(30)) + 20 * np.sin(np.radians(30))))
    assert out.shape[1] == expected_w
    assert out[0, 0, 3] == 0.0
    assert out[out.shape[0] // 2, out.shape[1] // 2, 3] == 1.0


def test_straighten_keeps_the_aspect_and_has_no_empty_corners() -> None:
    src = gradient(40, 60)
    out = run(src, {"type": "straighten", "angle": 8})
    assert out.shape[1] / out.shape[0] == pytest.approx(60 / 40, rel=0.05)
    assert out.shape[0] < 40 and out.shape[1] < 60
    assert (out[..., 3] > 0.99).mean() > 0.995


def test_perspective_with_the_identity_quad_changes_nothing() -> None:
    src = gradient(20, 30)
    out = run(src, {"type": "perspective", "quad": [[0, 0], [30, 0], [30, 20], [0, 20]]})
    assert np.abs(out - src)[1:-1, 1:-1].max() < 1e-4


def test_perspective_moves_a_corner() -> None:
    src = gradient(40, 40)
    out = run(src, {"type": "perspective", "quad": [[10, 0], [40, 0], [40, 40], [0, 40]]})
    assert out[1, 2, 3] == 0.0  # the top-left corner of the canvas is now empty
    assert out[30, 20, 3] == 1.0


def test_degenerate_perspective_is_refused() -> None:
    with pytest.raises(geometry.GeometryError):
        run(gradient(10, 10), {"type": "perspective", "quad": [[0, 0], [5, 5], [10, 10], [3, 3]]})


def test_zero_skew_is_the_identity() -> None:
    src = gradient(16, 16)
    assert np.abs(run(src, {"type": "skew", "x": 0, "y": 0}) - src)[1:-1, 1:-1].max() < 1e-4


def test_canvas_anchor_and_fill() -> None:
    src = indexed(2, 2)
    out = run(src, {"type": "canvas", "w": 4, "h": 4, "anchor": "br", "fill": "#ff0000"})
    assert out.shape == (4, 4, 4)
    assert np.array_equal(out[2:, 2:], src)
    assert tuple(out[0, 0]) == (1.0, 0.0, 0.0, 1.0)
    transparent = run(src, {"type": "canvas", "w": 4, "h": 4, "anchor": "c"})
    assert transparent[0, 0, 3] == 0.0 and np.array_equal(transparent[1:3, 1:3], src)


def test_canvas_smaller_than_the_image_crops_it() -> None:
    src = indexed(6, 6)
    out = run(src, {"type": "canvas", "w": 2, "h": 2, "anchor": "c"})
    assert np.array_equal(out, src[2:4, 2:4])


def test_translucent_edges_do_not_darken() -> None:
    src = gradient(16, 16)
    src[..., :3] = 0.8
    src[:, :8, 3] = 0.0  # left half fully transparent (its colour channels are meaningless)
    src[:, :8, :3] = 0.0
    out = run(src, {"type": "rotate", "angle": 10, "expand": False})
    visible = out[..., 3] > 0.5
    assert np.allclose(out[visible][:, :3], 0.8, atol=1e-3)


def test_output_size_limit() -> None:
    with pytest.raises(geometry.GeometryError, match="limit"):
        geometry.apply(
            gradient(10, 10),
            ops({"type": "canvas", "w": 5000, "h": 5000, "anchor": "c"}),
            1_000_000,
        )


def test_output_size_without_pixels() -> None:
    assert geometry.output_size(
        ops({"type": "rotate90", "turns": 1}, {"type": "crop", "x": 0, "y": 0, "w": 3, "h": 4}),
        10,
        20,
    ) == (3, 4)
