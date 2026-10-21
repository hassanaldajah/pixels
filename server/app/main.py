"""Application factory."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import anyio
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api import router
from app.api_edit import router as edit_router
from app.api_retouch import router as retouch_router
from app.config import Settings
from app.jobs import JobHub
from app.middleware import Guard
from app.storage import ImageStore
from security.gate import SecurityGate
from security.log import SecurityLog


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.ensure_dirs()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.hub.bind_loop(asyncio.get_running_loop())
        await anyio.to_thread.run_sync(
            app.state.store.purge_older_than, settings.image_retention_days
        )
        try:
            yield
        finally:
            app.state.security_log.close()

    app = FastAPI(
        title="Pixels",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,  # the Swagger UI loads scripts from a CDN
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.dev else None,
    )
    app.state.settings = settings
    app.state.hub = JobHub()
    app.state.store = ImageStore(settings.images_dir)
    app.state.security_log = SecurityLog(settings.security_log_path)
    app.state.gate = SecurityGate(settings)
    app.state.gate_slots = asyncio.Semaphore(settings.concurrent_gates)
    app.state.render_slots = asyncio.Semaphore(settings.concurrent_renders)
    app.state.batches = {}

    app.add_middleware(Guard, settings=settings)
    app.include_router(router)
    app.include_router(edit_router)
    app.include_router(retouch_router)
    if settings.web_dist is not None:
        app.mount("/", StaticFiles(directory=settings.web_dist, html=True), name="web")
    return app
