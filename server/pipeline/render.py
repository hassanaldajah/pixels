"""Render an EditState to float32 RGBA: geometry first, then adjustments."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from PIL import Image

from pipeline import adjust, geometry, pixelart
from pipeline.ops import EditState

Array = NDArray[np.float32]
DEFAULT_MAX_PIXELS = 100_000_000


def load_rgba(path: Path) -> Array:
    """Read a sanitised working copy (always an 8-bit RGB or RGBA PNG) as float32 RGBA in 0..1."""
    with Image.open(path) as image:
        rgba = np.asarray(image.convert("RGBA"), dtype=np.float32)
    return rgba / np.float32(255.0)


def render_base(source: Array, state: EditState, max_pixels: int = DEFAULT_MAX_PIXELS) -> Array:
    """Geometry and adjustments only (everything except the pixel-art effect)."""
    image = geometry.apply(source, state.geometry, max_pixels) if state.geometry else source
    return adjust.apply(image, state.adjust, scale=1.0)


def render_with_info(
    source: Array, state: EditState, max_pixels: int = DEFAULT_MAX_PIXELS
) -> tuple[Array, dict[str, object] | None]:
    base = render_base(source, state, max_pixels)
    if state.pixelart is None:
        return base, None
    return pixelart.apply(base, state.pixelart)


def render(source: Array, state: EditState, max_pixels: int = DEFAULT_MAX_PIXELS) -> Array:
    return render_with_info(source, state, max_pixels)[0]
