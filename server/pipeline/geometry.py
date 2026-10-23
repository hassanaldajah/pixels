"""Geometry ops: rotate, flip, crop, straighten, skew, perspective and canvas resize.

Coordinates are continuous: pixel (i, j) covers [i, i+1) x [j, j+1), its centre is (i+.5, j+.5),
the origin is the top-left corner and y points down. Every op is a 3x3 forward matrix from the
current image to the new one, plus a new size. Pixels are produced by inverse mapping with
premultiplied bilinear sampling and a one-pixel anti-aliased edge; the WebGL engine does the
same, so preview and export agree. Rotations by multiples of 90 degrees, flips, crops and integer
canvas shifts are exact copies.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from PIL import Image

from pipeline.errors import PublicError
from pipeline.ops import (
    Canvas,
    Crop,
    Flip,
    GeoOp,
    Perspective,
    Resize,
    Rotate,
    Rotate90,
    Skew,
    Straighten,
)

F32 = np.float32
Array = NDArray[np.float32]
Matrix = NDArray[np.float64]
CHUNK_PIXELS = 1_500_000


class GeometryError(PublicError):
    """The ops cannot be applied (degenerate quad, output too large, ...)."""


@dataclass(frozen=True)
class Step:
    op: GeoOp
    matrix: Matrix  # forward: current image -> new image
    out_w: int
    out_h: int
    fill: tuple[float, float, float, float]  # RGBA for pixels outside the source


def _translate(tx: float, ty: float) -> Matrix:
    return np.array([[1.0, 0.0, tx], [0.0, 1.0, ty], [0.0, 0.0, 1.0]])


def _rotation(radians: float) -> Matrix:
    c, s = math.cos(radians), math.sin(radians)
    return np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])


def _ceil(value: float) -> int:
    return max(1, math.ceil(round(value, 6)))


def homography(src: list[tuple[float, float]], dst: list[tuple[float, float]]) -> Matrix:
    """The 3x3 matrix taking four source points to four destination points."""
    rows, rhs = [], []
    for (x, y), (u, v) in zip(src, dst, strict=True):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        rhs.extend([u, v])
    try:
        h = np.linalg.solve(np.array(rows, dtype=np.float64), np.array(rhs, dtype=np.float64))
    except np.linalg.LinAlgError as exc:
        raise GeometryError(
            "The perspective corners are degenerate (three of them in a line)."
        ) from exc
    return np.append(h, 1.0).reshape(3, 3)


def inscribed_scale(w: int, h: int, radians: float) -> float:
    """Largest s so that a rectangle of size (w*s, h*s), centred, fits inside the rotated image."""
    c, s = abs(math.cos(radians)), abs(math.sin(radians))
    return min(w / (w * c + h * s), h / (w * s + h * c))


def plan_step(op: GeoOp, w: int, h: int) -> Step:
    transparent = (0.0, 0.0, 0.0, 0.0)
    if isinstance(op, Rotate90):
        mats = {
            1: np.array([[0.0, -1.0, h], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]]),
            2: np.array([[-1.0, 0.0, w], [0.0, -1.0, h], [0.0, 0.0, 1.0]]),
            3: np.array([[0.0, 1.0, 0.0], [-1.0, 0.0, w], [0.0, 0.0, 1.0]]),
        }
        ow, oh = (h, w) if op.turns % 2 else (w, h)
        return Step(op, mats[op.turns], ow, oh, transparent)
    if isinstance(op, Flip):
        m = np.array([[-1.0, 0.0, w], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
        if op.axis == "v":
            m = np.array([[1.0, 0.0, 0.0], [0.0, -1.0, h], [0.0, 0.0, 1.0]])
        return Step(op, m, w, h, transparent)
    if isinstance(op, Rotate):
        a = math.radians(op.angle)
        if op.expand:
            ow = _ceil(abs(w * math.cos(a)) + abs(h * math.sin(a)))
            oh = _ceil(abs(w * math.sin(a)) + abs(h * math.cos(a)))
        else:
            ow, oh = w, h
        m = _translate(ow / 2, oh / 2) @ _rotation(a) @ _translate(-w / 2, -h / 2)
        return Step(op, m, ow, oh, transparent)
    if isinstance(op, Straighten):
        a = math.radians(op.angle)
        s = inscribed_scale(w, h, a)
        ow, oh = max(1, math.floor(round(w * s, 6))), max(1, math.floor(round(h * s, 6)))
        m = _translate(ow / 2, oh / 2) @ _rotation(a) @ _translate(-w / 2, -h / 2)
        return Step(op, m, ow, oh, transparent)
    if isinstance(op, Crop):
        x0, y0 = min(op.x, w - 1), min(op.y, h - 1)
        cw, ch = min(op.w, w - x0), min(op.h, h - y0)
        crop = Crop(type="crop", x=x0, y=y0, w=cw, h=ch)
        return Step(crop, _translate(-x0, -y0), cw, ch, transparent)
    if isinstance(op, Skew):
        sx = np.array([[1.0, math.tan(math.radians(op.x)), 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
        sy = np.array([[1.0, 0.0, 0.0], [math.tan(math.radians(op.y)), 1.0, 0.0], [0.0, 0.0, 1.0]])
        m = _translate(w / 2, h / 2) @ sy @ sx @ _translate(-w / 2, -h / 2)
        return Step(op, m, w, h, transparent)
    if isinstance(op, Perspective):
        src = [(0.0, 0.0), (float(w), 0.0), (float(w), float(h)), (0.0, float(h))]
        return Step(op, homography(src, [(p[0], p[1]) for p in op.quad]), w, h, transparent)
    if isinstance(op, Resize):
        scale_x, scale_y = op.w / w, op.h / h
        return Step(
            op,
            np.array([[scale_x, 0.0, 0.0], [0.0, scale_y, 0.0], [0.0, 0.0, 1.0]]),
            op.w,
            op.h,
            transparent,
        )
    if isinstance(op, Canvas):
        fx = {"l": 0.0, "c": 0.5, "r": 1.0}[_col(op.anchor)]
        fy = {"t": 0.0, "m": 0.5, "b": 1.0}[_row(op.anchor)]
        dx, dy = math.floor((op.w - w) * fx), math.floor((op.h - h) * fy)
        fill = transparent
        if op.fill:
            fill = (
                int(op.fill[1:3], 16) / 255,
                int(op.fill[3:5], 16) / 255,
                int(op.fill[5:7], 16) / 255,
                1.0,
            )
        return Step(op, _translate(dx, dy), op.w, op.h, fill)
    raise GeometryError(f"Unknown op {op!r}")


def _col(anchor: str) -> str:
    return {
        "tl": "l",
        "ml": "l",
        "bl": "l",
        "tc": "c",
        "c": "c",
        "bc": "c",
        "tr": "r",
        "mr": "r",
        "br": "r",
    }[anchor]


def _row(anchor: str) -> str:
    return {
        "tl": "t",
        "tc": "t",
        "tr": "t",
        "ml": "m",
        "c": "m",
        "mr": "m",
        "bl": "b",
        "bc": "b",
        "br": "b",
    }[anchor]


def plan(ops: list[GeoOp], w: int, h: int, max_pixels: int) -> list[Step]:
    steps: list[Step] = []
    for op in ops:
        step = plan_step(op, w, h)
        if step.out_w * step.out_h > max_pixels:
            raise GeometryError(
                f"The result would be {step.out_w:,} x {step.out_h:,} px, above the {max_pixels / 1e6:,.0f} MP limit."
            )
        steps.append(step)
        w, h = step.out_w, step.out_h
    return steps


def output_size(ops: list[GeoOp], w: int, h: int, max_pixels: int = 10**12) -> tuple[int, int]:
    steps = plan(ops, w, h, max_pixels)
    return (steps[-1].out_w, steps[-1].out_h) if steps else (w, h)


# --- pixel work --------------------------------------------------------------------------------
def _exact(step: Step, image: Array) -> Array | None:
    """Copies that need no resampling."""
    op = step.op
    if isinstance(op, Rotate90):
        return np.ascontiguousarray(np.rot90(image, k=-op.turns))
    if isinstance(op, Flip):
        return np.ascontiguousarray(image[:, ::-1] if op.axis == "h" else image[::-1])
    if isinstance(op, Crop):
        return np.ascontiguousarray(image[op.y : op.y + op.h, op.x : op.x + op.w])
    if isinstance(op, Resize):
        return _resize(image, op.w, op.h)
    if isinstance(op, Canvas):
        dx, dy = int(step.matrix[0, 2]), int(step.matrix[1, 2])
        out = np.empty((step.out_h, step.out_w, 4), dtype=F32)
        out[:] = F32(0.0)
        if step.fill[3] > 0:
            out[:] = np.array(step.fill, dtype=F32)
        h, w = image.shape[:2]
        x0, y0 = max(dx, 0), max(dy, 0)
        x1, y1 = min(dx + w, step.out_w), min(dy + h, step.out_h)
        if x1 > x0 and y1 > y0:
            out[y0:y1, x0:x1] = image[y0 - dy : y1 - dy, x0 - dx : x1 - dx]
        return out
    return None


def _resize(image: Array, new_w: int, new_h: int) -> Array:
    """Lanczos resampling of premultiplied colour, per float channel, so large reductions stay clean."""
    h, w = image.shape[:2]
    if (w, h) == (new_w, new_h):
        return image
    alpha = image[..., 3]
    planes = [image[..., c] * alpha for c in range(3)] + [alpha]
    resized = [
        np.asarray(
            Image.fromarray(np.ascontiguousarray(p), "F").resize(
                (new_w, new_h), Image.Resampling.LANCZOS
            )
        )
        for p in planes
    ]
    out = np.empty((new_h, new_w, 4), dtype=F32)
    a = np.clip(resized[3], 0.0, 1.0)
    safe = np.maximum(a, F32(1e-6))
    for c in range(3):
        out[..., c] = np.where(a > F32(1e-6), np.clip(resized[c] / safe, 0.0, 1.0), F32(0.0))
    out[..., 3] = a
    return out


def _sample(image: Array, inverse: Matrix, step: Step) -> Array:
    h, w = image.shape[:2]
    ow, oh = step.out_w, step.out_h
    out = np.empty((oh, ow, 4), dtype=F32)
    fill = np.array(step.fill, dtype=F32)
    rows_per_chunk = max(1, CHUNK_PIXELS // ow)
    xs = np.arange(ow, dtype=np.float64) + 0.5
    for y_start in range(0, oh, rows_per_chunk):
        y_end = min(oh, y_start + rows_per_chunk)
        ys = np.arange(y_start, y_end, dtype=np.float64) + 0.5
        gx, gy = np.meshgrid(xs, ys)
        denom = inverse[2, 0] * gx + inverse[2, 1] * gy + inverse[2, 2]
        valid = denom > 1e-12
        safe = np.where(valid, denom, 1.0)
        px = (inverse[0, 0] * gx + inverse[0, 1] * gy + inverse[0, 2]) / safe
        py = (inverse[1, 0] * gx + inverse[1, 1] * gy + inverse[1, 2]) / safe

        fx, fy = px - 0.5, py - 0.5
        x0, y0 = np.floor(fx), np.floor(fy)
        tx, ty = (fx - x0).astype(F32), (fy - y0).astype(F32)
        x0i = np.clip(x0.astype(np.int64), 0, w - 1)
        y0i = np.clip(y0.astype(np.int64), 0, h - 1)
        x1i = np.clip(x0.astype(np.int64) + 1, 0, w - 1)
        y1i = np.clip(y0.astype(np.int64) + 1, 0, h - 1)

        def pm(yy: NDArray[np.int64], xx: NDArray[np.int64]) -> Array:
            texel = image[yy, xx]
            return np.concatenate([texel[..., :3] * texel[..., 3:4], texel[..., 3:4]], axis=-1)

        w00 = ((F32(1) - tx) * (F32(1) - ty))[..., None]
        w10 = (tx * (F32(1) - ty))[..., None]
        w01 = ((F32(1) - tx) * ty)[..., None]
        w11 = (tx * ty)[..., None]
        acc = pm(y0i, x0i) * w00 + pm(y0i, x1i) * w10 + pm(y1i, x0i) * w01 + pm(y1i, x1i) * w11
        alpha = acc[..., 3:4]
        rgb = np.where(alpha > F32(1e-6), acc[..., :3] / np.maximum(alpha, F32(1e-6)), F32(0.0))

        inside = np.minimum(np.minimum(px, w - px), np.minimum(py, h - py))
        coverage = np.where(valid, np.clip(inside + 0.5, 0.0, 1.0), 0.0).astype(F32)[..., None]
        fa = fill[3]
        out_a = coverage * alpha + (F32(1) - coverage) * fa
        out_pm = coverage * alpha * rgb + (F32(1) - coverage) * fa * fill[:3]
        out_rgb = np.where(out_a > F32(1e-6), out_pm / np.maximum(out_a, F32(1e-6)), F32(0.0))
        out[y_start:y_end, :, :3] = out_rgb
        out[y_start:y_end, :, 3:4] = out_a
    return out


def apply(image: Array, ops: list[GeoOp], max_pixels: int) -> Array:
    """Apply geometry ops, in order, to an (H, W, 4) float32 image."""
    h, w = image.shape[:2]
    for step in plan(ops, w, h, max_pixels):
        exact = _exact(step, image)
        if exact is not None:
            image = exact
            continue
        try:
            inverse = np.linalg.inv(step.matrix)
        except np.linalg.LinAlgError as exc:
            raise GeometryError("That transform cannot be undone (it flattens the image).") from exc
        image = _sample(image, np.asarray(inverse, dtype=np.float64), step)
    return image
