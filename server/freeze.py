"""Freeze the backend into `dist/pixels-server/` for the desktop app (PyInstaller, one folder).

    cd server && uv run python freeze.py

A folder build (not a single file) starts faster, does not unpack itself on every launch, and keeps the
decoder sandbox simple: the worker is this same executable started with `--decode-worker`.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

from PyInstaller.__main__ import run

HERE = Path(__file__).resolve().parent


def main() -> int:
    shutil.rmtree(HERE / "build", ignore_errors=True)
    shutil.rmtree(HERE / "dist" / "pixels-server", ignore_errors=True)
    data = f"{HERE / 'security' / 'yara'}{os.pathsep}security/yara"
    run(
        [
            str(HERE / "launcher.py"),
            "--noconfirm",
            "--clean",
            "--onedir",
            "--console",  # the Tauri shell starts it with no window; a console build keeps logs usable
            "--name",
            "pixels-server",
            "--paths",
            str(HERE),
            "--add-data",
            data,
            "--collect-all",
            "pillow_heif",
            "--collect-all",
            "yara_x",
            "--collect-submodules",
            "uvicorn",
            "--collect-submodules",
            "app",
            "--collect-submodules",
            "pipeline",
            "--collect-submodules",
            "security",
            "--hidden-import",
            "tifffile",
            "--exclude-module",
            "tkinter",
            "--exclude-module",
            "pytest",
            "--distpath",
            str(HERE / "dist"),
            "--workpath",
            str(HERE / "build"),
            "--specpath",
            str(HERE / "build"),
        ]
    )
    exe = (
        HERE
        / "dist"
        / "pixels-server"
        / ("pixels-server.exe" if sys.platform == "win32" else "pixels-server")
    )
    if not exe.is_file():
        print("Freeze failed: the executable was not produced.", file=sys.stderr)
        return 1
    print(f"Frozen backend: {exe}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
