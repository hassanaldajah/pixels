from __future__ import annotations

import numpy as np
import pytest

from pipeline import adjust, curves
from pipeline.blur import gaussian, kernel
from pipeline.color import hsl_to_rgb, linear_to_srgb, luma, rgb_to_hsl, srgb_to_linear
from pipeline.ops import Adjust

from .helpers import gradient, noisy

F32 = np.float32


def adj(**values) -> Adjust:  # type: ignore[no-untyped-def]
    return Adjust.model_validate(values)


def test_identity_returns_the_same_pixels() -> None:
    src = gradient()
    assert adjust.apply(src, Adjust()) is src


def test_colour_space_round_trips() -> None:
    x = np.linspace(0, 1, 101, dtype=F32)
    assert np.abs(linear_to_srgb(srgb_to_linear(x)) - x).max() < 1e-5
    rgb = gradient()[..., :3]
    h, s, light = rgb_to_hsl(rgb)
    assert np.abs(hsl_to_rgb(h, s, light) - rgb).max() < 1e-4


def test_exposure_one_stop_doubles_linear_light() -> None:
    src = np.full((2, 2, 4), 0.2, dtype=F32)
    src[..., 3] = 1.0
    out = adjust.apply(src, adj(exposure=1.0))
    assert srgb_to_linear(out[..., :3]) == pytest.approx(2 * srgb_to_linear(src[..., :3]), rel=1e-4)
    assert (out[..., 3] == 1).all()


def test_exposure_down_darkens_and_never_exceeds_one() -> None:
    src = gradient()
    assert adjust.apply(src, adj(exposure=-1.0))[..., :3].mean() < src[..., :3].mean()
    assert adjust.apply(src, adj(exposure=5.0))[..., :3].max() <= 1.0


def test_temperature_warms_and_tint_moves_green() -> None:
    grey = np.full((2, 2, 4), 0.5, dtype=F32)
    warm = adjust.apply(grey, adj(temperature=50))
    assert warm[0, 0, 0] > 0.5 > warm[0, 0, 2]
    assert adjust.apply(grey, adj(tint=50))[0, 0, 1] < 0.5


def test_contrast_pivots_on_mid_grey() -> None:
    src = np.array([[[0.25] * 3 + [1], [0.5] * 3 + [1], [0.75] * 3 + [1]]], dtype=F32)
    out = adjust.apply(src, adj(contrast=50))
    assert out[0, 1, 0] == pytest.approx(0.5, abs=1e-6)
    assert out[0, 0, 0] < 0.25 and out[0, 2, 0] > 0.75


def test_shadows_lift_darks_more_than_lights() -> None:
    src = np.array([[[0.1] * 3 + [1], [0.9] * 3 + [1]]], dtype=F32)
    out = adjust.apply(src, adj(shadows=100))
    assert out[0, 0, 0] - 0.1 > 0.1
    assert abs(out[0, 1, 0] - 0.9) < 0.02


def test_negative_highlights_recover_lights_only() -> None:
    src = np.array([[[0.1] * 3 + [1], [0.9] * 3 + [1]]], dtype=F32)
    out = adjust.apply(src, adj(highlights=-100))
    assert out[0, 1, 0] < 0.8
    assert abs(out[0, 0, 0] - 0.1) < 0.01


def test_whites_and_blacks_move_the_end_points() -> None:
    src = np.array([[[0.0] * 3 + [1], [1.0] * 3 + [1]]], dtype=F32)
    assert adjust.apply(src, adj(blacks=100))[0, 0, 0] > 0.15
    assert adjust.apply(src, adj(whites=-100))[0, 1, 0] < 0.9


def test_saturation_minus_100_is_grey_and_alpha_is_untouched() -> None:
    src = gradient(alpha=0.5)
    out = adjust.apply(src, adj(saturation=-100))
    assert np.allclose(out[..., 0], out[..., 1], atol=1e-5)
    assert np.allclose(out[..., 1], out[..., 2], atol=1e-5)
    assert np.array_equal(out[..., 3], src[..., 3])


