"""Render an EditState to float32 RGBA: geometry, adjustments, layers, then pixel art."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from PIL import Image

from pipeline import adjust, clone, geometry, layers, liquify, paint, pixelart, selection, smudge
from pipeline.layers import LayerLoader
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
    image = liquify.apply(
        image, state.liquify
    )  # reshaping comes first: retouching works on the result
    image = clone.apply(image, state.clone)
    image = smudge.apply(image, state.smudge)
    adjusted = adjust.apply(image, state.adjust, scale=1.0)
    if state.selection is not None and not state.adjust.is_identity():
        adjusted = selection.apply_inside(image, adjusted, state.selection)
    for local in state.local:  # each one blends in where its gradient is opaque
        if not local.visible or local.adjust.is_identity():
            continue
        tweaked = adjust.apply(adjusted, local.adjust, scale=1.0)
        h, w = adjusted.shape[:2]
        weight = (
            layers.mask_values(local.mask, w, h)
            if local.mask is not None
            else paint.mask(local.paint, w, h)  # type: ignore[arg-type]
        )
        if local.tone != "all":
            weight = weight * tone_weight(adjusted, local.tone)
        adjusted = np.asarray(adjusted + (tweaked - adjusted) * weight, dtype=np.float32)
    return adjusted


def _smoothstep(e0: float, e1: float, x: Array) -> Array:
    t = np.clip((x - np.float32(e0)) / np.float32(e1 - e0), 0.0, 1.0)
    return np.asarray(t * t * (np.float32(3) - np.float32(2) * t), dtype=np.float32)


def tone_weight(image: Array, tone: str) -> Array:
    """How much a pixel belongs to the shadows, midtones or highlights (0..1), from its luminance.
    The GPU preview uses the same curves (MIX_FRAG in engine/shaders.ts)."""
    lum = (
        np.float32(0.2126) * image[..., 0:1]
        + np.float32(0.7152) * image[..., 1:2]
        + np.float32(0.0722) * image[..., 2:3]
    )
    if tone == "shadows":
        return np.float32(1) - _smoothstep(0.0, 0.55, lum)
    if tone == "highlights":
        return _smoothstep(0.45, 1.0, lum)
    centred = np.float32(2) * lum - np.float32(1)
    return np.asarray(np.clip(np.float32(1) - centred * centred, 0.0, 1.0), dtype=np.float32)


def render_composite(
    source: Array,
    state: EditState,
    max_pixels: int = DEFAULT_MAX_PIXELS,
    load_layer: LayerLoader | None = None,
) -> Array:
    """Geometry, adjustments and the layers on top (everything except the pixel-art effect)."""
    return layers.composite(render_base(source, state, max_pixels), state.layers, load_layer)


def render_with_info(
    source: Array,
    state: EditState,
    max_pixels: int = DEFAULT_MAX_PIXELS,
    load_layer: LayerLoader | None = None,
) -> tuple[Array, dict[str, object] | None]:
    image = render_composite(source, state, max_pixels, load_layer)
    if state.pixelart is None:
        return image, None
    return pixelart.apply(image, state.pixelart)


def render(
    source: Array,
    state: EditState,
    max_pixels: int = DEFAULT_MAX_PIXELS,
    load_layer: LayerLoader | None = None,
) -> Array:
    return render_with_info(source, state, max_pixels, load_layer)[0]
