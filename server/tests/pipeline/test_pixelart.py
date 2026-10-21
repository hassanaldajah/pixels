from __future__ import annotations

import numpy as np
import pytest

from pipeline import pixelart
from pipeline.ops import EditState, PixelArt
from pipeline.render import render

from .helpers import gradient

F32 = np.float32


def art(**values) -> PixelArt:  # type: ignore[no-untyped-def]
    return PixelArt.model_validate(values)


def run(image, **values):  # type: ignore[no-untyped-def]
    return pixelart.apply(image, art(**values))


def unique_colours(rgba: np.ndarray) -> np.ndarray:
    return np.unique(np.round(rgba[..., :3].reshape(-1, 3), 4), axis=0)


def test_output_is_a_true_pixel_grid() -> None:
    out, info = run(gradient(48, 64), pixel_size=8, colors=6, smooth=0)
    assert out.shape == (48, 64, 4)
    # every 8x8 block is one flat colour
    blocks = out[:48, :64].reshape(6, 8, 8, 8, 4)
    assert (blocks == blocks[:, :1, :, :1]).all()
    assert info["grid"] == [8, 6]


def test_palette_size_is_respected() -> None:
    out, info = run(gradient(64, 64), pixel_size=4, colors=5, smooth=0)
    assert len(unique_colours(out)) <= 5
    assert info["colors"] <= 5


@pytest.mark.parametrize("name", ["gameboy", "pico8", "nes", "c64", "cga", "endesga32"])
def test_fixed_palettes_only_use_their_own_colours(name: str) -> None:
    out, _ = run(gradient(40, 40), pixel_size=4, palette=name, smooth=0)
    allowed = {tuple(np.round(c, 4)) for c in pixelart.palette_array(pixelart.PALETTES[name])}
    used = {tuple(np.round(c, 4)) for c in unique_colours(out)}
    assert used <= allowed


def test_palette_sizes_match_the_classic_systems() -> None:
    sizes = {k: len(v) for k, v in pixelart.PALETTES.items()}
    assert (
        sizes["gameboy"] == 4
        and sizes["pico8"] == 16
        and sizes["c64"] == 16
        and sizes["endesga32"] == 32
        and sizes["cga"] == 4
    )
    assert 50 <= sizes["nes"] <= 56


def test_custom_palette_and_validation() -> None:
    out, _ = run(
        gradient(32, 32),
        pixel_size=4,
        palette="custom",
        custom_palette=["#000000", "#ffffff"],
        smooth=0,
    )
    assert len(unique_colours(out)) <= 2
    with pytest.raises(ValueError):
        run(gradient(8, 8), palette="custom")
    for bad in (
        {"pixel_size": 1},
        {"pixel_size": 40},
        {"colors": 1},
        {"custom_palette": ["red"]},
        {"outline_color": "x"},
        {"dither": "magic"},
    ):
        with pytest.raises(ValueError):
            art(**bad)


def test_ordered_dither_changes_the_result_but_keeps_the_palette() -> None:
    img = gradient(64, 64)
    flat, _ = run(img, pixel_size=2, palette="gameboy", dither="none", smooth=0)
    dithered, _ = run(
        img, pixel_size=2, palette="gameboy", dither="bayer4", dither_strength=1, smooth=0
    )
    assert not np.array_equal(flat, dithered)
    allowed = {tuple(np.round(c, 4)) for c in pixelart.palette_array(pixelart.PALETTES["gameboy"])}
    assert {tuple(np.round(c, 4)) for c in unique_colours(dithered)} <= allowed


@pytest.mark.parametrize("mode", ["floyd", "atkinson"])
def test_error_diffusion_preserves_average_brightness(mode: str) -> None:
    grey = np.full((48, 48, 4), 0.5, dtype=F32)
    out, _ = run(
        grey,
        pixel_size=2,
        palette="custom",
        custom_palette=["#000000", "#ffffff"],
        dither=mode,
        dither_strength=1,
        smooth=0,
    )
    assert abs(float(out[..., 0].mean()) - 0.5) < 0.12
    assert len(unique_colours(out)) == 2


def test_kmeans_is_deterministic() -> None:
    img = gradient(64, 64)
    a, _ = run(img, pixel_size=4, colors=8)
    b, _ = run(img, pixel_size=4, colors=8)
    assert np.array_equal(a, b)


def test_transparency_stays_crisp() -> None:
    img = gradient(40, 40)
    img[:, 20:, 3] = 0.0
    out, _ = run(img, pixel_size=5, colors=4, smooth=0)
    assert set(np.unique(out[..., 3])) == {0.0, 1.0}
    assert (out[:, 25:, 3] == 0).all() and (out[:, :15, 3] == 1).all()


def test_outline_marks_the_border_of_a_sprite() -> None:
    img = np.zeros((40, 40, 4), dtype=F32)
    img[10:30, 10:30] = (0.9, 0.7, 0.2, 1.0)
    out, _ = run(img, pixel_size=5, colors=2, smooth=0, outline=True, outline_color="#ff0000")
    assert tuple(np.round(out[10, 10, :3], 2)) == (1.0, 0.0, 0.0)  # border cell
    assert tuple(np.round(out[20, 20, :3], 2)) != (1.0, 0.0, 0.0)  # interior untouched


def test_scale_modes() -> None:
    img = gradient(40, 60)
    native, _ = run(img, pixel_size=10, scale=1)
    assert native.shape == (4, 6, 4)
    big, _ = run(img, pixel_size=10, scale=8)
    assert big.shape == (32, 48, 4)
    same, _ = run(img, pixel_size=10, scale=0)
    assert same.shape == img.shape


def test_non_divisible_sizes_do_not_lose_pixels() -> None:
    out, info = run(gradient(37, 53), pixel_size=6, scale=0)
    assert out.shape == (37, 53, 4) and info["grid"] == [9, 7]


def test_edge_preserving_smoothing_keeps_a_hard_edge() -> None:
    img = np.zeros((40, 40, 4), dtype=F32)
    img[..., 3] = 1
    img[:, 20:, :3] = 1.0
    rng = np.random.default_rng(1)
    img[..., :3] = np.clip(img[..., :3] + rng.normal(0, 0.05, (40, 40, 3)).astype(F32), 0, 1)
    cells = pixelart.bilateral(pixelart.to_cells(img, 2), 60)
    assert cells[10, 3, 0] < 0.2 and cells[10, 16, 0] > 0.8  # edge intact
    assert cells[:, :8, 0].std() < pixelart.to_cells(img, 2)[:, :8, 0].std()  # noise reduced


def test_render_applies_pixelart_last() -> None:
    img = gradient(32, 32)
    state = EditState.model_validate(
        {"adjust": {"saturation": -100}, "pixelart": {"pixel_size": 4, "colors": 4, "smooth": 0}}
    )
    out = render(img, state)
    assert np.allclose(out[..., 0], out[..., 1], atol=1e-3)  # greyscale first, then quantised


def test_palette_text_import() -> None:
    assert pixelart.parse_palette_text("ff0000\n#00FF00\n0000ff\n") == [
        "#ff0000",
        "#00ff00",
        "#0000ff",
    ]
    gpl = "GIMP Palette\nName: x\nColumns: 4\n#\n255 0 0 red\n0 255 0 green\n"
    assert pixelart.parse_palette_text(gpl) == ["#ff0000", "#00ff00"]
    assert len(pixelart.parse_palette_text("\n".join(["ffffff"] * 100))) == 64
