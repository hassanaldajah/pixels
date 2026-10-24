"""HTTP and WebSocket routes."""

from __future__ import annotations

import shutil
import time
from functools import partial
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import anyio
from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response

from app import __version__
from app.storage import is_valid_id, new_id
from security.errors import GateRejection

router = APIRouter()
BATCH_TTL_SECONDS = 3600


def _clean_filename(raw: str) -> str:
    """Display name only. It is never used as a filesystem path."""
    name = unquote(raw).replace("\\", "/").rsplit("/", 1)[-1]
    return "".join(c for c in name if c.isprintable())[:200] or "image"


def _rejection_response(rejection: GateRejection) -> JSONResponse:
    return JSONResponse(rejection.to_json(), status_code=rejection.status_code)


@router.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@router.get("/api/system")
async def system(request: Request) -> dict[str, Any]:
    state = request.app.state
    return {
        "version": __version__,
        "limits": {
            "max_file_bytes": state.settings.max_file_bytes,
            "max_batch_files": state.settings.max_batch_files,
            "max_media_bytes": state.settings.max_media_bytes,
            "max_media_seconds": state.settings.max_media_seconds,
        },
    }


@router.get("/api/security/status")
async def security_status(request: Request) -> dict[str, Any]:
    gate = request.app.state.gate
    return await anyio.to_thread.run_sync(gate.status)


@router.post("/api/batches")
async def create_batch(request: Request) -> Response:
    settings = request.app.state.settings
    try:
        count = int((await request.json())["count"])
    except (ValueError, KeyError, TypeError):
        return JSONResponse({"code": "bad_request", "message": 'Send {"count": N}.'}, 400)
    if count < 1 or count > settings.max_batch_files:
        rejection = GateRejection(
            "batch_too_large",
            "size",
            f"A batch can hold at most {settings.max_batch_files} files; you selected {count}.",
            413,
        )
        request.app.state.security_log.rejected(
            "(batch)", rejection.code, rejection.step, rejection.message
        )
        return _rejection_response(rejection)
    batches: dict[str, dict[str, float]] = request.app.state.batches
    now = time.time()
    for key in [k for k, b in batches.items() if now - b["created"] > BATCH_TTL_SECONDS]:
        del batches[key]
    batch_id = new_id()
    batches[batch_id] = {"limit": count, "used": 0, "created": now}
    return JSONResponse({"id": batch_id, "count": count})


async def gate_and_store(
    state: Any, upload: Path, clean: Path, filename: str, job: dict[str, str]
) -> JSONResponse:
    """Run the Security Gate on `upload` and keep the sanitised result. Raises GateRejection."""

    def on_progress(step: str, label: str, done: int, total: int) -> None:
        state.hub.publish(
            {**job, "status": "checking", "step": step, "label": label, "progress": done / total}
        )

    state.hub.publish(
        {**job, "status": "queued", "label": "Waiting for a free scanner", "progress": 0.0}
    )
    async with state.gate_slots:
        result = await anyio.to_thread.run_sync(
            partial(
                state.gate.inspect,
                upload,
                filename=filename,
                clean_png=clean,
                on_progress=on_progress,
            )
        )
    image_id = new_id()
    meta = {"name": filename, **result.meta, "gate": result.to_json()}
    state.store.adopt(image_id, clean, meta)
    state.hub.publish(
        {
            **job,
            "status": "done",
            "label": "Passed Pixels security checks",
            "progress": 1.0,
            "image_id": image_id,
        }
    )
    return JSONResponse(
        {
            "id": image_id,
            "url": f"/api/images/{image_id}",
            "name": filename,
            "width": result.meta["width"],
            "height": result.meta["height"],
            "has_alpha": result.meta["has_alpha"],
            "gate": result.to_json(),
            "meta": result.meta,
        },
        status_code=201,
    )


@router.post("/api/images")
async def upload_image(request: Request) -> Response:
    """Raw-body upload. The body is streamed to disk with a hard byte cap, never buffered whole."""
    state = request.app.state
    settings = state.settings
    filename = _clean_filename(request.headers.get("x-filename", ""))
    job_id = request.headers.get("x-job-id", "")
    job_id = job_id if is_valid_id(job_id) else new_id()
    job = {"id": job_id, "name": filename}

    def log_and_fail(rejection: GateRejection) -> Response:
        state.security_log.rejected(filename, rejection.code, rejection.step, rejection.message)
        state.hub.publish({**job, "status": "failed", "error": rejection.message, "progress": 1.0})
        return _rejection_response(rejection)

    batch_id = request.query_params.get("batch")
    if batch_id:
        batch = state.batches.get(batch_id)
        if batch is None or batch["used"] >= batch["limit"]:
            return log_and_fail(
                GateRejection(
                    "batch_exhausted",
                    "size",
                    "This batch is unknown, expired or already full.",
                    409,
                )
            )
        batch["used"] += 1

    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > settings.max_file_bytes:
        return log_and_fail(
            GateRejection(
                "file_too_large",
                "size",
                f"The file is {int(declared) / 1024**2:,.0f} MB; the limit is "
                f"{settings.max_file_bytes / 1024**2:,.0f} MB.",
                413,
            )
        )

    workdir = settings.spool_dir / new_id()
    workdir.mkdir(parents=True)
    upload, clean = workdir / "upload.bin", workdir / "clean.png"
    state.hub.publish({**job, "status": "uploading", "label": "Receiving file", "progress": 0.0})
    try:
        received = 0
        with upload.open("wb") as sink:
            async for chunk in request.stream():
                received += len(chunk)
                if received > settings.max_file_bytes:
                    raise GateRejection(
                        "file_too_large",
                        "size",
                        f"The file is larger than the {settings.max_file_bytes / 1024**2:,.0f} MB limit.",
                        413,
                    )
                sink.write(chunk)

        return await gate_and_store(state, upload, clean, filename, job)
    except GateRejection as rejection:
        return log_and_fail(rejection)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


@router.get("/api/images/{image_id}")
async def get_image(request: Request, image_id: str) -> Response:
    if not is_valid_id(image_id):
        return JSONResponse({"code": "not_found", "message": "No such image."}, 404)
    path = request.app.state.store.png_path(image_id)
    if not path.is_file():
        return JSONResponse({"code": "not_found", "message": "No such image."}, 404)
    return FileResponse(
        path,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.get("/api/images/{image_id}/info")
async def get_image_info(request: Request, image_id: str) -> Response:
    meta = request.app.state.store.meta(image_id) if is_valid_id(image_id) else None
    if meta is None:
        return JSONResponse({"code": "not_found", "message": "No such image."}, 404)
    return JSONResponse(meta)


@router.delete("/api/images/{image_id}")
async def delete_image(request: Request, image_id: str) -> Response:
    if is_valid_id(image_id) and request.app.state.store.delete(image_id):
        return Response(status_code=204)
    return JSONResponse({"code": "not_found", "message": "No such image."}, 404)


@router.websocket("/ws/jobs")
async def jobs_socket(websocket: WebSocket) -> None:
    hub = websocket.app.state.hub
    await hub.connect(websocket)
    try:
        while True:
            await websocket.receive_text()  # clients send nothing; this detects disconnects
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(websocket)
