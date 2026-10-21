from __future__ import annotations

import io
import json
import zipfile
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.main import create_app

from .security import fixtures as fx

HOST = "http://127.0.0.1:8765"


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings), base_url=HOST) as c:
        yield c


def upload(client: TestClient, data: bytes, name: str) -> dict:  # type: ignore[type-arg]
    response = client.post("/api/images", content=data, headers={"X-Filename": name})
    assert response.status_code == 201, response.text
    return response.json()  # type: ignore[no-any-return]


def image(response_bytes: bytes) -> Image.Image:
    return Image.open(io.BytesIO(response_bytes))


def test_capabilities(client: TestClient) -> None:
    caps = client.get("/api/capabilities").json()
    assert caps["formats"]["avif"] is True and caps["formats"]["png"] is True
    assert any(p["id"] == "github-social" for p in caps["size_presets"])
    assert len(caps["hsl_bands"]) == 8


def test_export_applies_the_edit_state(client: TestClient) -> None:
    up = upload(client, fx.valid_png(), "photo.png")  # 64 x 48
    state = {"geometry": [{"type": "rotate90", "turns": 1}], "adjust": {"saturation": -100}}
    response = client.post(
        f"/api/images/{up['id']}/export",
        json={"state": state, "options": {"format": "webp", "quality": 90}},
    )
    assert response.status_code == 200
    assert response.headers["content-disposition"] == 'attachment; filename="photo-edited.webp"'
    with image(response.content) as out:
        assert out.size == (48, 64)
        r, g, b = out.convert("RGB").getpixel((10, 10))
        assert abs(r - g) < 6 and abs(g - b) < 6  # desaturated


def test_export_with_no_edits_returns_the_working_copy_pixels(client: TestClient) -> None:
    up = upload(client, fx.valid_png(), "a.png")
    out = client.post(f"/api/images/{up['id']}/export", json={"options": {"format": "png"}})
    with image(out.content) as exported, image(client.get(up["url"]).content) as original:
        assert exported.convert("RGB").tobytes() == original.convert("RGB").tobytes()


def test_export_rejects_invalid_edit_states(client: TestClient) -> None:
    up = upload(client, fx.valid_png(), "a.png")
    for bad in (
        {"state": {"geometry": [{"type": "rotate90", "turns": 7}]}},
        {"state": {"adjust": {"exposure": 99}}},
        {"state": {"geometry": [{"type": "nope"}]}},
        {"options": {"format": "gif"}},
        {"state": {"adjust": {"curves": {"master": [[0, 0]]}}}},
    ):
        assert client.post(f"/api/images/{up['id']}/export", json=bad).status_code == 422


def test_export_refuses_results_above_the_pixel_limit(settings: Settings) -> None:
    settings.max_render_pixels = 10_000
    with TestClient(create_app(settings), base_url=HOST) as c:
        up = upload(c, fx.valid_png(), "a.png")
        state = {"geometry": [{"type": "canvas", "w": 500, "h": 500, "anchor": "c"}]}
        response = c.post(f"/api/images/{up['id']}/export", json={"state": state})
        assert response.status_code == 422 and "limit" in response.json()["message"]


def test_unknown_image_ids(client: TestClient) -> None:
    for path in ("export", "horizon"):
        assert client.post(f"/api/images/{'a' * 32}/{path}", json={}).status_code == 404
        assert client.post(f"/api/images/not-an-id/{path}", json={}).status_code == 404


def test_horizon_endpoint(client: TestClient) -> None:
    up = upload(client, fx.valid_png(), "a.png")
    body = client.post(f"/api/images/{up['id']}/horizon").json()
    assert set(body) == {"angle", "confidence"}


def test_icon_set_download(client: TestClient) -> None:
    up = upload(client, fx.valid_png(), "app.png")
    response = client.post(
        f"/api/images/{up['id']}/presets/icons",
        json={"platforms": ["ios", "web"], "background": "#112233"},
    )
    assert response.status_code == 200 and response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
        assert "ios/AppIcon.appiconset/Contents.json" in names and "web/favicon.ico" in names
        with Image.open(io.BytesIO(archive.read("web/android-chrome-512x512.png"))) as icon:
            assert icon.size == (512, 512)
    assert (
        client.post(
            f"/api/images/{up['id']}/presets/icons", json={"platforms": ["xbox"]}
        ).status_code
        == 422
    )


