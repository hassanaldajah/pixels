"""Steganography screening for the sanitised picture, plus an optional scrub of the low bits.

Everything that hides next to the pixels (chunks, comments, trailing bytes) is already gone after the
re-encode. What is left is data hidden in the pixel values themselves (LSB embedding). Two statistical
checks look for it on the clean 8-bit PNG:

    colour  Pairs-of-values chi-square (Westfeld & Pfitzmann). LSB embedding of random bits makes the counts of
            2k and 2k+1 equal. A prefix of the pixel stream is tested because tools fill the picture from the start.
            It only counts when the LSB plane also looks random (neighbours agree about half the time), which
            keeps smooth gradients and flat artwork from tripping it.
    alpha   Opaque-looking transparency whose top 7 bits are constant but whose lowest bit is random.

A hit is a notice ("looks like"), never a rejection: honest noisy photos can resemble it. The scrub replaces the
low bit with a fixed checkerboard (colour) or 1 (alpha), a change of at most 1/255 that destroys such a payload.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray
from PIL import Image

U8 = NDArray[np.uint8]
MAX_ANALYSED_PIXELS = 40_000_000
MIN_PAIRS = 60  # pairs with enough samples before the chi-square means anything
MIN_EXPECTED = 20.0
P_EMBEDDED = 0.5  # equalised pairs cannot be rejected above this p-value
P_FOLLOW = 0.1  # the next, longer prefix must still not reject equal pairs
P_SINGLE = 0.9  # the last scale has no follower, so it needs a much stronger result
RANDOM_BAND = 0.04  # neighbouring LSBs agree 50 % +- this when the plane is random


@dataclass
class StegoReport:
    checked: bool = False
    suspicious: bool = False
    findings: list[str] = field(default_factory=list)
    scrubbed: bool = False

    def to_json(self) -> dict[str, Any]:
        return {
            "checked": self.checked,
            "suspicious": self.suspicious,
            "findings": self.findings,
            "scrubbed": self.scrubbed,
        }


def _chi_square_p(values: U8) -> tuple[float, int]:
    """p-value that the counts of every 2k / 2k+1 pair are equal, and how many pairs were usable."""
    counts = np.bincount(values, minlength=256).astype(np.float64)
    even, odd = counts[0::2], counts[1::2]
    mean = (even + odd) / 2.0
    use = mean >= MIN_EXPECTED
    pairs = int(use.sum())
    if pairs < MIN_PAIRS:
        return 0.0, pairs
    stat = float((((even - mean)[use]) ** 2 / mean[use]).sum())
    return _chi2_sf(stat, pairs - 1), pairs


def _chi2_sf(x: float, k: int) -> float:
    """Survival function of the chi-square distribution (Wilson-Hilferty; accurate enough for k >= 30)."""
    if x <= 0:
        return 1.0
    z = ((x / k) ** (1.0 / 3.0) - (1.0 - 2.0 / (9.0 * k))) / math.sqrt(2.0 / (9.0 * k))
    return 0.5 * math.erfc(z / math.sqrt(2.0))


def _lsb_looks_random(values: U8) -> bool:
    lsb = values & 1
    if lsb.size < 1024:
        return False
    agree = float((lsb[1:] == lsb[:-1]).mean())
    ones = float(lsb.mean())
    return abs(agree - 0.5) < RANDOM_BAND and abs(ones - 0.5) < 0.1


def _colour_finding(rgb: U8) -> str | None:
    flat = rgb.reshape(-1)
    steps: list[tuple[int, float]] = []
    length = 1 << 18
    while True:
        prefix = flat[: min(length, flat.size)]
        p, pairs = _chi_square_p(prefix)
        steps.append((prefix.size, p if pairs >= MIN_PAIRS and _lsb_looks_random(prefix) else 0.0))
        if length >= flat.size:
            break
        length <<= 1
    # two scales in a row must agree (a lone high p-value happens by chance); a short picture has one scale
    for i, (size, p) in enumerate(steps):
        follow = steps[i + 1][1] if i + 1 < len(steps) else None
        confirmed = p > P_SINGLE if follow is None else p > P_EMBEDDED and follow > P_FOLLOW
        if confirmed:
            share = min(100, round(100 * size / flat.size))
            return (
                f"The lowest colour bits look random over the first {share}% of the picture "
                "(typical of LSB steganography)."
            )
    return None


def _alpha_finding(alpha: U8) -> str | None:
    flat = alpha.reshape(-1)
    if flat.size < 1024:
        return None
    high = flat >> 1
    top = np.bincount(high, minlength=128).max() / flat.size
    if top < 0.99 or flat.min() == flat.max():
        return None
    if _lsb_looks_random(flat):
        return "The transparency channel is almost opaque but its lowest bit looks random (possible hidden data)."
    return None


def analyse(png: Path) -> StegoReport:
    report = StegoReport()
    with Image.open(png) as img:
        if img.width * img.height > MAX_ANALYSED_PIXELS:
            report.findings.append(
                "Picture is too large for the hidden-data screen; it was skipped."
            )
            return report
        mode = img.mode
        pixels = np.asarray(img.convert("RGBA" if "A" in mode else "RGB"))
    report.checked = True
    finding = _colour_finding(np.ascontiguousarray(pixels[..., :3]))
    if finding:
        report.findings.append(finding)
    if pixels.shape[2] == 4:
        finding = _alpha_finding(np.ascontiguousarray(pixels[..., 3]))
        if finding:
            report.findings.append(finding)
    report.suspicious = bool(report.findings)
    return report


def scrub(png: Path) -> None:
    """Replace the lowest bits in place. Colour: checkerboard (unbiased). Alpha: 1 unless fully transparent."""
    with Image.open(png) as img:
        rgba = img.mode == "RGBA"
        pixels = np.array(img.convert("RGBA" if rgba else "RGB"))
    h, w = pixels.shape[:2]
    board = ((np.arange(h)[:, None] + np.arange(w)[None, :]) & 1).astype(np.uint8)
    colour = pixels[..., :3]
    colour &= 0xFE
    colour |= board[..., None]
    if rgba:
        alpha = pixels[..., 3]
        alpha[alpha >= 2] |= 1
    Image.fromarray(pixels).save(png, format="PNG", optimize=False)
