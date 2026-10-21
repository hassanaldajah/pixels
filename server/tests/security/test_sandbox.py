"""The decoder worker really is confined: it is stopped on memory/time limits and has no network."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from app.config import MIB, Settings
from security.errors import GateRejection
from security.gate import WORKER, SecurityGate
from security.sandbox import capabilities, run_sandboxed

from . import fixtures as fx


def _inspect(settings: Settings, data: bytes) -> GateRejection:
    job = settings.spool_dir / "job"
    job.mkdir(parents=True, exist_ok=True)
    (job / "upload.bin").write_bytes(data)
    with pytest.raises(GateRejection) as caught:
        SecurityGate(settings).inspect(
            job / "upload.bin", filename="a.png", clean_png=job / "clean.png"
        )
    return caught.value


@pytest.mark.skipif(sys.platform == "darwin", reason="macOS cannot cap address space")
def test_memory_limit_stops_the_worker(settings: Settings) -> None:
    # 6000 x 6000 x 3 = 108 MB of pixels: a perfectly valid image that cannot fit in 100 MB.
    big = fx.encode(fx.Image.new("RGB", (6000, 6000), (10, 20, 30)), "PNG", compress_level=1)
    settings.worker_memory_bytes = 100 * MIB
    rejection = _inspect(settings, big)
    assert rejection.step == "sandbox"
    assert rejection.code in {"decoder_crashed", "too_large_to_decode"}


def test_the_same_image_decodes_with_a_normal_limit(settings: Settings) -> None:
    big = fx.encode(fx.Image.new("RGB", (6000, 6000), (10, 20, 30)), "PNG", compress_level=1)
    job = settings.spool_dir / "job"
    job.mkdir(parents=True, exist_ok=True)
    (job / "upload.bin").write_bytes(big)
    result = SecurityGate(settings).inspect(
        job / "upload.bin", filename="a.png", clean_png=job / "clean.png"
    )
    assert result.meta["width"] == 6000


def test_wall_clock_timeout_stops_the_worker(settings: Settings) -> None:
    settings.worker_timeout_seconds = 0.05
    rejection = _inspect(settings, fx.valid_png())
    assert rejection.code == "decode_timeout"


def test_worker_has_no_network(tmp_path: Path) -> None:
    probe = tmp_path / "probe.py"
    probe.write_text(
        "import sys; sys.path.insert(0, sys.argv[1])\n"
        "import worker, socket\n"
        "worker._block_network()\n"
        "try:\n"
        "    socket.create_connection(('127.0.0.1', 9), timeout=1)\n"
        "    print('CONNECTED')\n"
        "except OSError as e:\n"
        "    print('BLOCKED', e)\n"
    )
    result = run_sandboxed(
        [sys.executable, "-I", str(probe), str(WORKER.parent)],
        scratch=tmp_path, timeout=20, memory_bytes=1024 * MIB, cpu_seconds=20,
    )  # fmt: skip
    assert b"BLOCKED" in result.stdout and b"CONNECTED" not in result.stdout


def test_worker_child_processes_are_limited_on_windows(tmp_path: Path) -> None:
    if sys.platform != "win32":
        pytest.skip("process cap is a Windows Job Object feature")
    probe = tmp_path / "spawn.py"
    probe.write_text(
        "import subprocess, sys\n"
        "try:\n"
        "    p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(1)'])\n"
        "    q = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(1)'])\n"
        "    print('SPAWNED')\n"
        "except OSError as e:\n"
        "    print('DENIED', e)\n"
    )
    result = run_sandboxed(
        [sys.executable, str(probe)],
        scratch=tmp_path,
        timeout=20,
        memory_bytes=1024 * MIB,
        cpu_seconds=20,
    )
    assert b"DENIED" in result.stdout


def test_capabilities_are_reported_honestly() -> None:
    caps = capabilities()
    assert caps.cpu_limit
    assert caps.memory_limit == (sys.platform != "darwin")  # macOS cannot cap address space
    if sys.platform == "win32":
        assert caps.network_isolated is False  # blocked in-process only; documented limitation
