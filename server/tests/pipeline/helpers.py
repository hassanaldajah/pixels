from __future__ import annotations

import numpy as np

F32 = np.float32


def gradient(h: int = 24, w: int = 32, alpha: float = 1.0) -> np.ndarray:
    """A smooth, asymmetric RGBA test picture (no two pixels alike)."""
    y, x = np.mgrid[0:h, 0:w].astype(F32)
    r = x / (w - 1)
    g = y / (h - 1)
    b = (0.5 + 0.5 * np.sin(x / 4.0) * np.cos(y / 5.0)).astype(F32)
    a = np.full_like(r, alpha)
    return np.stack([r, g, b, a], axis=-1).astype(F32)


def indexed(h: int, w: int) -> np.ndarray:
    """Every pixel's red channel is its unique index, so moves can be checked exactly."""
    values = (np.arange(h * w, dtype=F32) / (h * w)).reshape(h, w)
    out = np.zeros((h, w, 4), dtype=F32)
    out[..., 0] = values
    out[..., 3] = 1.0
    return out


def noisy(h: int = 64, w: int = 64, seed: int = 3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    base = np.full((h, w, 4), 0.5, dtype=F32)
    base[..., :3] += rng.normal(0, 0.05, (h, w, 3)).astype(F32)
    base[..., 3] = 1.0
    return np.clip(base, 0, 1)
