from __future__ import annotations

import numpy as np
import pytest

from pipeline import retouch

F32 = np.float32


def product_shot(h: int = 120, w: int = 160) -> np.ndarray:
    """A red disc on an even light-grey background."""
    y, x = np.mgrid[0:h, 0:w]
    img = np.ones((h, w, 4), dtype=F32)
    img[..., :3] = 0.9
    disc = (x - w / 2) ** 2 + (y - h / 2) ** 2 < 35**2
    img[disc, :3] = (0.8, 0.1, 0.1)
    return img


def test_cutout_removes_the_background_and_keeps_the_subject() -> None:
    out = retouch.cutout(product_shot())
    assert out[2, 2, 3] == 0.0  # corner: gone
    assert out[60, 80, 3] == pytest.approx(1.0)  # centre of the disc: kept
    assert np.allclose(out[60, 80, :3], (0.8, 0.1, 0.1))  # colour untouched
    edge = out[60, 80 + 34, 3]
    assert 0.0 <= edge <= 1.0


def test_cutout_contiguous_keeps_background_coloured_islands() -> None:
    img = product_shot()
    img[55:65, 75:85, :3] = (
        0.9  # a hole of background colour inside the subject, not touching the border
    )
    contiguous = retouch.cutout(img, contiguous=True)
    everywhere = retouch.cutout(img, contiguous=False)
    assert contiguous[60, 80, 3] == pytest.approx(1.0)
    assert everywhere[60, 80, 3] < 0.2


def test_cutout_explicit_colour_and_errors() -> None:
    img = product_shot()
    assert retouch.cutout(img, colour=(0.9, 0.9, 0.9))[2, 2, 3] == 0.0
    with pytest.raises(ValueError, match="No background"):
        retouch.cutout(img, tolerance=0, colour=(0.0, 1.0, 0.0))
    flat = np.ones((40, 40, 4), dtype=F32)
    with pytest.raises(ValueError, match="whole picture"):
        retouch.cutout(flat)


def test_cutout_large_picture_uses_the_coarse_search() -> None:
    img = np.ones((1500, 1800, 4), dtype=F32)
    img[..., :3] = 0.95
    img[500:1000, 600:1200, :3] = (0.1, 0.2, 0.7)
    out = retouch.cutout(img, feather=1)
    assert out[10, 10, 3] == pytest.approx(0.0, abs=1e-4)
    assert out[750, 900, 3] == pytest.approx(1.0)


def skin_patch(seed: int = 3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    img = np.ones((100, 100, 4), dtype=F32)
    img[..., :3] = (0.85, 0.65, 0.55)  # skin tone
    img[..., :3] += rng.normal(0, 0.03, (100, 100, 3)).astype(F32)  # blemishes / texture
    return np.clip(img, 0, 1).astype(F32)


def test_smooth_skin_reduces_texture_on_skin_only() -> None:
    skin = skin_patch()
    out = retouch.smooth_skin(skin, amount=100, radius=4)
    assert out[..., :3].std(axis=(0, 1)).mean() < 0.4 * skin[..., :3].std(axis=(0, 1)).mean()
    blue = np.ones((100, 100, 4), dtype=F32)
    noise = np.random.default_rng(1).normal(0, 0.03, (100, 100, 3)).astype(F32)
    blue[..., :3] = np.array((0.1, 0.2, 0.8), dtype=F32) + noise
    blue = np.clip(blue, 0, 1).astype(F32)
    untouched = retouch.smooth_skin(blue, amount=100, radius=4)
    assert np.abs(untouched - blue).max() < 0.02  # not skin: left alone


def test_smooth_skin_zero_amount_and_alpha_untouched() -> None:
    skin = skin_patch()
    skin[..., 3] = 0.5
    out = retouch.smooth_skin(skin, amount=0)
    assert np.allclose(out, skin, atol=1e-6)
    assert np.allclose(retouch.smooth_skin(skin, amount=80)[..., 3], 0.5)


def test_smooth_skin_keeps_a_strong_edge() -> None:
    img = skin_patch()
    img[:, 50:, :3] = 0.25  # dark hair next to skin
    out = retouch.smooth_skin(img, amount=100, radius=6, protect=100)
    assert abs(float(out[50, 45, 0] - out[50, 55, 0])) > 0.4


def test_upscale_size_alpha_and_sharpness() -> None:
    img = product_shot(60, 80)
    img[..., 3] = np.where(img[..., 0] > 0.85, 0.0, 1.0)  # transparent background
    out = retouch.upscale(img, factor=2.5, sharpen=50)
    assert out.shape == (150, 200, 4)
    assert out.min() >= 0.0 and out.max() <= 1.0
    assert out[2, 2, 3] == pytest.approx(0.0, abs=1e-3)
    assert np.allclose(
        out[75, 100, :3], (0.8, 0.1, 0.1), atol=0.05
    )  # no colour bleed from the transparent area


def test_upscale_sharpening_adds_edge_contrast_without_halos() -> None:
    edge = np.ones((40, 40, 4), dtype=F32)
    edge[:, :20, :3] = 0.3
    edge[:, 20:, :3] = 0.7
    soft = retouch.upscale(edge, 2.0, sharpen=0)
    crisp = retouch.upscale(edge, 2.0, sharpen=100)
    assert np.abs(np.diff(crisp[20, :, 0])).max() >= np.abs(np.diff(soft[20, :, 0])).max()
    assert crisp[..., :3].max() <= 0.7 + 0.101 and crisp[..., :3].min() >= 0.3 - 0.101
