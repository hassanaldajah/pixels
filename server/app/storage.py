"""Sanitised image storage. Files are named by random UUID; client-supplied names never touch disk."""

from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from typing import Any

ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


def new_id() -> str:
    return uuid.uuid4().hex


def is_valid_id(value: str) -> bool:
    return bool(ID_PATTERN.fullmatch(value))


class ImageStore:
    def __init__(self, images_dir: Path) -> None:
        self.dir = images_dir

    def png_path(self, image_id: str) -> Path:
        if not is_valid_id(image_id):
            raise ValueError("invalid image id")
        return self.dir / f"{image_id}.png"

    def meta_path(self, image_id: str) -> Path:
        if not is_valid_id(image_id):
            raise ValueError("invalid image id")
        return self.dir / f"{image_id}.json"

    def adopt(self, image_id: str, clean_png: Path, meta: dict[str, Any]) -> Path:
        target = self.png_path(image_id)
        clean_png.replace(target)
        self.meta_path(image_id).write_text(json.dumps(meta), encoding="utf-8")
        return target

    def meta(self, image_id: str) -> dict[str, Any] | None:
        try:
            return json.loads(self.meta_path(image_id).read_text(encoding="utf-8"))  # type: ignore[no-any-return]
        except (OSError, ValueError):
            return None

    def delete(self, image_id: str) -> bool:
        existed = False
        for path in (self.png_path(image_id), self.meta_path(image_id)):
            if path.exists():
                path.unlink()
                existed = True
        return existed

    def purge_older_than(self, days: int) -> int:
        if days <= 0:
            return 0
        cutoff = time.time() - days * 86400
        removed = 0
        for path in self.dir.glob("*.png"):
            if path.stat().st_mtime < cutoff:
                self.delete(path.stem)
                removed += 1
        return removed


class MediaStore(ImageStore):
    """Sanitised video and audio, stored the same way: a random id, the file and its report."""

    def png_path(self, image_id: str) -> Path:
        return self.media_path(image_id)

    def media_path(self, media_id: str) -> Path:
        if not is_valid_id(media_id):
            raise ValueError("invalid media id")
        return self.dir / f"{media_id}.media"

    def purge_older_than(self, days: int) -> int:
        if days <= 0:
            return 0
        cutoff = time.time() - days * 86400
        removed = 0
        for path in self.dir.glob("*.media"):
            if path.stat().st_mtime < cutoff:
                self.delete(path.stem)
                removed += 1
        return removed
