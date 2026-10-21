"""Gate rejections. `message` is shown to the user as-is, so it must be readable and specific."""

from __future__ import annotations

from typing import Any


class GateRejection(Exception):
    def __init__(
        self,
        code: str,
        step: str,
        message: str,
        status_code: int = 422,
        steps: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.step = step
        self.message = message
        self.status_code = status_code
        self.steps = steps or []

    def to_json(self) -> dict[str, Any]:
        return {"code": self.code, "step": self.step, "message": self.message, "steps": self.steps}
