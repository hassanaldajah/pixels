from __future__ import annotations

import time

import numpy as np
import pytest

from pipeline import inpaint

F32 = np.float32


def textured(h: int = 160, w: int = 200, seed: int = 4) -> np.ndarray:
    """A repeating, slightly noisy pattern: diagonal stripes plus a colour gradient."""
    y, x = np.mgrid[0:h, 0:w].astype(F32)
    stripes = 0.5 + 0.5 * np.sin((x + y) / 4.0)
    rng = np.random.default_rng(seed)
    img = np.stack(
        [stripes, 0.3 + 0.4 * x / w, 0.5 + 0.3 * np.cos(y / 9.0), np.ones_like(x)], axis=-1
    )
    img[..., :3] += rng.normal(0, 0.02, (h, w, 3)).astype(F32)
    return np.clip(img, 0, 1).astype(F32)


def hole(h: int, w: int, y0: int, y1: int, x0: int, x1: int) -> np.ndarray:
    m = np.zeros((h, w), dtype=bool)
    m[y0:y1, x0:x1] = True
    return m


def test_pixels_outside_the_gap_are_untouched() -> None:
    img = textured()
    mask = hole(160, 200, 60, 100, 80, 130)
    out = inpaint.erase(img, mask, inpaint.EraseOptions(quality="fast", grow=4, feather=2))
    far = np.ones_like(mask)
    far[40:120, 60:150] = False
    assert np.array_equal(out[far], img[far])
    assert out.dtype == np.float32 and out.shape == img.shape


def test_a_periodic_texture_is_reconstructed_closely() -> None:
    img = textured()
    mask = hole(160, 200, 60, 100, 80, 130)
    out = inpaint.erase(img, mask, inpaint.EraseOptions(quality="high", grow=0, feather=1))
    error = np.abs(out[60:100, 80:130, :3] - img[60:100, 80:130, :3]).mean()
    # the trivial fill (average colour) is far worse
    flat = np.abs(img[~mask][:, :3].mean(axis=0) - img[60:100, 80:130, :3]).mean()
    assert error < 0.10 and error < flat * 0.55, (error, flat)


def test_it_beats_a_blur_on_edges() -> None:
    img = np.zeros((120, 160, 4), dtype=F32)
    img[..., 3] = 1
    img[:, 80:, :3] = (0.9, 0.2, 0.2)
    img[:, :80, :3] = (0.1, 0.4, 0.9)
    mask = hole(120, 160, 40, 80, 60, 100)  # the gap crosses the vertical edge
    out = inpaint.erase(img, mask, inpaint.EraseOptions(quality="high", grow=0, feather=1))
    row = out[60, :, 0]
    assert row[62] < 0.35 and row[98] > 0.7  # both sides keep their colour
    assert np.abs(np.diff(row[70:90])).max() > 0.4  # and the edge stays sharp, not smeared


def test_gap_pixels_come_from_the_picture_not_new_colours() -> None:
    img = textured()
    mask = hole(160, 200, 50, 110, 70, 140)
    out = inpaint.erase(img, mask, inpaint.EraseOptions(quality="fast", grow=0, feather=1))
    lo, hi = img[..., :3].min(), img[..., :3].max()
    assert out[..., :3].min() >= lo - 0.05 and out[..., :3].max() <= hi + 0.05


def test_deterministic() -> None:
    img = textured(100, 120)
    mask = hole(100, 120, 30, 60, 40, 80)
    a = inpaint.erase(img, mask, inpaint.EraseOptions(quality="fast"))
    b = inpaint.erase(img, mask, inpaint.EraseOptions(quality="fast"))
    assert np.array_equal(a, b)


def test_empty_mask_and_bad_input() -> None:
    img = textured(40, 50)
    assert inpaint.erase(img, np.zeros((40, 50), dtype=bool)) is img
    with pytest.raises(ValueError):
        inpaint.erase(img, np.zeros((10, 10), dtype=bool))
    with pytest.raises(ValueError, match="whole picture"):
        inpaint.erase(img, np.ones((40, 50), dtype=bool))
    with pytest.raises(ValueError):
        inpaint.erase(img, hole(40, 50, 5, 10, 5, 10), inpaint.EraseOptions(quality="ultra"))


def test_transparency_is_kept_and_does_not_bleed() -> None:
    img = textured(100, 120)
    img[:, 90:, 3] = 0.0
    img[:, 90:, :3] = 0.0
    mask = hole(100, 120, 30, 60, 30, 70)
    out = inpaint.erase(img, mask, inpaint.EraseOptions(quality="fast", grow=0, feather=1))
    assert (out[30:60, 30:70, 3] > 0.9).all()
    assert (out[:, 95:, 3] == 0).all()


def test_large_pictures_are_processed_in_a_window() -> None:
    img = textured(900, 1200)
    mask = hole(900, 1200, 400, 470, 560, 660)
    started = time.time()
    out = inpaint.erase(img, mask, inpaint.EraseOptions(quality="fast"))
    assert time.time() - started < 60
    assert np.array_equal(out[:200], img[:200])  # far away: unchanged


def test_mask_packing_round_trip_and_fit() -> None:
    m = np.zeros((7, 9), dtype=bool)
    m[2:5, 3:8] = True
    assert np.array_equal(inpaint.unpack_mask(np.packbits(m).tobytes(), 9, 7), m)
    with pytest.raises(ValueError):
        inpaint.unpack_mask(b"abc", 9, 7)
    big = inpaint.fit_mask(m, 18, 14)
    assert big.shape == (14, 18) and big[4:10, 6:16].all() and not big[:3].any()


def test_dilate_and_blur_helpers() -> None:
    m = np.zeros((9, 9), dtype=bool)
    m[4, 4] = True
    assert inpaint.dilate(m, 2).sum() == 25 and inpaint.dilate(m, 0).sum() == 1
    flat = np.full((10, 10), 0.4, dtype=F32)
    assert np.allclose(inpaint.blur(flat, 2.0), 0.4, atol=1e-5)
