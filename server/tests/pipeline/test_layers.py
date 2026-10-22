"""Layers: placement, the W3C blend modes, compositing and the project format."""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image
from pydantic import ValidationError

from pipeline import layers, project
from pipeline.ops import EditState, Layer, LayerMask

ID_A = "a" * 32
ID_B = "b" * 32


def solid(w: int, h: int, rgba: tuple[float, float, float, float]) -> np.ndarray:
    return np.broadcast_to(np.array(rgba, dtype=np.float32), (h, w, 4)).copy()


def layer(**kw: object) -> Layer:
    return Layer.model_validate({"id": "layer01", "image_id": ID_A, **kw})


# --- the model ---------------------------------------------------------------------------------
def test_layer_ids_are_checked() -> None:
    with pytest.raises(ValidationError):
        Layer.model_validate({"id": "BAD ID", "image_id": ID_A})
    with pytest.raises(ValidationError):
        Layer.model_validate({"id": "layer01", "image_id": "../../etc/passwd"})
    with pytest.raises(ValidationError):
        EditState.model_validate({"layers": [{"id": "same01", "image_id": ID_A}] * 2})
    with pytest.raises(ValidationError):
        EditState.model_validate(
            {"layers": [{"id": f"layer{i:02d}", "image_id": ID_A} for i in range(17)]}
        )


def test_old_states_without_layers_still_validate() -> None:
    assert EditState.model_validate({"adjust": {"exposure": 1}}).layers == []


# --- blend modes (W3C formulas at a few known points) -------------------------------------------
@pytest.mark.parametrize(
    ("mode", "cb", "cs", "expected"),
    [
        ("normal", 0.2, 0.7, 0.7),
        ("multiply", 0.5, 0.5, 0.25),
        ("screen", 0.5, 0.5, 0.75),
        ("overlay", 0.25, 0.5, 0.25),  # cb <= .5: 2 * cb * cs
        ("overlay", 0.75, 0.5, 0.75),  # cb > .5: 1 - 2(1-cb)(1-cs)
        ("darken", 0.3, 0.6, 0.3),
        ("lighten", 0.3, 0.6, 0.6),
        ("difference", 0.3, 0.8, 0.5),
        ("soft-light", 0.5, 0.5, 0.5),  # a mid-grey top layer changes nothing
        ("soft-light", 0.25, 1.0, 0.5),  # cb + (2cs-1)(D(cb)-cb), D(.25) = .5
    ],
)
def test_blend_formulas(mode: str, cb: float, cs: float, expected: float) -> None:
    got = layers.blend_rgb(mode, np.float32(cb), np.float32(cs))
    assert abs(float(got) - expected) < 1e-6


def test_blend_over_opaque_base_follows_opacity() -> None:
    base = solid(2, 2, (0.2, 0.4, 0.6, 1.0))
    top = solid(2, 2, (1.0, 1.0, 1.0, 1.0))
    out = layers.blend(base, top, "normal", 0.25)
    assert np.allclose(out[0, 0], [0.4, 0.55, 0.7, 1.0], atol=1e-6)


def test_transparent_top_leaves_the_base_alone() -> None:
    base = solid(3, 3, (0.1, 0.2, 0.3, 0.8))
    out = layers.blend(base, solid(3, 3, (1, 0, 0, 0)), "multiply", 1.0)
    assert np.allclose(out, base, atol=1e-6)


def test_layer_over_transparency_keeps_its_own_colour() -> None:
    base = solid(1, 1, (0.0, 0.0, 0.0, 0.0))
    out = layers.blend(base, solid(1, 1, (0.9, 0.1, 0.1, 0.5)), "multiply", 1.0)
    assert np.allclose(out[0, 0], [0.9, 0.1, 0.1, 0.5], atol=1e-6)  # nothing below to multiply with


# --- placement and compositing -------------------------------------------------------------------
def test_whole_pixel_move_is_an_exact_copy() -> None:
    src = np.random.default_rng(1).random((4, 5, 4), dtype=np.float32)
    placed = layers.place(src, layer(x=3, y=-1), 10, 6)
    assert np.array_equal(placed[0:3, 3:8], src[1:4])
    assert placed[3:, :, 3].max() == 0 and placed[:, :3, 3].max() == 0


def test_scaled_layer_covers_the_scaled_area() -> None:
    src = solid(4, 4, (1, 1, 1, 1))
    placed = layers.place(src, layer(x=2, y=2, scale=2.0), 16, 16)
    assert placed[3:9, 3:9, 3].min() > 0.99 and placed[11:, :, 3].max() == 0
    assert (
        abs(float(placed[2, 5, 3]) - 0.75) < 1e-6
    )  # the same one-pixel anti-aliased edge as geometry


