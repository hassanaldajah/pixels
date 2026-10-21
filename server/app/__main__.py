"""`python -m app [--lan] [--dev] [--port N]`: start the Pixels backend."""

from __future__ import annotations

import argparse
import os

import uvicorn

from app.config import Settings
from app.main import create_app


def main() -> None:
    parser = argparse.ArgumentParser(prog="pixels-server")
    parser.add_argument("--host", help="default: 127.0.0.1")
    parser.add_argument("--port", type=int)
    parser.add_argument(
        "--lan", action="store_true", help="allow other devices; requires the printed token"
    )
    parser.add_argument("--dev", action="store_true", help="accept the Vite dev server origin")
    args = parser.parse_args()
    if args.lan:
        os.environ["PIXELS_LAN"] = "1"
        os.environ.setdefault("PIXELS_HOST", "0.0.0.0")  # noqa: S104 - explicit opt-in via --lan
    if args.host:
        os.environ["PIXELS_HOST"] = args.host
    if args.port:
        os.environ["PIXELS_PORT"] = str(args.port)
    if args.dev:
        os.environ["PIXELS_DEV"] = "1"

    settings = Settings()
    print(
        f"Pixels backend: http://{settings.host}:{settings.port}  (data: {settings.data_dir})",
        flush=True,
    )
    if settings.lan:
        print(f"LAN mode is ON. Access token: {settings.access_token}", flush=True)
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    main()