def test_store_sizes_download(client: TestClient) -> None:
    up = upload(client, fx.valid_png(), "shot.png")
    response = client.post(
        f"/api/images/{up['id']}/presets/sizes",
        json={
            "ids": ["open-graph", "play-feature"],
            "mode": "contain",
            "background": "#000000",
            "export": {"format": "jpeg", "quality": 85},
        },
    )
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        sizes = {n: Image.open(io.BytesIO(archive.read(n))).size for n in archive.namelist()}
    assert sizes == {
        "open-graph-1200x630.jpg": (1200, 630),
        "play-feature-1024x500.jpg": (1024, 500),
    }
    assert (
        client.post(f"/api/images/{up['id']}/presets/sizes", json={"ids": ["bogus"]}).status_code
        == 422
    )


def test_batch_recipe_with_per_file_security_report(client: TestClient) -> None:
    ids = [
        upload(client, data, name)["id"]
        for data, name in ((fx.valid_png(), "one.png"), (fx.valid_jpeg(), "two.jpg"))
    ]
    recipe = {
        "name": "Square web",
        "layout": {"type": "pad_square", "fill": "#ffffff"},
        "adjust": {"contrast": 20},
        "export": {"format": "webp"},
        "suffix": "_sq",
    }
    response = client.post("/api/batch/run", json={"image_ids": [*ids, "f" * 32], "recipe": recipe})
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        report = json.loads(archive.read("report.json"))
        assert sorted(n for n in archive.namelist() if n != "report.json") == [
            "one_sq.webp",
            "two_sq.webp",
        ]
        with Image.open(io.BytesIO(archive.read("one_sq.webp"))) as out:
            assert out.size == (64, 64)
    statuses = [f["status"] for f in report["files"]]
    assert statuses == ["done", "done", "missing"]
    assert report["files"][0]["security"] == "Passed Pixels security checks"


def test_batch_size_limit(settings: Settings) -> None:
    settings.max_batch_files = 2
    with TestClient(create_app(settings), base_url=HOST) as c:
        response = c.post("/api/batch/run", json={"image_ids": ["a" * 32] * 3, "recipe": {}})
        assert response.status_code == 413


def test_recipe_validation(client: TestClient) -> None:
    for bad in (
        {"suffix": "../x"},
        {"layout": {"type": "fit", "w": 0, "h": 5}},
        {"export": {"format": "bmp"}},
    ):
        assert (
            client.post("/api/batch/run", json={"image_ids": ["a" * 32], "recipe": bad}).status_code
            == 422
        )


# --- project files -----------------------------------------------------------------------------
def test_project_save_and_open_round_trip(client: TestClient) -> None:
    up = upload(client, fx.jpeg_with_gps_and_orientation(), "trip.jpg")
    history = [
        {"label": "Open", "state": {}},
        {
            "label": "Warmer",
            "state": {"adjust": {"temperature": 30}, "geometry": [{"type": "flip", "axis": "h"}]},
        },
    ]
    saved = client.post(
        "/api/projects/save",
        json={"image_id": up["id"], "project": {"name": "Trip", "history": history, "index": 1}},
    )
    assert saved.status_code == 200 and saved.headers["content-disposition"].endswith('Trip.pxe"')
    opened = client.post(
        "/api/projects/open", content=saved.content, headers={"X-Filename": "Trip.pxe"}
    )
    assert opened.status_code == 201
    body = opened.json()
    assert (
        body["project"]["index"] == 1
        and body["project"]["history"][1]["state"]["adjust"]["temperature"] == 30
    )
    assert body["width"] == up["width"] and body["id"] != up["id"]
    # camera info captured at import travels with the project; GPS is in it only as data to re-attach on request
    assert body["project"]["safe_exif"]["ifd0"]["271"] == "FixtureCam"