def test_composite_bottom_to_top_and_skips_hidden() -> None:
    base = solid(4, 4, (0.0, 0.0, 0.0, 1.0))
    pictures = {ID_A: solid(4, 4, (1.0, 0.0, 0.0, 1.0)), ID_B: solid(2, 2, (0.0, 0.0, 1.0, 1.0))}
    stack = [
        Layer(id="red001", image_id=ID_A),
        Layer(id="blue01", image_id=ID_B, x=1, y=1),
        Layer(id="hidden", image_id=ID_A, visible=False, blend="difference"),
    ]
    out = layers.composite(base, stack, pictures.__getitem__)
    assert np.allclose(out[0, 0], [1, 0, 0, 1]) and np.allclose(out[1, 1], [0, 0, 1, 1])


def test_layers_need_their_pictures() -> None:
    with pytest.raises(ValueError, match="not available"):
        layers.composite(solid(2, 2, (0, 0, 0, 1)), [layer()], None)


# --- projects keep the layer pictures ------------------------------------------------------------
def _png(color: tuple[int, int, int]) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), color).save(buffer, "PNG")
    return buffer.getvalue()


def _layered_project() -> project.ProjectFile:
    state = EditState(layers=[Layer(id="layer01", image_id=ID_A)])
    return project.ProjectFile(
        name="layers",
        history=[
            project.HistoryEntry(label="Open", state=EditState()),
            project.HistoryEntry(label="Add layer", state=state),
        ],
        index=1,
    )


def test_project_round_trip_with_layers() -> None:
    data = project.save(_layered_project(), _png((1, 2, 3)), {ID_A: _png((9, 9, 9))})
    loaded, original, pngs = project.load(data, 10_000_000)
    assert original == _png((1, 2, 3)) and pngs == {ID_A: _png((9, 9, 9))}
    renamed = project.remap_layer_images(loaded, {ID_A: ID_B})
    assert renamed.history[1].state.layers[0].image_id == ID_B


def test_project_layer_pictures_must_match_the_layers() -> None:
    missing = project.save(_layered_project(), _png((1, 2, 3)), {})
    with pytest.raises(project.ProjectError, match="do not match"):
        project.load(missing, 10_000_000)
    extra = project.save(_layered_project(), _png((1, 2, 3)), {ID_A: _png((0, 0, 0)), ID_B: b"x"})
    with pytest.raises(project.ProjectError, match="do not match"):
        project.load(extra, 10_000_000)


@pytest.mark.parametrize(
    "name", ["layers/../evil.png", "layers/ABC.png", "layers/x.exe", "other.png"]
)
def test_project_refuses_unexpected_layer_names(name: str) -> None:
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("project.json", _layered_project().model_dump_json())
        archive.writestr("original.png", _png((1, 2, 3)))
        archive.writestr(name, b"x")
    with pytest.raises(project.ProjectError):
        project.load(buffer.getvalue(), 10_000_000)


# --- gradient masks ------------------------------------------------------------------------------
def test_linear_mask_runs_from_transparent_to_opaque() -> None:
    mask = LayerMask(kind="linear", x0=0, y0=0, x1=10, y1=0)
    v = layers.mask_values(mask, 10, 2)[..., 0]
    assert np.allclose(v[0], (np.arange(10) + 0.5) / 10, atol=1e-6) and np.allclose(v[0], v[1])
    inverted = layers.mask_values(mask.model_copy(update={"invert": True}), 10, 2)[..., 0]
    assert np.allclose(inverted, 1 - v, atol=1e-6)


def test_radial_mask_is_opaque_in_the_centre() -> None:
    mask = LayerMask(kind="radial", x0=5, y0=5, x1=10, y1=5)
    v = layers.mask_values(mask, 10, 10)[..., 0]
    assert v[4:6, 4:6].min() > 0.85 and v[0, 0] == 0.0 and v[5, 9] < 0.1


def test_mask_points_must_differ() -> None:
    with pytest.raises(ValidationError):
        LayerMask(kind="linear", x0=3, y0=3, x1=3, y1=3)


def test_masked_layer_fades_in_the_composite() -> None:
    base = solid(10, 1, (0, 0, 0, 1))
    pictures = {ID_A: solid(10, 1, (1, 1, 1, 1))}
    fade = Layer(id="fade01", image_id=ID_A, mask=LayerMask(kind="linear", x0=0, y0=0, x1=10, y1=0))
    out = layers.composite(base, [fade], pictures.__getitem__)
    assert out[0, 0, 0] < 0.1 and out[0, 9, 0] > 0.9 and np.all(np.diff(out[0, :, 0]) > 0)
