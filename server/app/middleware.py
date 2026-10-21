"""Network hardening as a single pure-ASGI middleware.

* Host header allow-list: stops DNS-rebinding pages from reaching the loopback server.
* Origin check on every state-changing request and every WebSocket: stops other websites from
  posting to 127.0.0.1. There are no CORS headers at all: the app is same-origin only.
* Access token for LAN mode.
* Security headers, including a strict Content-Security-Policy.
"""

from __future__ import annotations

import secrets
from urllib.parse import urlsplit

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import LOOPBACK_HOSTS, Settings

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
LOOPBACK_NAMES = LOOPBACK_HOSTS | {"[::1]"}
TOKEN_HEADER = "x-pixels-token"  # noqa: S105 - header name, not a secret


def host_name(host_header: str) -> str:
    """'localhost:8765' -> 'localhost', '[::1]:8765' -> '[::1]'."""
    if host_header.startswith("["):
        return host_header.split("]")[0] + "]"
    return host_header.rsplit(":", 1)[0] if ":" in host_header else host_header


def content_security_policy(host_header: str) -> str:
    return "; ".join(
        [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self'",
            "img-src 'self' blob: data:",
            "font-src 'self'",
            f"connect-src 'self' ws://{host_header}",
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
            "frame-ancestors 'none'",
        ]
    )


class Guard:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        host_header = headers.get("host", "")
        denial = self._deny_reason(scope, headers, host_header)
        if denial is not None:
            await self._reject(scope, receive, send, *denial)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                out = MutableHeaders(scope=message)
                out["Content-Security-Policy"] = content_security_policy(host_header)
                out["X-Content-Type-Options"] = "nosniff"
                out["Referrer-Policy"] = "no-referrer"
                out["X-Frame-Options"] = "DENY"
                out["Cross-Origin-Opener-Policy"] = "same-origin"
                out["Cross-Origin-Resource-Policy"] = "same-origin"
                out["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
            await send(message)

        await self.app(scope, receive, send_with_headers)

    def _deny_reason(
        self, scope: Scope, headers: Headers, host_header: str
    ) -> tuple[int, str] | None:
        s = self.settings
        if not s.lan and host_name(host_header).lower() not in LOOPBACK_NAMES:
            return 421, "Unexpected Host header. Pixels only answers on localhost."

        origin = headers.get("origin")
        method = scope.get("method", "GET")
        if origin and (scope["type"] == "websocket" or method not in SAFE_METHODS):
            same_origin = urlsplit(origin).netloc == host_header
            if not same_origin and origin not in s.allowed_origins:
                return 403, "Cross-origin requests are not allowed."

        path: str = scope.get("path", "")
        if s.lan and (path.startswith("/api") or path.startswith("/ws")):
            supplied = headers.get(TOKEN_HEADER, "")
            if not supplied and scope["type"] == "websocket":
                query = dict(
                    item.split("=", 1)
                    for item in scope["query_string"].decode().split("&")
                    if "=" in item
                )
                supplied = query.get("token", "")
            if not secrets.compare_digest(supplied.encode(), (s.access_token or "").encode()):
                return 401, "Missing or wrong access token."
        return None

    async def _reject(
        self, scope: Scope, receive: Receive, send: Send, status: int, message: str
    ) -> None:
        if scope["type"] == "websocket":
            await receive()  # consume websocket.connect
            await send({"type": "websocket.close", "code": 1008})
            return
        response = JSONResponse({"code": "forbidden", "message": message}, status_code=status)
        await response(scope, receive, send)
