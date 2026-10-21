from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from starlette.websockets import WebSocketDisconnect

from app.config import Settings
from app.main import create_app

from .security import fixtures as fx

# Starlette's TestClient would otherwise send "Host: testserver" on websockets.
LOCAL = {"Host": "127.0.0.1:8765"}


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings), base_url="http://127.0.0.1:8765") as c:
        yield c


def upload(client: TestClient, data: bytes, name: str, **headers: str):  # type: ignore[no-untyped-def]
    return client.post(
        "/api/images",
        content=data,
        headers={"X-Filename": name, "Content-Type": "application/octet-stream", **headers},
    )


def test_health_and_system(client: TestClient) -> None:
    assert client.get("/api/health").json()["status"] == "ok"
    system = client.get("/api/system").json()
    assert system["version"] and system["limits"]["max_file_bytes"] > 0
    assert "hardware" not in system and "models" not in system


def test_upload_then_fetch_sanitised_png(client: TestClient) -> None:
    response = upload(client, fx.jpeg_with_gps_and_orientation(), "pic.jpg")
    assert response.status_code == 201
    body = response.json()
    assert (body["width"], body["height"]) == (20, 40)
    assert body["gate"]["verdict"] == "Passed Pixels security checks"
    fetched = client.get(body["url"])
    assert fetched.status_code == 200 and fetched.headers["content-type"] == "image/png"
    assert fetched.content[:8] == b"\x89PNG\r\n\x1a\n" and b"FixtureCam" not in fetched.content
    assert client.get(body["url"] + "/info").json()["name"] == "pic.jpg"
    assert client.delete(body["url"]).status_code == 204
    assert client.get(body["url"]).status_code == 404


def test_rejection_is_human_readable_and_logged(client: TestClient, settings: Settings) -> None:
    response = upload(client, fx.renamed_executable(), "photo.png")
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "type_mismatch" and "Windows executable" in body["message"]
    assert any(s["status"] == "failed" for s in body["steps"])
    line = json.loads(settings.security_log_path.read_text().splitlines()[-1])
    assert line["code"] == "type_mismatch" and "photo.png" not in json.dumps(line)
    assert len(line["name_sha256"]) == 64


def test_rejected_files_leave_nothing_on_disk(client: TestClient, settings: Settings) -> None:
    upload(client, fx.zip_in_png(), "a.png")
    assert list(settings.images_dir.iterdir()) == []
    assert list(settings.spool_dir.iterdir()) == []


def test_oversized_body_is_refused_before_reading_it(settings: Settings) -> None:
    settings.max_file_bytes = 1000
    with TestClient(create_app(settings), base_url="http://127.0.0.1:8765") as client:
        response = upload(client, b"\x89PNG" + b"0" * 5000, "a.png")
        assert response.status_code == 413 and response.json()["code"] == "file_too_large"


def test_path_traversal_in_filename_is_harmless(client: TestClient, settings: Settings) -> None:
    body = upload(client, fx.valid_png(), "..%2F..%2Fevil.png").json()
    assert body["name"] == "evil.png"
    assert sorted(p.suffix for p in settings.images_dir.iterdir()) == [".json", ".png"]


def test_invalid_image_ids_are_rejected(client: TestClient) -> None:
    for bad in ("..", "abc", "g" * 32, "../../etc/passwd"):
        assert client.get(f"/api/images/{bad}").status_code in (404, 405)


def test_batch_limit(client: TestClient, settings: Settings) -> None:
    too_many = client.post("/api/batches", json={"count": settings.max_batch_files + 1})
    assert too_many.status_code == 413 and too_many.json()["code"] == "batch_too_large"
    batch = client.post("/api/batches", json={"count": 1}).json()["id"]
    first = client.post(
        f"/api/images?batch={batch}", content=fx.valid_png(), headers={"X-Filename": "a.png"}
    )
    second = client.post(
        f"/api/images?batch={batch}", content=fx.valid_png(), headers={"X-Filename": "b.png"}
    )
    assert first.status_code == 201 and second.status_code == 409


def test_security_status(client: TestClient) -> None:
    status = client.get("/api/security/status").json()
    assert status["yara"]["available"] and "svg" not in status["allowed_formats"]


# --- network hardening -------------------------------------------------------------------------


def test_foreign_host_header_is_refused(client: TestClient) -> None:
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 421


def test_cross_origin_post_is_refused(client: TestClient) -> None:
    response = upload(client, fx.valid_png(), "a.png", Origin="https://evil.example")
    assert response.status_code == 403


def test_same_origin_post_is_allowed(client: TestClient) -> None:
    assert (
        upload(client, fx.valid_png(), "a.png", Origin="http://127.0.0.1:8765").status_code == 201
    )


def test_dev_origin_only_allowed_in_dev_mode(settings: Settings) -> None:
    for dev, expected in ((False, 403), (True, 201)):
        settings.dev = dev
        with TestClient(create_app(settings), base_url="http://127.0.0.1:8765") as c:
            assert (
                upload(c, fx.valid_png(), "a.png", Origin="http://localhost:5173").status_code
                == expected
            )


def test_no_cors_headers_are_ever_sent(client: TestClient) -> None:
    response = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in response.headers


def test_security_headers(client: TestClient) -> None:
    headers = client.get("/api/health").headers
    csp = headers["content-security-policy"]
    assert "default-src 'self'" in csp and "script-src 'self'" in csp and "'unsafe-eval'" not in csp
    assert headers["x-content-type-options"] == "nosniff" and headers["x-frame-options"] == "DENY"


def test_server_refuses_to_bind_beyond_loopback_without_lan_flag(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="loopback"):
        Settings(host="0.0.0.0", data_dir=tmp_path, _env_file=None)  # type: ignore[call-arg]  # noqa: S104


def test_lan_mode_requires_a_token(tmp_path: Path) -> None:
    cfg = Settings(host="0.0.0.0", lan=True, data_dir=tmp_path, _env_file=None)  # type: ignore[call-arg]  # noqa: S104
    assert cfg.access_token and len(cfg.access_token) >= 24
    with TestClient(create_app(cfg), base_url="http://192.168.1.20:8765") as c:
        assert c.get("/api/health").status_code == 401
        assert c.get("/api/health", headers={"X-Pixels-Token": "wrong"}).status_code == 401
        assert c.get("/api/health", headers={"X-Pixels-Token": cfg.access_token}).status_code == 200


# --- WebSocket ---------------------------------------------------------------------------------


def test_job_progress_is_streamed_over_websocket(client: TestClient) -> None:
    job_id = "a" * 32
    with client.websocket_connect("/ws/jobs", headers=LOCAL) as ws:
        assert ws.receive_json()["type"] == "snapshot"
        assert upload(client, fx.valid_png(), "a.png", **{"X-Job-Id": job_id}).status_code == 201
        seen = []
        while True:
            event = ws.receive_json()
            seen.append(event["status"])
            if event["status"] == "done":
                break
    assert "checking" in seen and event["id"] == job_id and event["progress"] == 1.0


def test_websocket_from_foreign_origin_is_refused(client: TestClient) -> None:
    refused = {**LOCAL, "Origin": "https://evil.example"}
    with pytest.raises(WebSocketDisconnect), client.websocket_connect("/ws/jobs", headers=refused):
        pass


def test_stored_image_is_a_valid_png(client: TestClient, settings: Settings) -> None:
    upload(client, fx.valid_webp(), "a.webp")
    png = next(settings.images_dir.glob("*.png"))
    with Image.open(png) as image:
        assert image.format == "PNG"
