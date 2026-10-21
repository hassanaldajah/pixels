"""Recipes: a saved sequence (orientation, layout, adjustments, export) applied to many images.

A recipe is image-independent. `resolve` turns it into a concrete `EditState` for one image
(for example "pad to 1:1" needs that image's size), and `run_recipe` renders and encodes it.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from pipeline import geometry
from pipeline.export import Encoded, ExportOptions, encode
from pipeline.ops import (
    Adjust,
    Canvas,
    Crop,
    EditState,
    Flip,
    GeoOp,
    Resize,
    Rotate90,
)
from pipeline.render import load_rgba, render

HEX = r"^#[0-9a-fA-F]{6}$"


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NoLayout(_Model):
    type: Literal["none"] = "none"


class PadSquare(_Model):
    type: Literal["pad_square"]
    fill: str | None = Field(default=None, pattern=HEX)  # None = transparent


class Fit(_Model):
    type: Literal["fit"]
    w: int = Field(ge=1, le=20_000)
    h: int = Field(ge=1, le=20_000)
    mode: Literal["cover", "contain"] = "cover"
    fill: str | None = Field(default=None, pattern=HEX)
    focus_x: float = Field(default=0.5, ge=0, le=1)
    focus_y: float = Field(default=0.5, ge=0, le=1)


Layout = Annotated[NoLayout | PadSquare | Fit, Field(discriminator="type")]


class Recipe(_Model):
    name: str = Field(default="Recipe", min_length=1, max_length=80)
    orientation: list[Rotate90 | Flip] = Field(default_factory=list, max_length=8)
    layout: Layout = Field(default_factory=NoLayout)
    adjust: Adjust = Field(default_factory=Adjust)
    export: ExportOptions = Field(default_factory=ExportOptions)
    suffix: str = Field(default="", max_length=40, pattern=r"^[A-Za-z0-9_.-]*$")


def resolve(recipe: Recipe, width: int, height: int) -> EditState:
    ops: list[GeoOp] = list(recipe.orientation)
    w, h = geometry.output_size(ops, width, height)
    layout = recipe.layout
    if isinstance(layout, PadSquare):
        side = max(w, h)
        ops.append(Canvas(type="canvas", w=side, h=side, anchor="c", fill=layout.fill))
    elif isinstance(layout, Fit):
        if layout.mode == "cover":
            scale = max(layout.w / w, layout.h / h)
            sw, sh = max(layout.w, math.ceil(w * scale)), max(layout.h, math.ceil(h * scale))
            if (sw, sh) != (w, h):
                ops.append(Resize(type="resize", w=sw, h=sh))
            x = round(min(max(layout.focus_x * sw - layout.w / 2, 0), sw - layout.w))
            y = round(min(max(layout.focus_y * sh - layout.h / 2, 0), sh - layout.h))
            ops.append(Crop(type="crop", x=x, y=y, w=layout.w, h=layout.h))
        else:
            scale = min(layout.w / w, layout.h / h)
            sw, sh = max(1, round(w * scale)), max(1, round(h * scale))
            if (sw, sh) != (w, h):
                ops.append(Resize(type="resize", w=sw, h=sh))
            ops.append(Canvas(type="canvas", w=layout.w, h=layout.h, anchor="c", fill=layout.fill))
    return EditState(geometry=ops, adjust=recipe.adjust)


def run_recipe(png: Path, recipe: Recipe, max_pixels: int, safe_exif: dict | None = None) -> Encoded:  # type: ignore[type-arg]
    source = load_rgba(png)
    state = resolve(recipe, source.shape[1], source.shape[0])
    return encode(render(source, state, max_pixels), recipe.export, safe_exif)
