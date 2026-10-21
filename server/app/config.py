"""Runtime configuration. Every value can be overridden with a PIXELS_* environment variable."""

from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path
from typing import Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
GIB = 1024**3
MIB = 1024**2
REPO_ROOT = Path(__file__).resolve().parents[2]


def default_data_dir() -> Path:
    """Per-user data directory (images, security log). Never inside the repository."""
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "Pixels"


def default_web_dist() -> Path | None:
    dist = REPO_ROOT / "apps" / "web" / "dist"
    return dist if (dist / "index.html").is_file() else None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PIXELS_", env_file=".env", extra="ignore")

    # --- network ---------------------------------------------------------------------------
    host: str = "127.0.0.1"
    port: int = 8765
    lan: bool = False  # must be set explicitly to bind to anything but loopback
    access_token: str | None = None  # generated automatically when lan is on
    dev: bool = False  # also accept requests proxied from the Vite dev server
    dev_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    extra_origins: tuple[str, ...] = ()  # e.g. "tauri://localhost" for the desktop shell

    # --- storage ---------------------------------------------------------------------------
    data_dir: Path = Field(default_factory=default_data_dir)  # computed only when not overridden
    web_dist: Path | None = Field(
        default_factory=default_web_dist
    )  # built frontend served by the backend
    image_retention_days: int = 14  # sanitised working copies older than this are deleted; 0 = keep

    # --- Security Gate (Module S) ----------------------------------------------------------
    max_file_bytes: int = 200 * MIB
    max_batch_files: int = 100
    max_pixels: int = 300_000_000
    strict_extension_match: bool = True
    reject_trailing_data: bool = True
    worker_memory_bytes: int = 6 * GIB
    worker_cpu_seconds: int = 120
    worker_timeout_seconds: float = 180.0
    concurrent_gates: int = 2
    max_render_pixels: int = 100_000_000  # largest edited image the server will render
    concurrent_renders: int = 2
    clamd_host: str = "127.0.0.1"
    clamd_port: int = 3310
    clamd_socket: str | None = None
    clamav_required: bool = False

    @model_validator(mode="after")
    def _check_network(self) -> Self:
        if self.host not in LOOPBACK_HOSTS and not self.lan:
            raise ValueError(
                f"Refusing to bind to {self.host!r}: Pixels only listens on loopback unless "
                "LAN access is enabled explicitly (PIXELS_LAN=1, or --lan on the start script)."
            )
        if self.lan and not self.access_token:
            self.access_token = secrets.token_urlsafe(24)
        return self

    @property
    def images_dir(self) -> Path:
        return self.data_dir / "images"

    @property
    def spool_dir(self) -> Path:
        return self.data_dir / "spool"

    @property
    def security_log_path(self) -> Path:
        return self.data_dir / "security.log"

    @property
    def allowed_origins(self) -> set[str]:
        """Origins accepted besides the app's own (same-origin is always accepted)."""
        origins = set(self.extra_origins)
        if self.dev:
            origins.update(self.dev_origins)
        return origins

    def ensure_dirs(self) -> None:
        for directory in (self.data_dir, self.images_dir, self.spool_dir):
            directory.mkdir(parents=True, exist_ok=True)
