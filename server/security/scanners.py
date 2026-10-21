"""Malware scanning: ClamAV (when a clamd daemon is reachable) and YARA rules shipped with Pixels."""

from __future__ import annotations

import logging
import socket
import struct
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger("pixels.security.scanners")

YARA_DIR = Path(__file__).parent / "yara"
CLAMD_CHUNK = 1024 * 1024


@dataclass(frozen=True)
class RuleHit:
    rule: str
    description: str


@dataclass(frozen=True)
class ClamVerdict:
    status: str  # "clean" | "infected" | "skipped" | "unavailable"
    detail: str = ""


class YaraScanner:
    """Compiles every *.yar file once and scans files with them. Uses yara-x."""

    def __init__(self, rules_dir: Path = YARA_DIR) -> None:
        self.error: str | None = None
        self.rule_count = 0
        self._rules: Any = None
        try:
            import yara_x

            compiler = yara_x.Compiler()
            files = sorted(rules_dir.glob("*.yar"))
            if not files:
                raise FileNotFoundError(f"no .yar files in {rules_dir}")
            for rule_file in files:
                compiler.add_source(rule_file.read_text(encoding="utf-8"), origin=str(rule_file))
            self._rules = compiler.build()
            self.rule_count = sum(1 for _ in self._rules)  # type: ignore[unused-ignore]
        except Exception as exc:  # the gate must keep working; the UI shows the notice
            self.error = f"{type(exc).__name__}: {exc}"
            log.warning("YARA rules unavailable: %s", self.error)

    @property
    def available(self) -> bool:
        return self._rules is not None

    def scan_file(self, path: Path, timeout_seconds: int = 60) -> list[RuleHit]:
        if self._rules is None:
            return []
        import yara_x

        scanner = yara_x.Scanner(self._rules)
        scanner.set_timeout(timeout_seconds)
        hits: list[RuleHit] = []
        for rule in scanner.scan_file(str(path)).matching_rules:
            meta = dict(rule.metadata)
            hits.append(RuleHit(rule.identifier, str(meta.get("description", rule.identifier))))
        return hits


class ClamdClient:
    """Minimal clamd INSTREAM client. No third-party dependency, no code executed from the file."""

    def __init__(
        self, host: str = "127.0.0.1", port: int = 3310, socket_path: str | None = None
    ) -> None:
        self.host, self.port, self.socket_path = host, port, socket_path
        self._checked_at = 0.0
        self._available = False

    def _connect(self, timeout: float) -> socket.socket:
        if self.socket_path and hasattr(socket, "AF_UNIX"):
            conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            conn.settimeout(timeout)
            conn.connect(self.socket_path)
            return conn
        return socket.create_connection((self.host, self.port), timeout=timeout)

    def available(self, max_age_seconds: float = 30.0) -> bool:
        now = time.monotonic()
        if now - self._checked_at < max_age_seconds:
            return self._available
        self._checked_at = now
        try:
            with self._connect(2.0) as conn:
                conn.sendall(b"zPING\0")
                self._available = conn.recv(16).strip(b"\0\n") == b"PONG"
        except OSError:
            self._available = False
        return self._available

    def scan_file(self, path: Path) -> ClamVerdict:
        if not self.available():
            return ClamVerdict("unavailable", "clamd is not running")
        try:
            with self._connect(120.0) as conn, path.open("rb") as handle:
                conn.sendall(b"zINSTREAM\0")
                try:
                    while chunk := handle.read(CLAMD_CHUNK):
                        conn.sendall(struct.pack("!I", len(chunk)) + chunk)
                    conn.sendall(struct.pack("!I", 0))
                except OSError:
                    pass  # clamd closes early when it rejects the stream; read its reason below
                reply = b""
                try:
                    while part := conn.recv(4096):
                        reply += part
                        if reply.endswith(b"\0"):
                            break
                except OSError:
                    pass
        except OSError as exc:
            self._checked_at = 0.0
            return ClamVerdict("unavailable", f"clamd connection failed: {exc}")
        return self._parse(reply.decode("utf-8", "replace").strip("\0\n "))

    @staticmethod
    def _parse(text: str) -> ClamVerdict:
        if text.endswith("OK"):
            return ClamVerdict("clean")
        if text.endswith("FOUND"):
            signature = text.removeprefix("stream:").removesuffix("FOUND").strip()
            return ClamVerdict("infected", signature or "malware signature")
        if "size limit exceeded" in text.lower():
            return ClamVerdict("skipped", "file is larger than clamd's StreamMaxLength")
        return ClamVerdict("unavailable", text or "empty reply from clamd")
