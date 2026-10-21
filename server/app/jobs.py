"""Job progress over WebSocket. Events come from real pipeline steps, never from a timer."""

from __future__ import annotations

import asyncio
import contextlib
from collections import OrderedDict
from typing import Any

from fastapi import WebSocket

MAX_REMEMBERED_JOBS = 50


class JobHub:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._jobs: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._clients.add(websocket)
        await websocket.send_json({"type": "snapshot", "jobs": list(self._jobs.values())})

    def disconnect(self, websocket: WebSocket) -> None:
        self._clients.discard(websocket)

    def publish(self, event: dict[str, Any]) -> None:
        """Safe to call from any thread."""
        if self._loop is None or self._loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(self._broadcast(event), self._loop)

    async def _broadcast(self, event: dict[str, Any]) -> None:
        job_id = str(event["id"])
        self._jobs[job_id] = {**self._jobs.get(job_id, {}), **event}
        self._jobs.move_to_end(job_id)
        while len(self._jobs) > MAX_REMEMBERED_JOBS:
            self._jobs.popitem(last=False)
        payload = {"type": "job", **self._jobs[job_id]}
        for client in list(self._clients):
            try:
                await client.send_json(payload)
            except Exception:
                self._clients.discard(client)
                with contextlib.suppress(Exception):
                    await client.close()
