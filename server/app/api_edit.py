"""Editing routes: export, presets, batch recipes, horizon detection and project files."""

from __future__ import annotations

import base64
import binascii
import hashlib
import io
import json
import re
import shutil
import zipfile
from pathlib import Path
from typing import Any, Literal

import anyio
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from PIL import features
from pydantic import BaseModel, ConfigDict, Field

from app.api import _clean_filename, gate_and_store
from app.storage import is_valid_id, new_id
from pipeline import horizon, inpaint, pixelart, presets, project
from pipeline.export import ExportOptions, encode
from pipeline.geometry import GeometryError
from pipeline.ops import HSL_BANDS, EditState
from pipeline.recipes import Recipe, run_recipe
from pipeline.render import load_rgba, render, render_base, render_composite
from security.errors import GateRejection

router = APIRouter()
HEX = r"^#[0-9a-fA-F]{6}$"


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExportBody(_Body):
    state: EditState = Field(default_factory=EditState)
    options: ExportOptions = Field(default_factory=ExportOptions)


class IconsBody(_Body):
    state: EditState = Field(default_factory=EditState)
    platforms: list[str] = Field(
        default_factory=lambda: list(presets.PLATFORMS), max_length=len(presets.PLATFORMS)
    )
    background: str = Field(default="#000000", pattern=HEX)
    fit: Literal["cover", "contain"] = "cover"


class SizesBody(_Body):
    state: EditState = Field(default_factory=EditState)
    ids: list[str] = Field(min_length=1, max_length=len(presets.SIZE_PRESETS))
    mode: Literal["cover", "contain"] = "cover"
    focus_x: float = Field(default=0.5, ge=0, le=1)
    focus_y: float = Field(default=0.5, ge=0, le=1)
    background: str | None = Field(default=None, pattern=HEX)
    export: ExportOptions = Field(default_factory=ExportOptions)


class BatchBody(_Body):
    image_ids: list[str] = Field(min_length=1, max_length=1000)
    recipe: Recipe


class ProjectSaveBody(_Body):
    image_id: str
    project: project.ProjectFile


def _error(code: str, message: str, status: int = 422) -> JSONResponse:
    return JSONResponse({"code": code, "message": message}, status_code=status)


def _image_path(request: Request, image_id: str) -> tuple[Path, dict[str, Any]] | JSONResponse:
    store = request.app.state.store
    if not is_valid_id(image_id):
        return _error("not_found", "No such image.", 404)
    path = store.png_path(image_id)
    meta = store.meta(image_id)
    if not path.is_file() or meta is None:
        return _error("not_found", "No such image.", 404)
    return path, meta


def _stem(meta: dict[str, Any]) -> str:
    stem = Path(str(meta.get("name", "image"))).stem
    return re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-.")[:60] or "image"


