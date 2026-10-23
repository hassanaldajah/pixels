""".pxe project files: a ZIP holding `project.json` (edit history), `original.png` and, since version 2,
one `layers/<id>.png` per picture used by a layer.

A project file is untrusted input like any other. Opening one never extracts to disk and never
trusts the archive's own size fields: only the two expected names are accepted, every entry is read
with a hard cap, and every embedded image goes through the full Security Gate again by the caller.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from pipeline.errors import PublicError
from pipeline.ops import EditState

FORMAT = "pixels-project"
VERSION = 2  # 2: layer pictures are stored next to the original
JSON_NAME = "project.json"
IMAGE_NAME = "original.png"
MAX_JSON_BYTES = 4 * 1024 * 1024
MAX_HISTORY = 1000
MAX_LAYER_IMAGES = 32
LAYER_NAME = re.compile(r"^layers/([0-9a-f]{32})\.png$")


class ProjectError(PublicError):
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


def layer_image_ids(project: ProjectFile) -> list[str]:
    """Every picture a layer uses anywhere in the history (so undo still works after reopening)."""
    seen: dict[str, None] = {}
    for entry in project.history:
        for layer in entry.state.layers:
            seen.setdefault(layer.image_id, None)
    ids = list(seen)
    if len(ids) > MAX_LAYER_IMAGES:
        raise ProjectError(f"A project can hold at most {MAX_LAYER_IMAGES} layer pictures.")
    return ids


def save(
    project: ProjectFile, original_png: bytes, layer_pngs: dict[str, bytes] | None = None
) -> bytes:
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
        for image_id, png in sorted((layer_pngs or {}).items()):
            archive.writestr(
                zipfile.ZipInfo(f"layers/{image_id}.png", date_time=(2026, 1, 1, 0, 0, 0)),
                png,
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


def load(data: bytes, max_image_bytes: int) -> tuple[ProjectFile, bytes, dict[str, bytes]]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ProjectError(
            "This is not a Pixels project file (it is not a valid archive)."
        ) from exc
    with archive:
        infos = archive.infolist()
        names = [i.filename for i in infos]
        extra = [n for n in names if n not in (JSON_NAME, IMAGE_NAME)]
        if (
            names.count(JSON_NAME) != 1
            or names.count(IMAGE_NAME) != 1
            or len(set(names)) != len(names)
            or any(not LAYER_NAME.fullmatch(n) for n in extra)
            or len(extra) > MAX_LAYER_IMAGES
        ):
            raise ProjectError(
                f"A project must contain {JSON_NAME}, {IMAGE_NAME} and only layers/<id>.png pictures."
            )
        for info in infos:
            if info.flag_bits & 0x1:
                raise ProjectError("Encrypted project files are not supported.")
            if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ProjectError("The project uses an unsupported compression method.")
        by_name = {i.filename: i for i in infos}
        raw_json = _read_capped(archive, by_name[JSON_NAME], MAX_JSON_BYTES)
        image = _read_capped(archive, by_name[IMAGE_NAME], max_image_bytes)
        layer_pngs = {
            LAYER_NAME.fullmatch(n).group(1): _read_capped(archive, by_name[n], max_image_bytes)  # type: ignore[union-attr]
            for n in extra
        }
    try:
        project = ProjectFile.model_validate(json.loads(raw_json))
    except (ValueError, ValidationError) as exc:
        raise ProjectError(f"The project description is invalid: {exc}") from exc
    if project.format != FORMAT or project.version > VERSION:
        raise ProjectError("This project was made by a newer or different program.")
    if project.index >= len(project.history):
        raise ProjectError("The history position is outside the history.")
    if set(layer_image_ids(project)) != set(layer_pngs):
        raise ProjectError("The layer pictures in the project do not match its layers.")
    return project, image, layer_pngs


def remap_layer_images(project: ProjectFile, new_ids: dict[str, str]) -> ProjectFile:
    """After the embedded pictures were stored again (new ids), point every layer at its new copy."""
    data = project.model_dump(mode="json")
    for entry in data["history"]:
        for layer in entry["state"].get("layers", []):
            layer["image_id"] = new_ids[layer["image_id"]]
    return ProjectFile.model_validate(data)
