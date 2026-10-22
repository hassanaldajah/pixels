from __future__ import annotations

import io
import json
import zipfile

import numpy as np
import pytest
from PIL import Image
from pydantic import TypeAdapter

from pipeline import geometry, horizon, presets, project
from pipeline.export import ExportOptions
from pipeline.ops import EditState, GeoOp
from pipeline.recipes import Recipe, resolve, run_recipe

from .helpers import gradient

GEO = TypeAdapter(list[GeoOp])
F32 = np.float32


def geo(*items: dict) -> list:  # type: ignore[type-arg]
    return GEO.validate_python(list(items))


# --- resize ------------------------------------------------------------------------------------
def test_resize_changes_size_and_keeps_flat_colour() -> None:
    flat = np.full((40, 60, 4), 0.4, dtype=F32)
    out = geometry.apply(flat, geo({"type": "resize", "w": 15, "h": 10}), 10**9)
    assert out.shape == (10, 15, 4)
    assert np.allclose(out, 0.4, atol=1e-5)


def test_resize_downscale_averages_instead_of_aliasing() -> None:
    stripes = np.zeros((64, 64, 4), dtype=F32)
    stripes[..., 3] = 1
    stripes[:, ::2, :3] = 1.0  # one-pixel stripes
    out = geometry.apply(stripes, geo({"type": "resize", "w": 16, "h": 16}), 10**9)
    assert 0.35 < float(out[8, 8, 0]) < 0.65  # grey, not black or white


def test_resize_does_not_darken_edges_of_transparent_artwork() -> None:
    img = np.zeros((32, 32, 4), dtype=F32)
    img[8:24, 8:24] = (0.9, 0.9, 0.9, 1.0)
    out = geometry.apply(img, geo({"type": "resize", "w": 16, "h": 16}), 10**9)
    opaque = out[..., 3] > 0.99
    colours = out[opaque][:, :3]
    # Lanczos may overshoot slightly at a hard edge, but premultiplying must stop it fading to black.
    assert colours.min() >= 0.9 - 1e-3 and colours.max() < 0.97


