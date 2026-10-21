"""Module S: the Security Gate every image passes before any code touches its pixels.

The names below are imported on first use. The sandboxed decoder (security/worker.py) runs inside a
stripped-down environment and must be able to load this package without dragging in the whole server.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from security.errors import GateRejection
    from security.gate import GateResult, SecurityGate, StepResult

__all__ = ["GateRejection", "GateResult", "SecurityGate", "StepResult"]


def __getattr__(name: str) -> Any:
    if name == "GateRejection":
        from security.errors import GateRejection

        return GateRejection
    if name in ("GateResult", "SecurityGate", "StepResult"):
        from security import gate

        return getattr(gate, name)
    raise AttributeError(f"module 'security' has no attribute {name!r}")
