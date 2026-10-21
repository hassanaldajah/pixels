from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from app.config import Settings
from security.gate import SecurityGate


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    cfg = Settings(data_dir=tmp_path / "data", _env_file=None)  # type: ignore[call-arg]
    cfg.ensure_dirs()
    return cfg


@pytest.fixture
def gate(settings: Settings) -> Iterator[SecurityGate]:
    yield SecurityGate(settings)
