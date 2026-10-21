""".pxe project files: a ZIP holding `project.json` (edit history) and `original.png`.

A project file is untrusted input like any other. Opening one never extracts to disk and never
trusts the archive's own size fields: only the two expected names are accepted, every entry is read
with a hard cap, and the embedded image goes through the full Security Gate again by the caller.
"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from pipeline.ops import EditState

FORMAT = "pixels-project"
VERSION = 1
JSON_NAME = "project.json"
IMAGE_NAME = "original.png"
MAX_JSON_BYTES = 4 * 1024 * 1024
MAX_HISTORY = 1000


class ProjectError(ValueError):
    """The file is not a valid project. The message is shown to the user."""


class HistoryEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(max_length=120)
    state: EditState


class ProjectFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: str = FORMAT
    version: int = VERSION
    name: str = Field(default="Untitled", max_length=200)
    created: str = Field(default="", max_length=40)
    history: list[HistoryEntry] = Field(min_length=1, max_length=MAX_HISTORY)
    index: int = Field(ge=0)
    safe_exif: dict[str, dict[str, object]] | None = None


def save(project: ProjectFile, original_png: bytes) -> bytes:
    if project.index >= len(project.history):
        raise ProjectError("The history position is outside the history.")
    project = project.model_copy(
        update={"created": project.created or datetime.now(UTC).isoformat(timespec="seconds")}
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            zipfile.ZipInfo(JSON_NAME, date_time=(2026, 1, 1, 0, 0, 0)),
            project.model_dump_json(),
            zipfile.ZIP_DEFLATED,
        )
        archive.writestr(
            zipfile.ZipInfo(IMAGE_NAME, date_time=(2026, 1, 1, 0, 0, 0)),
            original_png,
            zipfile.ZIP_STORED,
        )
    return buffer.getvalue()


def _read_capped(archive: zipfile.ZipFile, info: zipfile.ZipInfo, limit: int) -> bytes:
    with archive.open(info) as handle:
        data = handle.read(limit + 1)  # trust the stream, not the header
    if len(data) > limit:
        raise ProjectError(
            f"{info.filename} is larger than the {limit / 1024 / 1024:,.0f} MB limit."
        )
    return data


def load(data: bytes, max_image_bytes: int) -> tuple[ProjectFile, bytes]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ProjectError(
            "This is not a Pixels project file (it is not a valid archive)."
        ) from exc
    with archive:
        infos = archive.infolist()
        names = [i.filename for i in infos]
        if sorted(names) != sorted([JSON_NAME, IMAGE_NAME]):
            raise ProjectError(f"A project must contain exactly {JSON_NAME} and {IMAGE_NAME}.")
        for info in infos:
            if info.flag_bits & 0x1:
                raise ProjectError("Encrypted project files are not supported.")
            if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ProjectError("The project uses an unsupported compression method.")
        by_name = {i.filename: i for i in infos}
        raw_json = _read_capped(archive, by_name[JSON_NAME], MAX_JSON_BYTES)
        image = _read_capped(archive, by_name[IMAGE_NAME], max_image_bytes)
    try:
        project = ProjectFile.model_validate(json.loads(raw_json))
    except (ValueError, ValidationError) as exc:
        raise ProjectError(f"The project description is invalid: {exc}") from exc
    if project.format != FORMAT or project.version > VERSION:
        raise ProjectError("This project was made by a newer or different program.")
    if project.index >= len(project.history):
        raise ProjectError("The history position is outside the history.")
    return project, image
