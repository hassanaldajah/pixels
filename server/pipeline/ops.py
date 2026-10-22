"""The edit model. One `EditState` describes everything done to an image, non-destructively.

The browser previews an `EditState` on the GPU and the server renders the same `EditState` with
NumPy for the final export. The two implementations follow docs/PIPELINE.md.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
Anchor = Literal["tl", "tc", "tr", "ml", "c", "mr", "bl", "bc", "br"]
HSL_BANDS = ("red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta")
HSL_CENTERS = (0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 270.0, 300.0)
MAX_GEOMETRY_OPS = 64
MAX_CURVE_POINTS = 16


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- geometry --------------------------------------------------------------------------------
class Rotate90(_Model):
    type: Literal["rotate90"]
    turns: int = Field(ge=1, le=3)  # clockwise quarter turns


class Flip(_Model):
    type: Literal["flip"]
    axis: Literal["h", "v"]


class Rotate(_Model):
    type: Literal["rotate"]
    angle: float = Field(ge=-180, le=180)  # degrees, clockwise
    expand: bool = True  # grow the canvas to hold the whole rotated image


class Straighten(_Model):
    type: Literal["straighten"]
    angle: float = Field(
        ge=-45, le=45
    )  # rotate, then keep the largest same-aspect rectangle inside


class Crop(_Model):
    type: Literal["crop"]
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    w: int = Field(ge=1)
    h: int = Field(ge=1)


class Skew(_Model):
    type: Literal["skew"]
    x: float = Field(ge=-45, le=45)
    y: float = Field(ge=-45, le=45)


class Perspective(_Model):
    type: Literal["perspective"]
    # Where the image's TL, TR, BR, BL corners move to, in the current canvas (pixels).
    quad: list[list[float]] = Field(min_length=4, max_length=4)

    @field_validator("quad")
    @classmethod
    def _points(cls, value: list[list[float]]) -> list[list[float]]:
        for point in value:
            if len(point) != 2 or any(abs(c) > 1e6 for c in point):
                raise ValueError("each quad point must be [x, y]")
        return value


class Resize(_Model):
    type: Literal["resize"]
    w: int = Field(ge=1, le=100_000)
    h: int = Field(ge=1, le=100_000)


class Canvas(_Model):
    type: Literal["canvas"]
    w: int = Field(ge=1, le=100_000)
    h: int = Field(ge=1, le=100_000)
    anchor: Anchor = "c"
    fill: str | None = None  # "#rrggbb", or None for transparent

    @field_validator("fill")
    @classmethod
    def _fill(cls, value: str | None) -> str | None:
        if value is not None and not HEX_COLOR.fullmatch(value):
            raise ValueError("fill must be #rrggbb or null")
        return value


GeoOp = Annotated[
    Rotate90 | Flip | Rotate | Straighten | Crop | Skew | Perspective | Resize | Canvas,
    Field(discriminator="type"),
]


# --- adjustments -----------------------------------------------------------------------------
def _pct() -> float:
    return Field(default=0.0, ge=-100, le=100)


class Levels(_Model):
    black: float = Field(default=0.0, ge=0.0, le=0.98)
    white: float = Field(default=1.0, ge=0.02, le=1.0)
    gamma: float = Field(default=1.0, ge=0.1, le=10.0)


class Hsl(_Model):
    hue: list[float] = Field(default_factory=lambda: [0.0] * 8, min_length=8, max_length=8)
    sat: list[float] = Field(default_factory=lambda: [0.0] * 8, min_length=8, max_length=8)
    lum: list[float] = Field(default_factory=lambda: [0.0] * 8, min_length=8, max_length=8)

    @field_validator("hue", "sat", "lum")
    @classmethod
    def _range(cls, value: list[float]) -> list[float]:
        if any(abs(v) > 100 for v in value):
            raise ValueError("HSL values are between -100 and 100")
        return value


class Curves(_Model):
    master: list[list[float]] = Field(default_factory=lambda: [[0.0, 0.0], [1.0, 1.0]])
    r: list[list[float]] = Field(default_factory=lambda: [[0.0, 0.0], [1.0, 1.0]])
    g: list[list[float]] = Field(default_factory=lambda: [[0.0, 0.0], [1.0, 1.0]])
    b: list[list[float]] = Field(default_factory=lambda: [[0.0, 0.0], [1.0, 1.0]])

    @field_validator("master", "r", "g", "b")
    @classmethod
    def _points(cls, value: list[list[float]]) -> list[list[float]]:
        if not 2 <= len(value) <= MAX_CURVE_POINTS:
            raise ValueError(f"a curve needs 2 to {MAX_CURVE_POINTS} points")
        for point in value:
            if len(point) != 2 or not all(0.0 <= c <= 1.0 for c in point):
                raise ValueError("curve points are [x, y] within 0..1")
        xs = [p[0] for p in value]
        if len(set(xs)) != len(xs):
            raise ValueError("curve points need distinct x values")
        return sorted(value)


class Sharpen(_Model):
    amount: float = Field(default=0.0, ge=0, le=300)  # percent
    radius: float = Field(default=1.0, ge=0.3, le=5.0)  # source pixels
    threshold: float = Field(default=0.0, ge=0, le=50)  # 0..255 levels


class Vignette(_Model):
    amount: float = _pct()
    midpoint: float = Field(default=50.0, ge=0, le=100)
    feather: float = Field(default=50.0, ge=1, le=100)


class Grain(_Model):
    amount: float = Field(default=0.0, ge=0, le=100)
    size: float = Field(default=1.0, ge=0.5, le=8.0)  # source pixels
    seed: int = Field(default=1, ge=0, le=2**31 - 1)


class Adjust(_Model):
    exposure: float = Field(default=0.0, ge=-5, le=5)  # EV
    temperature: float = _pct()
    tint: float = _pct()
    contrast: float = _pct()
    highlights: float = _pct()
    shadows: float = _pct()
    whites: float = _pct()
    blacks: float = _pct()
    vibrance: float = _pct()
    saturation: float = _pct()
    levels: Levels = Field(default_factory=Levels)
    hsl: Hsl = Field(default_factory=Hsl)
    curves: Curves = Field(default_factory=Curves)
    noise_reduction: float = Field(default=0.0, ge=0, le=100)
    blur: float = Field(default=0.0, ge=0, le=32)  # Gaussian blur, sigma in source pixels
    sharpen: Sharpen = Field(default_factory=Sharpen)
    vignette: Vignette = Field(default_factory=Vignette)
    grain: Grain = Field(default_factory=Grain)

    def is_identity(self) -> bool:
        return self == Adjust()


PaletteName = Literal["auto", "gameboy", "pico8", "nes", "c64", "cga", "endesga32", "custom"]
Dither = Literal["none", "bayer2", "bayer4", "bayer8", "floyd", "atkinson"]
MAX_PALETTE = 64


class PixelArt(_Model):
    """Turns the picture into pixel art. Applied last, after geometry and adjustments."""

    pixel_size: int = Field(default=6, ge=2, le=32)  # source pixels per art pixel
    smooth: float = Field(
        default=30.0, ge=0, le=100
    )  # edge-preserving smoothing before the reduction
    palette: PaletteName = "auto"
    colors: int = Field(default=16, ge=2, le=MAX_PALETTE)  # for "auto" (k-means)
    custom_palette: list[str] = Field(default_factory=list, max_length=MAX_PALETTE)
    dither: Dither = "none"
    dither_strength: float = Field(default=0.7, ge=0, le=1)
    outline: bool = False
    outline_color: str = "#000000"
    scale: int = Field(default=0, ge=0, le=16)  # 0 = keep the picture's size; n = native size x n

    @field_validator("outline_color")
    @classmethod
    def _outline(cls, value: str) -> str:
        if not HEX_COLOR.fullmatch(value):
            raise ValueError("outline_color must be #rrggbb")
        return value

    @field_validator("custom_palette")
    @classmethod
    def _custom(cls, value: list[str]) -> list[str]:
        if any(not HEX_COLOR.fullmatch(v) for v in value):
            raise ValueError("palette colours must be #rrggbb")
        return value


# --- selection ----------------------------------------------------------------------------
MAX_SELECTION_POINTS = 128


class Selection(_Model):
    """Where the adjustments apply, on the edited canvas. Rectangle/ellipse use x, y, w, h; polygon uses points."""

    kind: Literal["rect", "ellipse", "polygon"]
    x: float = Field(default=0.0, ge=-1e6, le=1e6)
    y: float = Field(default=0.0, ge=-1e6, le=1e6)
    w: float = Field(default=1.0, gt=0, le=1e6)
    h: float = Field(default=1.0, gt=0, le=1e6)
    points: list[list[float]] = Field(default_factory=list, max_length=MAX_SELECTION_POINTS)
    feather: float = Field(default=0.0, ge=0, le=500)  # pixels
    invert: bool = False

    @field_validator("points")
    @classmethod
    def _points(cls, value: list[list[float]]) -> list[list[float]]:
        for point in value:
            if len(point) != 2 or any(abs(c) > 1e6 for c in point):
                raise ValueError("each point must be [x, y]")
        return value

    @model_validator(mode="after")
    def _polygon(self) -> Selection:
        if self.kind == "polygon" and len(self.points) < 3:
            raise ValueError("a polygon needs at least 3 points")
        return self


# --- layers ----------------------------------------------------------------------------------
BlendMode = Literal[
    "normal", "multiply", "screen", "overlay", "darken", "lighten", "difference", "soft-light"
]
MAX_LAYERS = 16
LAYER_ID = re.compile(r"^[a-z0-9]{6,32}$")
IMAGE_ID = re.compile(r"^[0-9a-f]{32}$")


class LayerMask(_Model):
    """A gradient that fades a layer. Linear: transparent at (x0, y0) to opaque at (x1, y1).
    Radial: opaque at the centre (x0, y0) to transparent at the distance to (x1, y1). `invert` flips it.
    """

    kind: Literal["linear", "radial"]
    x0: float = Field(ge=-1e6, le=1e6)
    y0: float = Field(ge=-1e6, le=1e6)
    x1: float = Field(ge=-1e6, le=1e6)
    y1: float = Field(ge=-1e6, le=1e6)
    invert: bool = False

    @field_validator("y1")
    @classmethod
    def _distinct(cls, value: float, info: object) -> float:
        data = getattr(info, "data", {})
        if (data.get("x0"), data.get("y0")) == (data.get("x1"), value):
            raise ValueError("the mask's two points must differ")
        return value


class Layer(_Model):
    """A picture placed above the edited image. Its pixels are another sanitised working copy."""

    id: str
    image_id: str  # a working copy that went through the Security Gate
    name: str = Field(default="Layer", max_length=64)
    visible: bool = True
    opacity: float = Field(default=100.0, ge=0, le=100)  # percent
    blend: BlendMode = "normal"
    x: float = Field(default=0.0, ge=-1e6, le=1e6)  # top-left corner on the canvas, in pixels
    y: float = Field(default=0.0, ge=-1e6, le=1e6)
    scale: float = Field(default=1.0, ge=0.01, le=20.0)
    mask: LayerMask | None = None

    @field_validator("id")
    @classmethod
    def _id(cls, value: str) -> str:
        if not LAYER_ID.fullmatch(value):
            raise ValueError("a layer id is 6 to 32 lowercase letters and digits")
        return value

    @field_validator("image_id")
    @classmethod
    def _image(cls, value: str) -> str:
        if not IMAGE_ID.fullmatch(value):
            raise ValueError("invalid image id")
        return value


MAX_LOCAL = 8
MAX_CLONE = 60
MAX_STROKES = 300
MAX_DABS = 40_000


class Stroke(_Model):
    """One brush stroke: round soft dabs at `pts` (canvas pixels). `erase` rubs paint out instead of adding it."""

    r: float = Field(ge=1, le=4000)  # radius, pixels
    hardness: float = Field(default=0.5, ge=0, le=1)
    flow: float = Field(default=0.5, ge=0.01, le=1)
    erase: bool = False
    pts: list[list[float]] = Field(min_length=1, max_length=4000)

    @field_validator("pts")
    @classmethod
    def _points(cls, value: list[list[float]]) -> list[list[float]]:
        for point in value:
            if len(point) != 2 or any(abs(c) > 1e6 for c in point):
                raise ValueError("each dab must be [x, y]")
        return value


class Paint(_Model):
    """Brush strokes that make up a painted mask."""

    strokes: list[Stroke] = Field(default_factory=list, max_length=MAX_STROKES)

    @field_validator("strokes")
    @classmethod
    def _total(cls, value: list[Stroke]) -> list[Stroke]:
        if sum(len(s.pts) for s in value) > MAX_DABS:
            raise ValueError(f"a brush can hold at most {MAX_DABS} dabs")
        return value


class ClonePaint(_Model):
    """One clone-stamp stroke: copies from (x + dx, y + dy) onto the dabs at `pts`."""

    dx: int = Field(ge=-100_000, le=100_000)
    dy: int = Field(ge=-100_000, le=100_000)
    r: float = Field(ge=1, le=4000)
    hardness: float = Field(default=0.5, ge=0, le=1)
    flow: float = Field(default=0.6, ge=0.01, le=1)
    pts: list[list[float]] = Field(min_length=1, max_length=4000)

    @field_validator("pts")
    @classmethod
    def _points(cls, value: list[list[float]]) -> list[list[float]]:
        for point in value:
            if len(point) != 2 or any(abs(c) > 1e6 for c in point):
                raise ValueError("each dab must be [x, y]")
        return value


class LocalAdjust(_Model):
    """Adjustments that apply only where a gradient says so (a graduated or radial filter)."""

    id: str
    name: str = Field(default="Local adjustment", max_length=64)
    visible: bool = True
    mask: LayerMask | None = None  # a gradient...
    paint: Paint | None = None  # ...or brush strokes (exactly one of the two)
    adjust: Adjust = Field(default_factory=Adjust)

    @field_validator("id")
    @classmethod
    def _id(cls, value: str) -> str:
        if not LAYER_ID.fullmatch(value):
            raise ValueError("an id is 6 to 32 lowercase letters and digits")
        return value

    @model_validator(mode="after")
    def _one_area(self) -> LocalAdjust:
        if (self.mask is None) == (self.paint is None):
            raise ValueError("a local adjustment needs either a gradient mask or brush strokes")
        return self


class EditState(_Model):
    geometry: list[GeoOp] = Field(default_factory=list, max_length=MAX_GEOMETRY_OPS)
    adjust: Adjust = Field(default_factory=Adjust)
    pixelart: PixelArt | None = None
    selection: Selection | None = None  # limits the adjustments to this area
    local: list[LocalAdjust] = Field(default_factory=list, max_length=MAX_LOCAL)
    clone: list[ClonePaint] = Field(default_factory=list, max_length=MAX_CLONE)
    # Bottom to top: layers[0] sits just above the edited picture.
    layers: list[Layer] = Field(default_factory=list, max_length=MAX_LAYERS)

    @field_validator("layers")
    @classmethod
    def _unique(cls, value: list[Layer]) -> list[Layer]:
        if len({layer.id for layer in value}) != len(value):
            raise ValueError("layer ids must be unique")
        return value

    @field_validator("clone")
    @classmethod
    def _clone_total(cls, value: list[ClonePaint]) -> list[ClonePaint]:
        if sum(len(s.pts) for s in value) > MAX_DABS:
            raise ValueError(f"clone strokes can hold at most {MAX_DABS} dabs")
        return value

    @field_validator("local")
    @classmethod
    def _unique_local(cls, value: list[LocalAdjust]) -> list[LocalAdjust]:
        if len({item.id for item in value}) != len(value):
            raise ValueError("local adjustment ids must be unique")
        return value
