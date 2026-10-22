"""Clone stamp: paint with pixels copied from another place in the picture.

Each stroke copies from the picture as it was before any clone (the geometry result), shifted by an integer
(dx, dy): destination pixel (x, y) takes the colour of (x + dx, y + dy), clamped at the edges. Where the brush
is opaque (the same soft dabs as pipeline/paint.py) the copy replaces what is there; strokes apply in order.
Because every dab of a stroke copies from the same source, the dabs fold into one mask per stroke:
    result = mix(result, shifted, mask).
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from pipeline import paint
from pipeline.ops import ClonePaint, Paint, Stroke

Array = NDArray[np.float32]
F32 = np.float32


def shifted(image: Array, dx: int, dy: int) -> Array:
    """out[y, x] = image[clamp(y + dy), clamp(x + dx)]."""
    h, w = image.shape[:2]
    ys = np.clip(np.arange(h) + dy, 0, h - 1)
    xs = np.clip(np.arange(w) + dx, 0, w - 1)
    return image[ys][:, xs]


def apply(image: Array, strokes: list[ClonePaint]) -> Array:
    if not strokes:
        return image
    h, w = image.shape[:2]
    result = image.copy()
    for s in strokes:
        single = Paint(
            strokes=[Stroke(r=s.r, hardness=s.hardness, flow=s.flow, erase=False, pts=s.pts)]
        )
        m = paint.mask(single, w, h)
        copy = shifted(image, s.dx, s.dy)
        result = np.asarray(result + (copy - result) * m, dtype=F32)
    return result