def _download(data: bytes, filename: str, media_type: str) -> Response:
    return Response(
        data,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/api/capabilities")
async def capabilities() -> dict[str, Any]:
    return {
        "formats": {
            "png": True,
            "jpeg": True,
            "webp": bool(features.check("webp")),
            "avif": bool(features.check("avif")),
            "tiff": True,
        },
        "bit_depth_formats": ["png", "tiff"],
        "profiles": ["sRGB", "Display P3"],
        "hsl_bands": list(HSL_BANDS),
        "platforms": list(presets.PLATFORMS),
        "size_presets": [
            {"id": p.id, "label": p.label, "group": p.group, "w": p.w, "h": p.h}
            for p in presets.SIZE_PRESETS
        ],
    }


def _layer_loader(request: Request) -> Any:
    """Layers point at other working copies; each one already went through the Security Gate."""
    store = request.app.state.store

    def load(image_id: str) -> Any:
        path = store.png_path(image_id)
        if not path.is_file():
            raise ValueError("A layer's picture is no longer available. Add it again.")
        return load_rgba(path)

    return load


async def _render(request: Request, path: Path, state: EditState) -> Any:
    settings = request.app.state.settings
    load_layer = _layer_loader(request)

    def work() -> Any:
        return render(load_rgba(path), state, settings.max_render_pixels, load_layer)

    async with request.app.state.render_slots:
        return await anyio.to_thread.run_sync(work)


@router.post("/api/images/{image_id}/export")
async def export_image(request: Request, image_id: str, body: ExportBody) -> Response:
    found = _image_path(request, image_id)
    if isinstance(found, JSONResponse):
        return found
    path, meta = found
    try:
        rendered = await _render(request, path, body.state)
        encoded = await anyio.to_thread.run_sync(
            encode, rendered, body.options, meta.get("safe_exif")
        )
    except ValueError as exc:  # includes GeometryError and a missing layer picture
        return _error("bad_edit", str(exc))
    return _download(encoded.data, f"{_stem(meta)}-edited.{encoded.extension}", encoded.media_type)


@router.post("/api/images/{image_id}/horizon")
async def detect_horizon(request: Request, image_id: str) -> Response:
    found = _image_path(request, image_id)
    if isinstance(found, JSONResponse):
        return found
    path, _meta = found
    result = await anyio.to_thread.run_sync(lambda: horizon.estimate(load_rgba(path)))
    return JSONResponse({"angle": result.angle, "confidence": result.confidence})


@router.post("/api/images/{image_id}/presets/icons")
async def export_icons(request: Request, image_id: str, body: IconsBody) -> Response:
    found = _image_path(request, image_id)
    if isinstance(found, JSONResponse):
        return found
    path, meta = found
    try:
        rendered = await _render(request, path, body.state)
        square = await anyio.to_thread.run_sync(
            lambda: presets.fit_to(
                rendered,
                1024,
                1024,
                body.fit,
                (0.5, 0.5),
                body.background if body.fit == "contain" else None,
            )
        )
        data, names = await anyio.to_thread.run_sync(
            presets.app_icons, square, body.platforms, body.background
        )
    except (GeometryError, ValueError) as exc:
        return _error("bad_request", str(exc))
    response = _download(data, f"{_stem(meta)}-app-icons.zip", "application/zip")
    response.headers["X-Pixels-Files"] = str(len(names))
    return response


@router.post("/api/images/{image_id}/presets/sizes")
async def export_sizes(request: Request, image_id: str, body: SizesBody) -> Response:
    found = _image_path(request, image_id)
    if isinstance(found, JSONResponse):
        return found
    path, meta = found
    try:
        rendered = await _render(request, path, body.state)
        data, names = await anyio.to_thread.run_sync(
            lambda: presets.sized_images(
                rendered,
                body.ids,
                mode=body.mode,
                focus=(body.focus_x, body.focus_y),
                background=body.background,
                export=body.export,
            )
        )
    except (GeometryError, ValueError) as exc:
        return _error("bad_request", str(exc))
    response = _download(data, f"{_stem(meta)}-sizes.zip", "application/zip")
    response.headers["X-Pixels-Files"] = str(len(names))
    return response


@router.post("/api/batch/run")
async def run_batch(request: Request, body: BatchBody) -> Response:
    """Apply one recipe to many already-imported images. Returns a ZIP plus report.json."""
    state = request.app.state
    settings = state.settings
    if len(body.image_ids) > settings.max_batch_files:
        return _error(
            "batch_too_large", f"A batch can hold at most {settings.max_batch_files} files.", 413
        )
    job_id = request.headers.get("x-job-id", "")
    job = {"id": job_id if is_valid_id(job_id) else new_id(), "name": f"Batch: {body.recipe.name}"}
    total = len(body.image_ids)
    state.hub.publish({**job, "status": "checking", "label": f"0 of {total}", "progress": 0.0})

    def work() -> bytes:
        files: dict[str, bytes] = {}
        report: list[dict[str, Any]] = []
        for index, image_id in enumerate(body.image_ids, start=1):
            entry: dict[str, Any] = {"image_id": image_id}
            found = _image_path(request, image_id) if is_valid_id(image_id) else None
            if found is None or isinstance(found, JSONResponse):
                entry.update(status="missing", error="No such image.")
            else:
                path, meta = found
                entry["name"] = meta.get("name")
                entry["security"] = (meta.get("gate") or {}).get("verdict")
                entry["metadata_removed"] = meta.get("metadata_removed", [])
                try:
                    encoded = run_recipe(
                        path, body.recipe, settings.max_render_pixels, meta.get("safe_exif")
                    )
                    name = f"{_stem(meta)}{body.recipe.suffix}.{encoded.extension}"
                    while name in files:
                        name = f"{_stem(meta)}{body.recipe.suffix}-{len(files)}.{encoded.extension}"
                    files[name] = encoded.data
                    entry.update(status="done", file=name)
                except (GeometryError, ValueError) as exc:
                    entry.update(status="failed", error=str(exc))
            report.append(entry)
            state.hub.publish(
                {
                    **job,
                    "status": "checking",
                    "label": f"{index} of {total}",
                    "progress": index / total,
                }
            )
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, data in files.items():
                archive.writestr(name, data)
            archive.writestr(
                "report.json", json.dumps({"recipe": body.recipe.name, "files": report}, indent=2)
            )
        return buffer.getvalue()

    async with state.render_slots:
        data = await anyio.to_thread.run_sync(work)
    state.hub.publish({**job, "status": "done", "label": f"{total} processed", "progress": 1.0})
    return _download(
        data,
        f"batch-{re.sub(r'[^A-Za-z0-9_-]+', '-', body.recipe.name)[:40] or 'recipe'}.zip",
        "application/zip",
    )


@router.post("/api/projects/save")
async def save_project(request: Request, body: ProjectSaveBody) -> Response:
    found = _image_path(request, body.image_id)
    if isinstance(found, JSONResponse):
        return found
    path, meta = found
    named = body.project.model_copy(update={"safe_exif": meta.get("safe_exif")})
    store = request.app.state.store

    def work() -> bytes:
        layer_pngs = {}
        for layer_id in project.layer_image_ids(named):
            layer_path = store.png_path(layer_id)
            if not layer_path.is_file():
                raise project.ProjectError("A layer's picture is no longer available.")
            layer_pngs[layer_id] = layer_path.read_bytes()
        return project.save(named, path.read_bytes(), layer_pngs)

    try:
        data = await anyio.to_thread.run_sync(work)
    except project.ProjectError as exc:
        return _error("bad_project", str(exc))
    return _download(data, f"{_stem({'name': body.project.name})}.pxe", "application/octet-stream")


@router.post("/api/projects/open")
async def open_project(request: Request) -> Response:
    """The project file is untrusted: its image goes back through the whole Security Gate."""
    state = request.app.state
    settings = state.settings
    limit = settings.max_file_bytes + 8 * 1024 * 1024
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        return _error("file_too_large", "The project file is too large.", 413)
    received, chunks = 0, []
    async for chunk in request.stream():
        received += len(chunk)
        if received > limit:
            return _error("file_too_large", "The project file is too large.", 413)
        chunks.append(chunk)
    job_id = request.headers.get("x-job-id", "")
    name = _clean_filename(request.headers.get("x-filename", "project.pxe"))
    job = {"id": job_id if is_valid_id(job_id) else new_id(), "name": name}
    try:
        parsed, original, layer_pngs = await anyio.to_thread.run_sync(
            project.load, b"".join(chunks), settings.max_file_bytes
        )
    except project.ProjectError as exc:
        state.security_log.rejected(name, "bad_project", "polyglot", str(exc))
        state.hub.publish({**job, "status": "failed", "error": str(exc), "progress": 1.0})
        return _error("bad_project", str(exc))

    workdir = settings.spool_dir / new_id()
    workdir.mkdir(parents=True)
    try:
        upload, clean = workdir / "upload.bin", workdir / "clean.png"
        upload.write_bytes(original)
        response = await gate_and_store(state, upload, clean, f"{parsed.name}.png", job)
        # every layer picture is untrusted too: each one goes through the whole gate and gets a new id
        new_ids: dict[str, str] = {}
        for index, (old_id, png) in enumerate(sorted(layer_pngs.items()), start=1):
            layer_upload, layer_clean = workdir / f"layer{index}.bin", workdir / f"layer{index}.png"
            layer_upload.write_bytes(png)
            layer_response = await gate_and_store(
                state,
                layer_upload,
                layer_clean,
                f"{parsed.name}-layer{index}.png",
                {"id": new_id(), "name": f"{name} (layer {index})"},
            )
            new_ids[old_id] = json.loads(bytes(layer_response.body))["id"]
        if new_ids:
            parsed = project.remap_layer_images(parsed, new_ids)
    except GateRejection as rejection:
        state.security_log.rejected(name, rejection.code, rejection.step, rejection.message)
        state.hub.publish({**job, "status": "failed", "error": rejection.message, "progress": 1.0})
        return JSONResponse(rejection.to_json(), status_code=rejection.status_code)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    payload = json.loads(bytes(response.body))
    payload["project"] = parsed.model_dump(mode="json")
    return JSONResponse(payload, status_code=201)


# --- pixel art ---------------------------------------------------------------------------------------
BASE_CACHE_SIZE = 4


class PixelPreviewBody(_Body):
    state: EditState
    max_edge: int = Field(default=1600, ge=64, le=4096)


def _base_key(image_id: str, state: EditState) -> str:
    plain = state.model_copy(update={"pixelart": None})
    return (
        image_id
        + ":"
        + hashlib.sha1(plain.model_dump_json().encode(), usedforsecurity=False).hexdigest()
    )


@router.get("/api/pixelart/palettes")
async def pixel_palettes() -> dict[str, Any]:
    return {
        "palettes": [
            {"id": name, "label": label, "colors": ["#" + c.lower() for c in colors]}
            for name, label, colors in (
                ("gameboy", "Game Boy", pixelart.PALETTES["gameboy"]),
                ("pico8", "PICO-8", pixelart.PALETTES["pico8"]),
                ("nes", "NES", pixelart.PALETTES["nes"]),
                ("c64", "Commodore 64", pixelart.PALETTES["c64"]),
                ("cga", "CGA", pixelart.PALETTES["cga"]),
                ("endesga32", "Endesga 32", pixelart.PALETTES["endesga32"]),
            )
        ]
    }


@router.post("/api/pixelart/import-palette")
async def import_palette(request: Request) -> Response:
    """A .hex or GIMP .gpl palette as plain text. Parsed, validated and returned as hex colours."""
    raw = await request.body()
    if len(raw) > 200_000:
        return _error("file_too_large", "A palette file is a small text file.", 413)
    colors = pixelart.parse_palette_text(raw.decode("utf-8", "replace"))
    if len(colors) < 2:
        return _error(
            "bad_palette",
            "No colours were found. Use one RRGGBB per line (.hex) or a GIMP .gpl file.",
        )
    return JSONResponse({"colors": colors})


@router.post("/api/images/{image_id}/pixelart/preview")
async def pixel_preview(request: Request, image_id: str, body: PixelPreviewBody) -> Response:
    """The edited picture turned into pixel art. The expensive part (geometry and adjustments) is cached,
    so dragging a pixel-art slider only recomputes the small pixel grid."""
    if body.state.pixelart is None:
        return _error("bad_request", "Send a pixelart section in the state.")
    found = _image_path(request, image_id)
    if isinstance(found, JSONResponse):
        return found
    path, _meta = found
    settings = request.app.state.settings
    cache: dict[str, Any] = request.app.state.__dict__.setdefault("pixel_base_cache", {})
    key = _base_key(image_id, body.state)
    load_layer = _layer_loader(request)

    def work() -> tuple[bytes, dict[str, Any]]:
        import numpy as np
        from PIL import Image

        base = cache.pop(key, None)
        if base is None:
            base = render_composite(
                load_rgba(path), body.state, settings.max_render_pixels, load_layer
            )
        cache[key] = base  # most recently used goes last
        while len(cache) > BASE_CACHE_SIZE:
            cache.pop(next(iter(cache)))
        result, info = pixelart.apply(base, body.state.pixelart)  # type: ignore[arg-type]
        h, w = result.shape[:2]
        scale = min(1.0, body.max_edge / max(h, w))
        image = Image.fromarray(np.round(np.clip(result, 0, 1) * 255).astype(np.uint8), "RGBA")
        if scale < 1.0:
            image = image.resize(
                (max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.NEAREST
            )
        buffer = io.BytesIO()
        image.save(buffer, "PNG", compress_level=1)
        info["size"] = [w, h]
        return buffer.getvalue(), info

    try:
        async with request.app.state.render_slots:
            data, info = await anyio.to_thread.run_sync(work)
    except (GeometryError, ValueError) as exc:
        return _error("bad_edit", str(exc))
    headers = {
        "Cache-Control": "no-store",
        "X-Pixelart-Info": json.dumps(
            {
                "grid": info["grid"],
                "colors": info["colors"],
                "palette": info["palette"],
                "notes": info["notes"],
                "size": info["size"],
            }
        ),
        "Access-Control-Expose-Headers": "X-Pixelart-Info",
    }
    return Response(data, media_type="image/png", headers=headers)


# --- eraser --------------------------------------------------------------------------------------------
class EraseBody(_Body):
    state: EditState
    mask_w: int = Field(ge=1, le=20_000)
    mask_h: int = Field(ge=1, le=20_000)
    mask_bits: str = Field(
        max_length=60_000_000
    )  # base64 of the packed bits (row-major, 1 = erase)
    quality: Literal["fast", "high"] = "high"
    grow: int = Field(default=6, ge=0, le=60)
    feather: float = Field(default=3.0, ge=0, le=30)


@router.post("/api/images/{image_id}/erase")
async def erase_object(request: Request, image_id: str, body: EraseBody) -> Response:
    """Remove the painted area. The edits made so far are baked in and the result becomes a new working
    copy (its own image id), so the previous version stays available for undo."""
    found = _image_path(request, image_id)
    if isinstance(found, JSONResponse):
        return found
    path, meta = found
    state = request.app.state
    settings = state.settings
    try:
        packed = base64.b64decode(body.mask_bits, validate=True)
        mask = inpaint.unpack_mask(packed, body.mask_w, body.mask_h)
    except (ValueError, binascii.Error) as exc:
        return _error("bad_mask", f"The mask is not valid: {exc}")

    def work() -> tuple[Path, dict[str, Any]]:
        import numpy as np
        from PIL import Image

        edited = body.state.model_copy(update={"pixelart": None})
        base = render_base(load_rgba(path), edited, settings.max_render_pixels)
        h, w = base.shape[:2]
        full_mask = inpaint.fit_mask(mask, w, h)
        if not full_mask.any():
            raise ValueError("Paint over the thing you want to remove first.")
        result = inpaint.erase(
            base, full_mask, inpaint.EraseOptions(body.quality, body.grow, body.feather)
        )
        has_alpha = bool((result[..., 3] < 0.999).any())
        rgba = np.round(np.clip(result, 0, 1) * 255).astype(np.uint8)
        workdir = settings.spool_dir / new_id()
        workdir.mkdir(parents=True)
        out = workdir / "erased.png"
        picture = (
            Image.fromarray(rgba, "RGBA") if has_alpha else Image.fromarray(rgba[..., :3], "RGB")
        )
        picture.save(out, "PNG", compress_level=3)
        return out, {
            **meta,
            "width": w,
            "height": h,
            "has_alpha": has_alpha,
            "derived_from": image_id,
        }

    try:
        async with state.render_slots:
            out, new_meta = await anyio.to_thread.run_sync(work)
    except (GeometryError, ValueError) as exc:
        return _error("bad_edit", str(exc))
    new = new_id()
    try:
        state.store.adopt(new, out, new_meta)
    finally:
        shutil.rmtree(out.parent, ignore_errors=True)
    keys = (
        "source_format",
        "metadata_removed",
        "icc_applied",
        "orientation_applied",
        "frames",
        "safe_exif",
    )
    return JSONResponse(
        {
            "id": new,
            "url": f"/api/images/{new}",
            "name": new_meta.get("name", "image"),
            "width": new_meta["width"],
            "height": new_meta["height"],
            "has_alpha": new_meta["has_alpha"],
            "gate": new_meta.get("gate"),
            "meta": {k: new_meta.get(k) for k in keys},
        },
        status_code=201,
    )