# --- horizon -----------------------------------------------------------------------------------
def _landscape() -> np.ndarray:
    h, w = 240, 320
    img = np.zeros((h, w, 4), dtype=F32)
    img[..., 3] = 1
    img[: h // 2, :, :3] = (0.7, 0.85, 1.0)
    img[h // 2 :, :, :3] = (0.2, 0.35, 0.15)
    rng = np.random.default_rng(0)
    img[..., :3] += rng.normal(0, 0.01, (h, w, 3)).astype(F32)
    return np.clip(img, 0, 1)


@pytest.mark.parametrize("tilt", [-7.0, -3.0, 2.0, 5.0, 9.0])
def test_horizon_detection_levels_a_tilted_picture(tilt: float) -> None:
    tilted = geometry.apply(
        _landscape(), geo({"type": "rotate", "angle": tilt, "expand": False}), 10**9
    )
    result = horizon.estimate(tilted)
    assert result.angle == pytest.approx(-tilt, abs=1.0)
    assert result.confidence > 0.3


def test_horizon_detection_finds_nothing_in_a_flat_image() -> None:
    assert horizon.estimate(np.full((50, 50, 4), 0.5, dtype=F32)) == horizon.Horizon(0.0, 0.0)


# --- recipes -----------------------------------------------------------------------------------
def test_pad_to_square_recipe() -> None:
    recipe = Recipe.model_validate({"layout": {"type": "pad_square", "fill": "#00ff00"}})
    state = resolve(recipe, 40, 20)
    assert geometry.output_size(state.geometry, 40, 20) == (40, 40)


def test_fit_cover_and_contain_hit_the_target_size() -> None:
    for mode in ("cover", "contain"):
        recipe = Recipe.model_validate({"layout": {"type": "fit", "w": 100, "h": 50, "mode": mode}})
        assert geometry.output_size(resolve(recipe, 30, 90).geometry, 30, 90) == (100, 50), mode


def test_recipe_orientation_runs_before_layout(tmp_path) -> None:  # type: ignore[no-untyped-def]
    path = tmp_path / "a.png"
    Image.fromarray(np.round(gradient(20, 40)[..., :3] * 255).astype(np.uint8)).save(path)
    recipe = Recipe.model_validate(
        {
            "orientation": [{"type": "rotate90", "turns": 1}],
            "layout": {"type": "pad_square"},
            "export": {"format": "webp", "quality": 80},
            "suffix": "_sq",
        }
    )
    encoded = run_recipe(path, recipe, 10**8)
    with Image.open(io.BytesIO(encoded.data)) as image:
        assert image.size == (40, 40) and image.format == "WEBP"


def test_recipe_rejects_unsafe_suffix() -> None:
    with pytest.raises(ValueError):
        Recipe.model_validate({"suffix": "../evil"})


# --- presets -----------------------------------------------------------------------------------
def _square() -> np.ndarray:
    return gradient(256, 256, alpha=1.0)


def test_icon_set_contains_every_platform_file() -> None:
    data, names = presets.app_icons(_square(), list(presets.PLATFORMS), "#102030")
    assert any(n.startswith("ios/AppIcon.appiconset/Icon-1024") for n in names)
    assert "ios/AppIcon.appiconset/Contents.json" in names
    assert "android/res/mipmap-xxxhdpi/ic_launcher_foreground.png" in names
    assert "android/res/mipmap-anydpi-v26/ic_launcher.xml" in names
    assert {
        "macos/AppIcon.icns",
        "windows/app.ico",
        "web/favicon.ico",
        "pwa/icons/maskable-512x512.png",
    } <= set(names)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        contents = json.loads(archive.read("ios/AppIcon.appiconset/Contents.json"))
        assert len(contents["images"]) == len(presets.IOS_ICONS)
        with Image.open(io.BytesIO(archive.read("ios/AppIcon.appiconset/Icon-180.png"))) as icon:
            assert icon.size == (180, 180) and icon.mode == "RGB"  # iOS icons have no alpha
        with Image.open(io.BytesIO(archive.read("windows/app.ico"))) as ico:
            assert 256 in {s[0] for s in ico.info["sizes"]} and 16 in {
                s[0] for s in ico.info["sizes"]
            }
        with Image.open(io.BytesIO(archive.read("macos/AppIcon.icns"))) as icns:
            assert icns.format == "ICNS"
        with Image.open(
            io.BytesIO(archive.read("android/res/mipmap-mdpi/ic_launcher_round.png"))
        ) as rnd:
            assert (
                rnd.size == (48, 48) and rnd.getpixel((0, 0))[3] == 0
            )  # circular corners are transparent
        with Image.open(
            io.BytesIO(archive.read("android/res/mipmap-xxxhdpi/ic_launcher_foreground.png"))
        ) as fg:
            assert (
                fg.size == (432, 432) and fg.getpixel((5, 5))[3] == 0
            )  # art stays inside the safe zone


def test_unknown_platform_is_refused() -> None:
    with pytest.raises(ValueError):
        presets.app_icons(_square(), ["playstation"])


def test_sized_images_hit_exact_dimensions_in_both_modes() -> None:
    src = gradient(100, 200)
    for mode in ("cover", "contain"):
        data, names = presets.sized_images(
            src,
            ["github-social", "instagram-story"],
            mode=mode,
            focus=(0.5, 0.5),
            background="#000000",
            export=ExportOptions(format="jpeg"),
        )
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            sizes = {n: Image.open(io.BytesIO(archive.read(n))).size for n in names}
        assert sizes["github-social-1280x640.jpg"] == (1280, 640)
        assert sizes["instagram-story-1080x1920.jpg"] == (1080, 1920)


def test_cover_focus_moves_the_crop() -> None:
    src = gradient(60, 200)
    left = presets.fit_to(src, 40, 40, "cover", (0.0, 0.5), None)
    right = presets.fit_to(src, 40, 40, "cover", (1.0, 0.5), None)
    assert left[20, 20, 0] < right[20, 20, 0]  # red grows left to right in the source


def test_unknown_size_preset_is_refused() -> None:
    with pytest.raises(ValueError):
        presets.sized_images(
            gradient(),
            ["nope"],
            mode="cover",
            focus=(0.5, 0.5),
            background=None,
            export=ExportOptions(),
        )


# --- project files -----------------------------------------------------------------------------
def _project() -> project.ProjectFile:
    state = EditState.model_validate(
        {"geometry": [{"type": "rotate90", "turns": 1}], "adjust": {"exposure": 0.5}}
    )
    return project.ProjectFile(
        name="demo",
        history=[
            project.HistoryEntry(label="Open", state=EditState()),
            project.HistoryEntry(label="Rotate", state=state),
        ],
        index=1,
    )


def test_project_round_trip() -> None:
    png = io.BytesIO()
    Image.new("RGB", (4, 4), (9, 9, 9)).save(png, "PNG")
    data = project.save(_project(), png.getvalue())
    loaded, image, layer_pngs = project.load(data, 10_000_000)
    assert loaded.name == "demo" and loaded.index == 1 and image == png.getvalue() and layer_pngs == {}
    assert loaded.history[1].state.adjust.exposure == 0.5


def _zip(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, payload in entries.items():
            archive.writestr(name, payload)
    return buffer.getvalue()


GOOD_JSON = _project().model_dump_json().encode()


@pytest.mark.parametrize(
    "entries",
    [
        {
            "project.json": GOOD_JSON,
            "original.png": b"x",
            "../evil.txt": b"x",
        },  # zip-slip name + extra file
        {"project.json": GOOD_JSON, "original.png": b"x", "payload.exe": b"MZ"},
        {"project.json": GOOD_JSON},
        {"original.png": b"x"},
        {"/abs/project.json": GOOD_JSON, "original.png": b"x"},
    ],
)
def test_project_with_unexpected_entries_is_refused(entries: dict[str, bytes]) -> None:
    with pytest.raises(project.ProjectError):
        project.load(_zip(entries), 10_000_000)


def test_project_size_caps_do_not_trust_the_archive() -> None:
    bomb = _zip({"project.json": GOOD_JSON, "original.png": b"\x00" * 5_000_000})
    assert len(bomb) < 20_000  # tiny on disk
    with pytest.raises(project.ProjectError, match="larger than"):
        project.load(bomb, 1_000_000)


def test_project_json_must_match_the_schema() -> None:
    for bad in (
        b"not json",
        b'{"format":"pixels-project","history":[],"index":0}',
        GOOD_JSON.replace(b'"turns":1', b'"turns":9'),
    ):
        with pytest.raises(project.ProjectError):
            project.load(_zip({"project.json": bad, "original.png": b"x"}), 1_000_000)


def test_not_a_zip_is_refused() -> None:
    with pytest.raises(project.ProjectError, match="not a valid archive"):
        project.load(b"hello", 1_000_000)


def test_history_index_is_checked() -> None:
    bad = json.loads(GOOD_JSON)
    bad["index"] = 5
    with pytest.raises(project.ProjectError, match="outside"):
        project.load(
            _zip({"project.json": json.dumps(bad).encode(), "original.png": b"x"}), 1_000_000
        )