def test_vibrance_boosts_dull_colours_more_than_vivid_ones() -> None:
    dull = np.array([[[0.5, 0.45, 0.4, 1]]], dtype=F32)
    vivid = np.array([[[1.0, 0.1, 0.0, 1]]], dtype=F32)

    def spread(p: np.ndarray) -> float:
        return float(p[..., :3].max() - p[..., :3].min())

    assert spread(adjust.apply(dull, adj(vibrance=100))) / spread(dull) > (
        spread(adjust.apply(vivid, adj(vibrance=100))) / spread(vivid)
    )


def test_hsl_red_band_only_touches_reds() -> None:
    src = np.array([[[0.8, 0.2, 0.2, 1], [0.2, 0.2, 0.8, 1]]], dtype=F32)
    out = adjust.apply(src, adj(hsl={"sat": [-100, 0, 0, 0, 0, 0, 0, 0]}))
    red_in, red_out = rgb_to_hsl(src[..., :3])[1][0, 0], rgb_to_hsl(out[..., :3])[1][0, 0]
    assert red_out < red_in * 0.2
    assert np.allclose(out[0, 1], src[0, 1], atol=1e-3)


def test_hsl_hue_shift_rotates_the_hue() -> None:
    src = np.array([[[0.8, 0.2, 0.2, 1]]], dtype=F32)
    out = adjust.apply(src, adj(hsl={"hue": [100, 0, 0, 0, 0, 0, 0, 0]}))
    assert rgb_to_hsl(out[..., :3])[0][0, 0] == pytest.approx(30.0, abs=1.0)


def test_levels_gamma_and_end_points() -> None:
    src = np.array([[[0.5, 0.5, 0.5, 1]]], dtype=F32)
    assert adjust.apply(src, adj(levels={"gamma": 2.0}))[0, 0, 0] == pytest.approx(
        0.5**0.5, abs=1e-5
    )
    assert adjust.apply(src, adj(levels={"black": 0.25, "white": 0.75}))[0, 0, 0] == pytest.approx(
        0.5, abs=1e-5
    )
    assert (
        adjust.apply(np.full((1, 1, 4), 0.2, dtype=F32), adj(levels={"black": 0.25}))[0, 0, 0]
        == 0.0
    )


def test_curve_lut_properties() -> None:
    identity = curves.curve_lut([[0, 0], [1, 1]])
    assert np.allclose(identity, np.linspace(0, 1, 256), atol=1e-6)
    s_curve = curves.curve_lut([[0, 0], [0.25, 0.15], [0.75, 0.85], [1, 1]])
    assert (np.diff(s_curve) >= -1e-7).all()
    assert s_curve[64] < 0.25 and s_curve[192] > 0.75
    assert s_curve[0] == 0 and s_curve[255] == 1


def test_curve_golden_values() -> None:
    lut = curves.curve_lut([[0, 0], [0.25, 0.15], [0.75, 0.9], [1, 1]])
    # The TypeScript engine is tested against the same numbers (apps/web/src/engine/curves.test.ts).
    golden = {
        0: 0.0,
        32: 0.0591,
        64: 0.1508,
        96: 0.3132,
        128: 0.5428,
        160: 0.764,
        192: 0.9017,
        224: 0.969,
        255: 1.0,
    }
    for index, expected in golden.items():
        assert lut[index] == pytest.approx(expected, abs=1e-4), index
    other = curves.curve_lut([[0, 0.1], [0.5, 0.6], [0.8, 0.7], [1, 1]])
    for index, expected in {
        0: 0.1,
        64: 0.4095,
        128: 0.6009,
        170: 0.6507,
        204: 0.7,
        255: 1.0,
    }.items():
        assert other[index] == pytest.approx(expected, abs=1e-4), index


def test_curves_apply_per_channel() -> None:
    src = np.full((1, 1, 4), 0.5, dtype=F32)
    out = adjust.apply(src, adj(curves={"r": [[0, 0], [0.5, 0.8], [1, 1]]}))
    assert out[0, 0, 0] == pytest.approx(0.8, abs=5e-3)
    assert out[0, 0, 1] == pytest.approx(0.5, abs=1e-5)


