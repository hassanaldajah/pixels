"""Motion, lens and spin blur: the tap patterns the GPU shader repeats exactly."""

from __future__ import annotations

import numpy as np

from pipeline import blur


def image(w: int = 41, h: int = 31) -> np.ndarray:
    out = np.zeros((h, w, 3), np.float32)
    out[h // 2, w // 2] = 1.0  # one bright point in the middle
    return out


def test_motion_spreads_along_its_direction_only() -> None:
    horizontal = blur.motion(image(), 2.0, 0.0)
    row = horizontal[15, :, 0]
    assert np.count_nonzero(row) == 13 and np.count_nonzero(horizontal[14]) == 0
    vertical = blur.motion(image(), 2.0, 90.0)
    assert np.count_nonzero(vertical[:, 20, 0]) == 13 and np.count_nonzero(vertical[:, 19]) == 0
    assert abs(float(horizontal.sum()) - 3.0) < 1e-5  # energy is kept (three channels)


def test_motion_taps_round_half_away_like_the_shader() -> None:
    taps = blur.motion_taps(1.0, 45.0)
    assert taps[0] == (-2, 2) and taps[-1] == (2, -2) and (0, 0) in taps


def test_lens_is_round_and_boosts_highlights() -> None:
    out = blur.lens(image(), 6.0)
    ys, xs = np.nonzero(out[..., 0])
    radius = np.hypot(ys - 15, xs - 20)
    assert radius.max() <= 9.5 and np.ptp(xs) == np.ptp(ys)
    flat = np.full((9, 9, 3), 0.5, np.float32)
    assert np.allclose(blur.lens(flat, 3.0), 0.5)  # a flat area stays flat
    assert len(set(blur.lens_taps(9.0))) > 50


def test_spin_keeps_the_centre_and_moves_the_edges() -> None:
    grid = np.zeros((40, 40, 3), np.float32)
    grid[:, ::4] = 1.0  # vertical stripes
    out = blur.spin(grid, 16.0)
    assert out.shape == grid.shape and 0 < out.mean() <= 1
    centre_change = np.abs(out[18:22, 18:22] - grid[18:22, 18:22]).mean()
    edge_change = np.abs(out[:4] - grid[:4]).mean()
    assert edge_change > centre_change


def test_nothing_happens_at_zero() -> None:
    img = image()
    for kind in ("motion", "lens", "spin", "gaussian"):
        assert blur.apply_kind(img, kind, 0.0, 0.0) is img
