from __future__ import annotations

import sys
from pathlib import Path

import pytest

from security.gate import WORKER, worker_command


def test_normal_install_runs_the_worker_script_in_isolated_mode() -> None:
    command = worker_command(Path("a.bin"), Path("b.png"), 5)
    assert command[:3] == [sys.executable, "-I", str(WORKER)]
    assert command[3:] == ["--src", "a.bin", "--dst", "b.png", "--max-pixels", "5"]


def test_frozen_build_reruns_its_own_executable_in_worker_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    command = worker_command(Path("a.bin"), Path("b.png"), 5)
    assert command[:2] == [sys.executable, "--decode-worker"]
    assert "-I" not in command and str(WORKER) not in command


def test_launcher_dispatches_the_worker_role(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    import launcher

    seen: dict[str, list[str]] = {}
    monkeypatch.setattr("security.worker.main", lambda argv: seen.setdefault("argv", argv) and 0)
    monkeypatch.setattr(sys, "argv", ["pixels-server", "--decode-worker", "--src", "x"])
    assert launcher.main() == 0
    assert seen["argv"] == ["--src", "x"]
