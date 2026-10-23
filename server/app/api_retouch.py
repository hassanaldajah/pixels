"""Retouch routes: cut out a background, smooth skin, enlarge. Each makes a new working copy of the image."""

from __future__ import annotations

import re
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

import anyio
import numpy as np
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from pydantic import Field, field_validator

from app.api_edit import _Body, _image_path, _why
from app.storage import new_id
from pipeline import retouch
from pipeline.errors import PublicError
from pipeline.geometry import GeometryError
from pipeline.ops import EditState
from pipeline.render import load_rgba, render_base

router = APIRouter()

HEX = re.compile(r"#[0-9a-fA-F]{6}")
Array = np.ndarray[Any, Any]


class _Retouch(_Body):
    state: EditState


class CutoutBody(_Retouch):
    tolerance: float = Field(default=30.0, ge=0, le=100)
    feather: float = Field(default=1.5, ge=0, le=20)
    contiguous: bool = True
    colour: str | None = None  # "#rrggbb"; None = the colour of the picture's border

    @field_validator("colour")
    @classmethod
    def _colour(cls, value: str | None) -> str | None:
        if value is not None and not HEX.fullmatch(value):
            raise PublicError("colour must be #rrggbb")
        return value


class SmoothBody(_Retouch):
    amount: float = Field(default=50.0, ge=0, le=100)
    radius: float = Field(default=8.0, ge=1, le=40)
    protect: float = Field(default=50.0, ge=0, le=100)


class UpscaleBody(_Retouch):
    factor: float = Field(default=2.0, ge=1.1, le=4.0)
    sharpen: float = Field(default=40.0, ge=0, le=100)


async def _derive(
    request: Request,
    image_id: str,
    state_in: EditState,
    make: Callable[[Array], Array],
    suffix: str,
) -> Response:
    """Render the edits so far, run `make` on the result and store it as a new image."""
    found = _image_path(request, image_id)
    if isinstance(found, JSONResponse):
        return found
    path, meta = found
    state = request.app.state
    settings = state.settings

    def work() -> tuple[Path, dict[str, Any]]:
        from PIL import Image

        edited = state_in.model_copy(update={"pixelart": None})
        base = render_base(load_rgba(path), edited, settings.max_render_pixels)
        result = make(base)
        h, w = result.shape[:2]
        if h * w > settings.max_render_pixels:
            raise PublicError("The result would be larger than this computer is set up to handle.")
        has_alpha = bool((result[..., 3] < 0.999).any())
        rgba = np.round(np.clip(result, 0, 1) * 255).astype(np.uint8)
        workdir = settings.spool_dir / new_id()
        workdir.mkdir(parents=True)
        out = workdir / f"{suffix}.png"
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
        return _why("bad_edit", exc)
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


def _rgb(value: str | None) -> tuple[float, float, float] | None:
    if value is None:
        return None
    return (int(value[1:3], 16) / 255, int(value[3:5], 16) / 255, int(value[5:7], 16) / 255)


@router.post("/api/images/{image_id}/retouch/cutout")
async def cutout(request: Request, image_id: str, body: CutoutBody) -> Response:
    colour = _rgb(body.colour)
    return await _derive(
        request,
        image_id,
        body.state,
        lambda base: retouch.cutout(base, body.tolerance, body.feather, body.contiguous, colour),
        "cutout",
    )


@router.post("/api/images/{image_id}/retouch/smooth")
async def smooth(request: Request, image_id: str, body: SmoothBody) -> Response:
    return await _derive(
        request,
        image_id,
        body.state,
        lambda base: retouch.smooth_skin(base, body.amount, body.radius, body.protect),
        "smooth",
    )


@router.post("/api/images/{image_id}/retouch/upscale")
async def upscale(request: Request, image_id: str, body: UpscaleBody) -> Response:
    return await _derive(
        request,
        image_id,
        body.state,
        lambda base: retouch.upscale(base, body.factor, body.sharpen),
        "upscale",
    )
