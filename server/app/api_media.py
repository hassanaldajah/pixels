"""Video and audio: upload through the media Security Gate, then serve the clean copy with ranges."""

from __future__ import annotations

import shutil
from functools import partial

import anyio
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from app.api import _clean_filename, _rejection_response
from app.storage import is_valid_id, new_id
from security.errors import GateRejection

router = APIRouter()
NOT_FOUND = {"code": "not_found", "message": "No such video or audio file."}


@router.post("/api/media")
async def upload_media(request: Request) -> Response:
    """Raw-body upload, streamed to disk with a hard byte cap, then checked by the media gate."""
    state = request.app.state
    settings = state.settings
    filename = _clean_filename(request.headers.get("x-filename", "")) or "media"
    job_id = request.headers.get("x-job-id", "")
    job_id = job_id if is_valid_id(job_id) else new_id()
    job = {"id": job_id, "name": filename}
    limit = settings.max_media_bytes

    def log_and_fail(rejection: GateRejection) -> Response:
        state.security_log.rejected(filename, rejection.code, rejection.step, rejection.message)
        state.hub.publish({**job, "status": "failed", "error": rejection.message, "progress": 1.0})
        return _rejection_response(rejection)

    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        return log_and_fail(
            GateRejection(
                "file_too_large",
                "size",
                f"The file is {int(declared) / 1024**2:,.0f} MB; the limit is {limit / 1024**2:,.0f} MB.",
                413,
            )
        )

    workdir = settings.spool_dir / new_id()
    workdir.mkdir(parents=True)
    upload, clean = workdir / "upload.bin", workdir / "clean.media"
    state.hub.publish({**job, "status": "uploading", "label": "Receiving file", "progress": 0.0})
    try:
        received = 0
        with upload.open("wb") as sink:
            async for chunk in request.stream():
                received += len(chunk)
                if received > limit:
                    raise GateRejection(
                        "file_too_large",
                        "size",
                        f"The file is larger than the {limit / 1024**2:,.0f} MB limit.",
                        413,
                    )
                sink.write(chunk)

        def on_progress(step: str, label: str, done: int, total: int) -> None:
            state.hub.publish(
                {
                    **job,
                    "status": "checking",
                    "step": step,
                    "label": label,
                    "progress": done / total,
                }
            )

        state.hub.publish(
            {**job, "status": "queued", "label": "Waiting for a free scanner", "progress": 0.0}
        )
        async with state.gate_slots:
            result = await anyio.to_thread.run_sync(
                partial(
                    state.media_gate.inspect,
                    upload,
                    filename=filename,
                    clean=clean,
                    on_progress=on_progress,
                )
            )
        media_id = new_id()
        meta = {"name": filename, **result.meta, "gate": result.to_json()}
        state.media.adopt(media_id, clean, meta)
        state.hub.publish(
            {
                **job,
                "status": "done",
                "label": "Passed Pixels security checks",
                "progress": 1.0,
                "image_id": media_id,
            }
        )
        return JSONResponse(
            {"id": media_id, "url": f"/api/media/{media_id}", "name": filename, **result.meta,
             "gate": result.to_json()},
            status_code=201,
        )  # fmt: skip
    except GateRejection as rejection:
        return log_and_fail(rejection)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


@router.get("/api/media/{media_id}")
async def get_media(request: Request, media_id: str) -> Response:
    store = request.app.state.media
    meta = store.meta(media_id) if is_valid_id(media_id) else None
    if meta is None or not store.media_path(media_id).is_file():
        return JSONResponse(NOT_FOUND, 404)
    # FileResponse answers Range requests, so the browser reads only the parts it plays.
    return FileResponse(
        store.media_path(media_id),
        media_type=str(meta.get("mime", "application/octet-stream")),
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.get("/api/media/{media_id}/info")
async def get_media_info(request: Request, media_id: str) -> Response:
    meta = request.app.state.media.meta(media_id) if is_valid_id(media_id) else None
    return JSONResponse(meta) if meta is not None else JSONResponse(NOT_FOUND, 404)


@router.delete("/api/media/{media_id}")
async def delete_media(request: Request, media_id: str) -> Response:
    if is_valid_id(media_id) and request.app.state.media.delete(media_id):
        return Response(status_code=204)
    return JSONResponse(NOT_FOUND, 404)