def _pxe(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return buffer.getvalue()


PROJECT_JSON = json.dumps(
    {"name": "x", "history": [{"label": "Open", "state": {}}], "index": 0}
).encode()


def test_project_with_a_hostile_image_is_rejected_by_the_gate(
    client: TestClient, settings: Settings
) -> None:
    for payload in (
        fx.renamed_executable(),
        fx.zip_in_png(),
        fx.truncated_jpeg(),
        fx.decompression_bomb(),
    ):
        response = client.post(
            "/api/projects/open",
            content=_pxe({"project.json": PROJECT_JSON, "original.png": payload}),
        )
        assert response.status_code == 422, payload[:8]
        assert response.json()["step"] in {"magic", "polyglot", "structure", "bomb", "allowlist"}
    assert list(settings.images_dir.iterdir()) == []
    assert list(settings.spool_dir.iterdir()) == []


def test_project_structure_attacks_are_rejected(client: TestClient) -> None:
    for entries in (
        {"project.json": PROJECT_JSON, "original.png": fx.valid_png(), "../../evil.txt": b"x"},
        {"project.json": PROJECT_JSON},
        {"project.json": b"{}", "original.png": fx.valid_png()},
    ):
        response = client.post("/api/projects/open", content=_pxe(entries))
        assert response.status_code == 422 and response.json()["code"] == "bad_project"
    assert client.post("/api/projects/open", content=b"not a zip").status_code == 422


def test_project_zip_bomb_is_refused_without_inflating_it(settings: Settings) -> None:
    settings.max_file_bytes = 200_000
    bomb = _pxe({"project.json": PROJECT_JSON, "original.png": b"\x00" * 20_000_000})
    assert len(bomb) < 100_000
    with TestClient(create_app(settings), base_url=HOST) as c:
        response = c.post("/api/projects/open", content=bomb)
        assert response.status_code == 422 and "larger" in response.json()["message"]


def test_project_open_is_logged_when_refused(client: TestClient, settings: Settings) -> None:
    client.post("/api/projects/open", content=b"nope", headers={"X-Filename": "bad.pxe"})
    last = json.loads(settings.security_log_path.read_text().splitlines()[-1])
    assert last["code"] == "bad_project" and "bad.pxe" not in json.dumps(last)


def test_no_payment_api_in_permissions_policy(client: TestClient) -> None:
    assert "payment" not in client.get("/api/health").headers["permissions-policy"]


# --- pixel art and eraser -------------------------------------------------------------------------
def test_pixelart_palettes_and_import(client: TestClient) -> None:
    palettes = client.get("/api/pixelart/palettes").json()["palettes"]
    assert {p["id"] for p in palettes} == {"gameboy", "pico8", "nes", "c64", "cga", "endesga32"}
    assert len(next(p for p in palettes if p["id"] == "pico8")["colors"]) == 16
    imported = client.post("/api/pixelart/import-palette", content=b"ff0000\n00ff00\n0000ff\n")
    assert imported.json()["colors"] == ["#ff0000", "#00ff00", "#0000ff"]
    assert client.post("/api/pixelart/import-palette", content=b"nothing here").status_code == 422


def test_pixelart_preview_and_export(client: TestClient) -> None:
    up = upload(client, fx.valid_png(), "photo.png")  # 64 x 48
    art = {"pixel_size": 8, "colors": 4, "smooth": 0, "dither": "bayer4"}
    first = client.post(
        f"/api/images/{up['id']}/pixelart/preview", json={"state": {"pixelart": art}}
    )
    assert first.status_code == 200 and first.headers["content-type"] == "image/png"
    info = json.loads(first.headers["x-pixelart-info"])
    assert info["grid"] == [8, 6] and info["colors"] <= 4 and info["size"] == [64, 48]
    again = client.post(
        f"/api/images/{up['id']}/pixelart/preview",
        json={"state": {"pixelart": {**art, "colors": 3}}},
    )
    assert again.status_code == 200  # reuses the cached edited picture
    exported = client.post(
        f"/api/images/{up['id']}/export",
        json={"state": {"pixelart": {**art, "scale": 4}}, "options": {"format": "png"}},
    )
    with image(exported.content) as out:
        assert out.size == (32, 24)  # native grid x 4
    assert (
        client.post(f"/api/images/{up['id']}/pixelart/preview", json={"state": {}}).status_code
        == 422
    )
    bad = client.post(
        f"/api/images/{up['id']}/pixelart/preview", json={"state": {"pixelart": {"pixel_size": 1}}}
    )
    assert bad.status_code == 422


def _mask_b64(w: int, h: int, y0: int, y1: int, x0: int, x1: int) -> str:
    import base64

    import numpy as np

    m = np.zeros((h, w), dtype=bool)
    m[y0:y1, x0:x1] = True
    return base64.b64encode(np.packbits(m).tobytes()).decode()


def test_erase_creates_a_new_working_copy(client: TestClient) -> None:
    up = upload(client, fx.valid_png(), "photo.png")  # 64 x 48
    body = {
        "state": {},
        "mask_w": 64,
        "mask_h": 48,
        "mask_bits": _mask_b64(64, 48, 16, 32, 20, 44),
        "quality": "fast",
        "grow": 2,
        "feather": 2,
    }
    response = client.post(f"/api/images/{up['id']}/erase", json=body)
    assert response.status_code == 201
    new = response.json()
    assert new["id"] != up["id"] and (new["width"], new["height"]) == (64, 48)
    assert new["gate"]["verdict"] == "Passed Pixels security checks"
    with image(client.get(new["url"]).content) as a, image(client.get(up["url"]).content) as b:
        assert a.convert("RGB").getpixel((2, 2)) == b.convert("RGB").getpixel(
            (2, 2)
        )  # untouched corner


def test_erase_lower_resolution_mask_and_edits_are_baked_in(client: TestClient) -> None:
    up = upload(client, fx.valid_png(), "photo.png")
    body = {
        "state": {"geometry": [{"type": "rotate90", "turns": 1}]},  # 48 x 64 after rotation
        "mask_w": 24,
        "mask_h": 32,
        "mask_bits": _mask_b64(24, 32, 8, 20, 6, 18),
        "quality": "fast",
    }
    new = client.post(f"/api/images/{up['id']}/erase", json=body).json()
    assert (new["width"], new["height"]) == (48, 64)


def test_erase_rejects_bad_requests(client: TestClient) -> None:
    up = upload(client, fx.valid_png(), "photo.png")
    base = {"state": {}, "mask_w": 64, "mask_h": 48, "quality": "fast"}
    url = f"/api/images/{up['id']}/erase"
    assert client.post(url, json={**base, "mask_bits": "not base64!!"}).status_code == 422
    assert (
        client.post(url, json={**base, "mask_bits": _mask_b64(10, 10, 0, 1, 0, 1)}).status_code
        == 422
    )
    assert (
        client.post(url, json={**base, "mask_bits": _mask_b64(64, 48, 0, 0, 0, 0)}).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/images/{'a' * 32}/erase",
            json={**base, "mask_bits": _mask_b64(64, 48, 1, 5, 1, 5)},
        ).status_code
        == 404
    )
    assert (
        client.post(
            url, json={**base, "mask_bits": _mask_b64(64, 48, 1, 5, 1, 5), "grow": 999}
        ).status_code
        == 422
    )


