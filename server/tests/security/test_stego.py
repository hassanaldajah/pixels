from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from security import stego

RNG = np.random.default_rng(7)


def photo(size: int = 512) -> np.ndarray:
    """A smooth scene with sensor-like noise: what an honest photo looks like to the screen."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float64)
    base = 110 + 60 * np.sin(x / 83) * np.cos(y / 61)
    img = np.stack([base + 20 * c for c in range(3)], axis=-1)
    img += RNG.normal(0, 2.5, img.shape)
    return np.clip(img, 0, 255).astype(np.uint8)


def save(path: Path, pixels: np.ndarray) -> Path:
    Image.fromarray(pixels).save(path, format="PNG")
    return path


def embed(pixels: np.ndarray, share: float = 1.0) -> np.ndarray:
    out = pixels.copy()
    flat = out.reshape(-1)
    n = int(flat.size * share)
    flat[:n] = (flat[:n] & 0xFE) | RNG.integers(0, 2, n, dtype=np.uint8)
    return out


def test_honest_photo_is_not_flagged(tmp_path: Path) -> None:
    assert not stego.analyse(save(tmp_path / "a.png", photo())).suspicious


def test_full_lsb_payload_is_flagged(tmp_path: Path) -> None:
    report = stego.analyse(save(tmp_path / "a.png", embed(photo())))
    assert report.checked and report.suspicious


def test_partial_lsb_payload_is_flagged(tmp_path: Path) -> None:
    assert stego.analyse(save(tmp_path / "a.png", embed(photo(), 0.3))).suspicious


def test_gradient_and_flat_artwork_are_not_flagged(tmp_path: Path) -> None:
    ramp = np.tile(np.arange(256, dtype=np.uint8), (256, 1))
    gradient = np.stack([ramp] * 3, axis=-1)
    flat = np.full((256, 256, 3), 90, dtype=np.uint8)
    assert not stego.analyse(save(tmp_path / "g.png", gradient)).suspicious
    assert not stego.analyse(save(tmp_path / "f.png", flat)).suspicious


def test_alpha_payload_is_flagged(tmp_path: Path) -> None:
    rgba = np.dstack([photo(), np.full((512, 512), 254, dtype=np.uint8)])
    rgba[..., 3] |= RNG.integers(0, 2, (512, 512), dtype=np.uint8)
    assert stego.analyse(save(tmp_path / "a.png", rgba)).suspicious


def test_real_transparency_is_not_flagged(tmp_path: Path) -> None:
    alpha = np.zeros((512, 512), dtype=np.uint8)
    alpha[128:384, 128:384] = 255
    assert not stego.analyse(save(tmp_path / "a.png", np.dstack([photo(), alpha]))).suspicious


def test_scrub_removes_the_payload_and_changes_pixels_by_at_most_one(tmp_path: Path) -> None:
    original = photo()
    path = save(tmp_path / "a.png", embed(original))
    assert stego.analyse(path).suspicious
    stego.scrub(path)
    assert not stego.analyse(path).suspicious
    after = np.asarray(Image.open(path)).astype(int)
    assert (
        int(np.abs(after - original.astype(int)).max()) <= 3
    )  # noise-free part of the payload effect is 1


# --- through the real gate ----------------------------------------------------------------------


def _png_bytes(pixels: np.ndarray) -> bytes:
    import io

    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format="PNG")
    return buffer.getvalue()


def test_gate_reports_hidden_data_and_hashes(gate, settings) -> None:  # type: ignore[no-untyped-def]
    import hashlib

    from .test_gate import run

    data = _png_bytes(embed(photo()))
    result = run(gate, settings, data, "x.png")
    assert result.meta["stego"]["suspicious"] is True
    assert any("LSB" in n for n in result.notices)
    assert result.meta["sha256_original"] == hashlib.sha256(data).hexdigest()
    assert len(result.meta["sha256_clean"]) == 64


def test_gate_scrub_setting_removes_it(gate, settings) -> None:  # type: ignore[no-untyped-def]
    from .test_gate import run

    settings.scrub_lsb = True
    result = run(gate, settings, _png_bytes(embed(photo())), "x.png")
    assert result.meta["stego"]["scrubbed"] is True
    assert not stego.analyse(result.clean_path).suspicious


def test_gate_honest_photo_has_no_stego_notice(gate, settings) -> None:  # type: ignore[no-untyped-def]
    from .test_gate import run

    result = run(gate, settings, _png_bytes(photo()), "x.png")
    assert result.meta["stego"]["checked"] and not result.meta["stego"]["suspicious"]
