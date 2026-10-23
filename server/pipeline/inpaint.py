"""The eraser: remove an object and fill the gap from the picture around it. No AI model.

This is exemplar-based inpainting (the PatchMatch + voting method of Wexler/Barnes, coarse to fine):

 1. the painted area is grown a little (shadows and fringes), and only a padded window around it is used;
 2. the window is shrunk into a pyramid; the smallest level is filled by diffusion (a smooth guess);
 3. at each level every gap pixel looks for the most similar patch of *real* pixels elsewhere in the
    window (PatchMatch: propagation + random search), then takes the average of the patches that
    cover it (voting). This repeats a few times per level, then the result is enlarged to the next level;
 4. the finished gap is blended back with a soft edge, so there is no visible seam.

It copies real texture, so grass, sky, walls, water, sand, wood and similar surroundings come out
convincing. It cannot invent things that appear nowhere nearby (a hidden face, a missing building).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from pipeline.errors import PublicError

F32 = np.float32
Array = NDArray[np.float32]
Bool = NDArray[np.bool_]
Int = NDArray[np.int64]


@dataclass(frozen=True)
class Quality:
    patch: int  # patch edge in pixels (odd)
    work_edge: int  # the window is shrunk to this long edge before filling
    iterations: tuple[int, ...]  # EM iterations from the coarsest level to the finest
    sample_step: int  # use every n-th patch pixel when comparing (speed)


QUALITY = {
    "fast": Quality(patch=5, work_edge=384, iterations=(5, 3, 2, 1), sample_step=1),
    "high": Quality(patch=7, work_edge=640, iterations=(10, 8, 7, 6, 6), sample_step=1),
}
MIN_COARSE_EDGE = 40
RANDOM_CANDIDATES = 4
GUESS_WEIGHT = 0.25  # how much a not-yet-known (guessed) pixel counts when judging a patch
SEED = 1234


# --- small helpers --------------------------------------------------------------------------------
def dilate(mask: Bool, radius: int) -> Bool:
    """Square dilation by `radius` pixels (separable running maximum via cumulative sums)."""
    if radius <= 0:
        return mask
    out = mask
    for axis in (0, 1):
        n = out.shape[axis]
        padded = np.pad(
            out.astype(np.int32), [(radius, radius) if a == axis else (0, 0) for a in (0, 1)]
        )
        csum = np.cumsum(padded, axis=axis)
        zero = np.zeros_like(np.take(csum, [0], axis=axis))
        csum = np.concatenate([zero, csum], axis=axis)
        hi = np.take(csum, range(2 * radius + 1, 2 * radius + 1 + n), axis=axis)
        lo = np.take(csum, range(0, n), axis=axis)
        out = (hi - lo) > 0
    return out


def blur(a: Array, sigma: float) -> Array:
    """Separable Gaussian blur of a 2-D float array (edges repeat)."""
    if sigma <= 0.05:
        return a
    radius = max(1, math.ceil(3 * sigma))
    k = np.exp(-(np.arange(-radius, radius + 1) ** 2) / (2 * sigma * sigma))
    k = (k / k.sum()).astype(F32)
    p = np.pad(a, ((0, 0), (radius, radius)), mode="edge")
    h = sum(k[i] * p[:, i : i + a.shape[1]] for i in range(len(k)))
    p = np.pad(h, ((radius, radius), (0, 0)), mode="edge")
    return np.asarray(sum(k[i] * p[i : i + a.shape[0]] for i in range(len(k))), dtype=F32)


def resize(a: Array, w: int, h: int) -> Array:
    """Lanczos resize of an (H, W, C) float array, channel by channel."""
    from PIL import Image

    channels = [
        np.asarray(
            Image.fromarray(np.ascontiguousarray(a[..., c]), "F").resize(
                (w, h), Image.Resampling.LANCZOS
            )
        )
        for c in range(a.shape[2])
    ]
    return np.stack(channels, axis=-1).astype(F32)


def downsample(img: Array, hole: Bool) -> tuple[Array, Bool]:
    """Halve a picture; the average ignores gap pixels, and a coarse pixel is a gap only if all four were."""
    h, w = hole.shape
    h2, w2 = h // 2, w // 2
    known = (~hole[: h2 * 2, : w2 * 2]).astype(F32)
    cut = img[: h2 * 2, : w2 * 2] * known[..., None]
    sums = cut.reshape(h2, 2, w2, 2, -1).sum(axis=(1, 3))
    weight = known.reshape(h2, 2, w2, 2).sum(axis=(1, 3))
    out = np.where(weight[..., None] > 0, sums / np.maximum(weight[..., None], F32(1)), F32(0))
    return out.astype(F32), weight == 0


def diffuse(img: Array, hole: Bool, iterations: int = 400) -> Array:
    """Fill the gap with a smooth guess by repeatedly averaging neighbours (Jacobi iteration)."""
    out = img.copy()
    if hole.any() and (~hole).any():
        out[hole] = img[~hole].mean(axis=0)
    for _ in range(iterations):
        p = np.pad(out, ((1, 1), (1, 1), (0, 0)), mode="edge")
        avg = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) * F32(0.25)
        out[hole] = avg[hole]
    return out


# --- PatchMatch -----------------------------------------------------------------------------------
class _Level:
    """One pyramid level: the picture, the gap, the usable source patches and the offset field."""

    def __init__(
        self, img: Array, hole: Bool, patch: int, step: int, rng: np.random.Generator
    ) -> None:
        self.img = img
        self.hole = hole
        self.h, self.w = hole.shape
        self.r = patch // 2
        self.rng = rng
        r = self.r
        offsets = [(dy, dx) for dy in range(-r, r + 1) for dx in range(-r, r + 1)]
        self.all_offsets = offsets
        self.cmp_offsets = [
            (dy, dx) for dy, dx in offsets if dy % step == 0 and dx % step == 0
        ] or offsets
        # target pixels: every pixel whose patch touches the gap
        target = dilate(hole, r)
        self.py, self.px = np.nonzero(target)
        self.n = len(self.py)
        self.index = np.full((self.h, self.w), -1, dtype=np.int64)
        self.index[self.py, self.px] = np.arange(self.n)
        # source centres: patches that lie wholly inside the picture and touch no gap pixel
        valid = ~target
        valid[:r] = valid[-r:] = False
        valid[:, :r] = valid[:, -r:] = False
        self.valid = valid
        # known pixels count fully; guessed ones less, so the real surroundings decide which patch is best
        self.weight = np.where(hole, F32(GUESS_WEIGHT), F32(1.0)).astype(F32)
        self.sy, self.sx = np.nonzero(valid)
        self.off = np.zeros((self.n, 2), dtype=np.int64)  # source centre minus target centre
        self.cost = np.full(self.n, np.inf, dtype=F32)

    @property
    def usable(self) -> bool:
        return self.n > 0 and len(self.sy) > 0

    def _cost(self, idx: Int, cy: Int, cx: Int) -> Array:
        """Patch distance between targets `idx` and candidate source centres (cy, cx); invalid -> inf."""
        py, px = self.py[idx], self.px[idx]
        ok = (cy >= 0) & (cy < self.h) & (cx >= 0) & (cx < self.w)
        cy_c, cx_c = np.clip(cy, 0, self.h - 1), np.clip(cx, 0, self.w - 1)
        ok &= self.valid[cy_c, cx_c]
        total = np.zeros(len(idx), dtype=F32)
        for dy, dx in self.cmp_offsets:
            ty, tx = np.clip(py + dy, 0, self.h - 1), np.clip(px + dx, 0, self.w - 1)
            a = self.img[ty, tx]
            b = self.img[np.clip(cy_c + dy, 0, self.h - 1), np.clip(cx_c + dx, 0, self.w - 1)]
            total += ((a - b) ** 2).sum(axis=-1) * self.weight[ty, tx]
        total[~ok] = np.inf
        return total

    def _try(self, idx: Int, cy: Int, cx: Int) -> None:
        cost = self._cost(idx, cy, cx)
        better = cost < self.cost[idx]
        if better.any():
            sel = idx[better]
            self.cost[sel] = cost[better]
            self.off[sel, 0] = (cy - self.py[idx])[better]
            self.off[sel, 1] = (cx - self.px[idx])[better]

    def init_random(self) -> None:
        pick = self.rng.integers(0, len(self.sy), self.n)
        self.off[:, 0] = self.sy[pick] - self.py
        self.off[:, 1] = self.sx[pick] - self.px
        self.cost = self._cost(np.arange(self.n), self.sy[pick], self.sx[pick])

    def init_from(self, coarse: _Level) -> None:
        """Start from the coarser level's offsets, doubled."""
        cy = np.minimum(self.py // 2, coarse.h - 1)
        cx = np.minimum(self.px // 2, coarse.w - 1)
        ci = coarse.index[cy, cx]
        have = ci >= 0
        self.init_random()
        if have.any():
            idx = np.nonzero(have)[0]
            off = coarse.off[ci[idx]] * 2
            self._try(idx, self.py[idx] + off[:, 0], self.px[idx] + off[:, 1])

    def search(self, iterations: int) -> None:
        all_idx = np.arange(self.n)
        for it in range(iterations):
            # propagation: borrow the offsets of the four neighbours
            for dy, dx in (
                ((0, 1), (1, 0), (0, -1), (-1, 0))
                if it % 2 == 0
                else ((0, -1), (-1, 0), (0, 1), (1, 0))
            ):
                ny, nx = np.clip(self.py + dy, 0, self.h - 1), np.clip(self.px + dx, 0, self.w - 1)
                ni = self.index[ny, nx]
                have = ni >= 0
                if not have.any():
                    continue
                idx = all_idx[have]
                off = self.off[ni[have]]
                self._try(idx, self.py[idx] + off[:, 0], self.px[idx] + off[:, 1])
            # random search around the current best, with a shrinking radius
            radius = max(self.h, self.w)
            for _ in range(RANDOM_CANDIDATES):
                radius = max(2, radius // 2)
                jy = self.rng.integers(-radius, radius + 1, self.n)
                jx = self.rng.integers(-radius, radius + 1, self.n)
                self._try(all_idx, self.py + self.off[:, 0] + jy, self.px + self.off[:, 1] + jx)

    def vote(self) -> None:
        """Replace each gap pixel by the average of every patch that covers it."""
        h, w = self.h, self.w
        channels = self.img.shape[2]
        acc = np.zeros((channels, h * w), dtype=np.float64)
        cnt = np.zeros(h * w, dtype=np.float64)
        sy, sx = self.py + self.off[:, 0], self.px + self.off[:, 1]
        weight = np.exp(
            -np.minimum(self.cost, F32(1e4))
            / F32(max(1e-3, float(np.median(self.cost[np.isfinite(self.cost)])) * 2 + 1e-3))
        )
        for dy, dx in self.all_offsets:
            ty, tx = self.py + dy, self.px + dx
            inside = (ty >= 0) & (ty < h) & (tx >= 0) & (tx < w)
            ty_c, tx_c = np.clip(ty, 0, h - 1), np.clip(tx, 0, w - 1)
            keep = inside & self.hole[ty_c, tx_c]
            if not keep.any():
                continue
            flat = (ty_c * w + tx_c)[keep]
            vals = self.img[np.clip(sy + dy, 0, h - 1), np.clip(sx + dx, 0, w - 1)][keep]
            wk = weight[keep]
            cnt += np.bincount(flat, weights=wk, minlength=h * w)
            for c in range(channels):
                acc[c] += np.bincount(flat, weights=vals[:, c] * wk, minlength=h * w)
        cnt2 = cnt.reshape(h, w)
        done = self.hole & (cnt2 > 0)
        for c in range(channels):
            plane = self.img[..., c]
            plane[done] = (acc[c].reshape(h, w)[done] / cnt2[done]).astype(F32)


def _fill_window(img: Array, hole: Bool, quality: Quality, rng: np.random.Generator) -> Array:
    """Fill the gap of a small window (<= work_edge) with PatchMatch, coarse to fine."""
    levels: list[tuple[Array, Bool]] = [(img.copy(), hole)]
    while min(levels[-1][1].shape) >= 2 * MIN_COARSE_EDGE and len(levels) < len(quality.iterations):
        levels.append(downsample(*levels[-1]))
    levels.reverse()  # coarsest first
    result: Array | None = None
    coarse: _Level | None = None
    for number, (level_img, level_hole) in enumerate(levels):
        iters = quality.iterations[min(number, len(quality.iterations) - 1)]
        work = level_img.copy()
        if result is None:
            work = diffuse(work, level_hole)
        else:
            up = resize(result, level_hole.shape[1], level_hole.shape[0])
            work[level_hole] = up[level_hole]
        level = _Level(work, level_hole, quality.patch, quality.sample_step, rng)
        if level.usable:
            if coarse is None:
                level.init_random()
            else:
                level.init_from(coarse)
            for _ in range(iters):
                level.search(1)
                level.vote()
            coarse = level
        else:
            coarse = None
        result = work
    assert result is not None
    return result


# --- public ----------------------------------------------------------------------------------------
@dataclass(frozen=True)
class EraseOptions:
    quality: str = "high"
    grow: int = 6  # extra pixels around the painted area (shadows, anti-aliased edges)
    feather: float = 3.0  # softness of the seam, in pixels


def erase(image: Array, mask: Bool, options: EraseOptions | None = None) -> Array:
    """Return `image` (H, W, 4 float32, straight alpha) with the masked area removed and filled."""
    options = options or EraseOptions()
    if image.shape[:2] != mask.shape:
        raise PublicError("The mask must have the same size as the picture.")
    if not mask.any():
        return image
    spec = QUALITY.get(options.quality)
    if spec is None:
        raise PublicError("quality must be 'fast' or 'high'")
    h, w = mask.shape
    grown = dilate(mask, max(0, options.grow))
    ys, xs = np.nonzero(grown)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
    pad = max(48, int(0.8 * max(y1 - y0, x1 - x0)))
    y0, y1, x0, x1 = max(0, y0 - pad), min(h, y1 + pad), max(0, x0 - pad), min(w, x1 + pad)
    crop = image[y0:y1, x0:x1].copy()
    hole = grown[y0:y1, x0:x1]
    if hole.all():
        raise PublicError(
            "The painted area covers the whole picture: there is nothing to copy from."
        )
    ch, cw = hole.shape
    scale = min(1.0, spec.work_edge / max(ch, cw))
    if scale < 1.0:
        sw, sh = max(8, round(cw * scale)), max(8, round(ch * scale))
        small = resize(crop, sw, sh)
        small_hole = resize(hole[..., None].astype(F32), sw, sh)[..., 0] > 0.25
        small_hole = dilate(small_hole, 1)
    else:
        small, small_hole = crop, hole
    # premultiply, so transparent pixels do not bleed their (meaningless) colour into the gap
    work = small.copy()
    work[..., :3] *= work[..., 3:4]
    rng = np.random.default_rng(SEED)
    filled = _fill_window(work, small_hole, spec, rng)
    a = np.clip(filled[..., 3:4], 0, 1)
    filled[..., :3] = np.where(a > 1e-4, filled[..., :3] / np.maximum(a, F32(1e-4)), F32(0))
    filled = np.clip(filled, 0, 1)
    if scale < 1.0:
        filled = np.clip(resize(filled, cw, ch), 0, 1)
    soft = blur(dilate(hole, max(1, round(options.feather))).astype(F32), max(0.1, options.feather))
    alpha = np.where(hole, F32(1), soft)[..., None]
    out = image.copy()
    out[y0:y1, x0:x1] = crop * (1 - alpha) + filled * alpha
    return out.astype(F32)


def unpack_mask(packed: bytes, width: int, height: int) -> Bool:
    """A mask sent as packed bits (row-major, 1 = erase). No image codec is involved."""
    expected = (width * height + 7) // 8
    if len(packed) != expected:
        raise PublicError(
            f"The mask has {len(packed)} bytes; {expected} were expected for {width} x {height}."
        )
    bits = np.unpackbits(np.frombuffer(packed, dtype=np.uint8))[: width * height]
    return np.asarray(bits.reshape(height, width), dtype=np.bool_)


def fit_mask(mask: Bool, width: int, height: int) -> Bool:
    """Stretch a mask drawn at a lower resolution to the picture's size (nearest neighbour)."""
    if mask.shape == (height, width):
        return mask
    ys = np.minimum((np.arange(height) * mask.shape[0]) // height, mask.shape[0] - 1)
    xs = np.minimum((np.arange(width) * mask.shape[1]) // width, mask.shape[1] - 1)
    return mask[np.ix_(ys, xs)]
