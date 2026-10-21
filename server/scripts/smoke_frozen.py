"""Smoke test for the frozen backend: start it, open an image through the Security Gate, stop it.

    cd server && uv run python scripts/smoke_frozen.py

It exercises the part most likely to break in a frozen build: the sandboxed decoder, which is the same
executable started with `--decode-worker`.
"""

from __future__ import annotations

import io
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
EXE = (
    ROOT
    / "dist"
    / "pixels-server"
    / ("pixels-server.exe" if sys.platform == "win32" else "pixels-server")
)


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


PORT = _free_port()
BASE = f"http://127.0.0.1:{PORT}"


def request(
    path: str, data: bytes | None = None, headers: dict[str, str] | None = None
) -> tuple[int, bytes]:
    req = urllib.request.Request(  # noqa: S310 - loopback only
        BASE + path, data=data, headers=headers or {}, method="POST" if data else "GET"
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:  # noqa: S310 - loopback only
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def png_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 80, 40)).save(buffer, "PNG")
    return buffer.getvalue()


def main() -> int:
    if not EXE.is_file():
        print(f"Missing {EXE}; run freeze.py first", file=sys.stderr)
        return 1
    data_dir = tempfile.mkdtemp(prefix="pixels-smoke-")
    env = {"PIXELS_DATA_DIR": data_dir, "SYSTEMROOT": os.environ.get("SYSTEMROOT", "")}
    proc = subprocess.Popen(
        [str(EXE), "--port", str(PORT)],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    failures: list[str] = []
    try:
        for _ in range(120):
            if proc.poll() is not None:
                raise SystemExit(
                    f"The frozen backend exited during start-up (code {proc.returncode})"
                )
            try:
                if request("/api/health")[0] == 200:
                    break
            except OSError:
                time.sleep(0.5)
        else:
            raise SystemExit("The frozen backend did not start within a minute")

        status, body = request("/api/security/status")
        security = json.loads(body)
        if not security["yara"]["available"]:
            failures.append(
                f"YARA rules are not available in the frozen build: {security['yara']['error']}"
            )

        status, body = request("/api/images", png_bytes(), {"X-Filename": "smoke.png"})
        if status != 201:
            failures.append(f"A valid image was rejected ({status}): {body[:300]!r}")
        else:
            info = json.loads(body)
            if (info["width"], info["height"]) != (40, 30):
                failures.append("The decoded image has the wrong size")
            status, _ = request(
                f"/api/images/{info['id']}/export",
                json.dumps({"options": {"format": "webp"}}).encode(),
                {"Content-Type": "application/json"},
            )
            if status != 200:
                failures.append(f"Export failed ({status})")

        status, body = request(
            "/api/images",
            b"MZ" + b"\x90" * 80 + b"This program cannot be run in DOS mode.",
            {"X-Filename": "photo.png"},
        )
        if status != 422:
            failures.append(f"A disguised executable was not refused ({status})")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
    if failures:
        print("FROZEN BACKEND CHECKS FAILED:\n - " + "\n - ".join(failures), file=sys.stderr)
        return 1
    print(
        "Frozen backend OK: starts, decodes in the sandbox, exports, refuses a disguised executable."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