# --- retouch -----------------------------------------------------------------------------------------
def test_retouch_routes_make_new_working_copies(client: TestClient) -> None:
    up = upload(client, fx.valid_png(), "photo.png")  # 64 x 48
    big = client.post(
        f"/api/images/{up['id']}/retouch/upscale", json={"state": {}, "factor": 2, "sharpen": 30}
    )
    assert big.status_code == 201
    new = big.json()
    assert new["id"] != up["id"] and (new["width"], new["height"]) == (128, 96)
    assert new["gate"]["verdict"] == "Passed Pixels security checks"
    smooth = client.post(f"/api/images/{up['id']}/retouch/smooth", json={"state": {}, "amount": 60})
    assert smooth.status_code == 201 and (smooth.json()["width"], smooth.json()["height"]) == (
        64,
        48,
    )
    cut = client.post(f"/api/images/{up['id']}/retouch/cutout", json={"state": {}, "tolerance": 40})
    assert cut.status_code in {201, 422}  # the gradient test picture may have no plain background


def test_retouch_bakes_in_edits_and_rejects_bad_requests(client: TestClient) -> None:
    up = upload(client, fx.valid_png(), "photo.png")
    turned = client.post(
        f"/api/images/{up['id']}/retouch/upscale",
        json={"state": {"geometry": [{"type": "rotate90", "turns": 1}]}, "factor": 1.5},
    )
    assert (turned.json()["width"], turned.json()["height"]) == (72, 96)
    url = f"/api/images/{up['id']}/retouch/upscale"
    assert client.post(url, json={"state": {}, "factor": 9}).status_code == 422
    assert (
        client.post(
            f"/api/images/{up['id']}/retouch/cutout", json={"state": {}, "colour": "red"}
        ).status_code
        == 422
    )
    assert (
        client.post(f"/api/images/{'a' * 32}/retouch/smooth", json={"state": {}}).status_code == 404
    )
