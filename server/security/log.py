"""security.log: one JSON line per rejected file. Records a filename hash, never image content."""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path


class SecurityLog:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._logger = logging.getLogger(f"pixels.security.audit.{path}")
        self._logger.setLevel(logging.INFO)
        self._logger.propagate = False
        if not self._logger.handlers:
            path.parent.mkdir(parents=True, exist_ok=True)
            handler = RotatingFileHandler(path, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
            handler.setFormatter(logging.Formatter("%(message)s"))
            self._logger.addHandler(handler)

    def rejected(self, filename: str, code: str, step: str, reason: str) -> None:
        self._logger.info(
            json.dumps(
                {
                    "ts": datetime.now(UTC).isoformat(timespec="seconds"),
                    "event": "rejected",
                    "name_sha256": hashlib.sha256(filename.encode("utf-8", "replace")).hexdigest(),
                    "code": code,
                    "step": step,
                    "reason": reason,
                },
                ensure_ascii=True,
            )
        )

    def close(self) -> None:
        for handler in list(self._logger.handlers):
            handler.close()
            self._logger.removeHandler(handler)