def test_curve_validation() -> None:
    with pytest.raises(ValueError):
        adj(curves={"master": [[0, 0], [0, 1]]})
    with pytest.raises(ValueError):
        adj(curves={"master": [[0, 0]]})


def test_gaussian_kernel_is_normalised_and_symmetric() -> None:
    k = kernel(2.0)
    assert k.sum() == pytest.approx(1.0, abs=1e-6)
    assert np.allclose(k, k[::-1])


def test_blur_keeps_flat_images_flat() -> None:
    assert np.allclose(gaussian(np.full((10, 10, 4), 0.3, dtype=F32), 3.0), 0.3, atol=1e-6)


def test_sharpen_increases_edge_contrast() -> None:
    edge = np.zeros((16, 16, 4), dtype=F32)
    edge[..., 3] = 1
    edge[:, 8:, :3] = 0.6
    edge[:, :8, :3] = 0.3
    out = adjust.apply(edge, adj(sharpen={"amount": 150, "radius": 1.0}))
    assert out[8, 8, 0] > 0.6 and out[8, 7, 0] < 0.3
    assert out[8, 0, 0] == pytest.approx(0.3, abs=1e-4)  # flat areas are untouched


def test_sharpen_threshold_ignores_faint_detail() -> None:
    faint = noisy(32, 32)
    out = adjust.apply(faint, adj(sharpen={"amount": 200, "radius": 1.0, "threshold": 50}))
    assert np.abs(out - faint).max() < 0.2


def test_noise_reduction_removes_noise_but_keeps_edges() -> None:
    rng = np.random.default_rng(1)
    img = np.full((48, 48, 4), 0.25, dtype=F32)
    img[:, 24:, :3] = 0.75
    img[..., 3] = 1
    noisy_img = np.clip(
        img + np.concatenate([rng.normal(0, 0.03, (48, 48, 3)), np.zeros((48, 48, 1))], axis=-1),
        0,
        1,
    ).astype(F32)
    out = adjust.apply(noisy_img, adj(noise_reduction=100))
    assert out[4:44, 2:20, 0].std() < noisy_img[4:44, 2:20, 0].std() * 0.6
    assert out[24, 30, 0] - out[24, 18, 0] > 0.4  # the edge survives


def test_vignette_darkens_the_corners_and_not_the_centre() -> None:
    src = np.full((40, 60, 4), 0.6, dtype=F32)
    out = adjust.apply(src, adj(vignette={"amount": -80, "midpoint": 30, "feather": 60}))
    assert out[20, 30, 0] == pytest.approx(0.6, abs=1e-4)
    assert out[0, 0, 0] < 0.4
    assert adjust.apply(src, adj(vignette={"amount": 80}))[0, 0, 0] > 0.8


def test_grain_is_deterministic_zero_mean_and_seeded() -> None:
    src = np.full((64, 64, 4), 0.5, dtype=F32)
    a = adjust.apply(src, adj(grain={"amount": 60, "size": 1, "seed": 5}))
    b = adjust.apply(src, adj(grain={"amount": 60, "size": 1, "seed": 5}))
    c = adjust.apply(src, adj(grain={"amount": 60, "size": 1, "seed": 6}))
    assert np.array_equal(a, b) and not np.array_equal(a, c)
    assert abs(float((a[..., 0] - 0.5).mean())) < 0.01
    assert 0.02 < float(a[..., 0].std()) < 0.12


def test_grain_cells_scale_with_size() -> None:
    out = adjust.apply(
        np.full((32, 32, 4), 0.5, dtype=F32), adj(grain={"amount": 100, "size": 4, "seed": 2})
    )
    assert np.array_equal(out[0, 0], out[3, 3]) and not np.array_equal(out[0, 0], out[0, 4])


def test_spatial_stages_leave_a_flat_centre_alone() -> None:
    src = np.full((20, 20, 4), 0.5, dtype=F32)
    out = adjust.apply(src, adj(sharpen={"amount": 100}, vignette={"amount": -50}))
    assert out[10, 10, 0] == pytest.approx(0.5, abs=1e-3)


def test_luma_weights() -> None:
    assert luma(np.array([[1, 1, 1]], dtype=F32))[0] == pytest.approx(1.0, abs=1e-6)
