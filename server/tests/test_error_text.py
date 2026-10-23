"""What the user is told when an edit fails: our own messages are shown, a library's own error text is not."""

from __future__ import annotations

import json

from app.api_edit import GENERIC, _text, _why
from pipeline.errors import PublicError
from pipeline.geometry import GeometryError
from pipeline.project import ProjectError


def test_our_own_messages_are_shown() -> None:
    for exc in (
        PublicError("Paint over it first."),
        GeometryError("bad quad"),
        ProjectError("not a project"),
    ):
        assert _text("bad_edit", exc) == str(exc)


def test_a_libraries_error_text_is_hidden() -> None:
    internal = ValueError(
        "operands could not be broadcast together with shapes (3,4) (5,) at C:/Users/x/file.py"
    )
    assert _text("bad_edit", internal) == GENERIC
    body = json.loads(_why("bad_edit", internal).body)
    assert body == {"code": "bad_edit", "message": GENERIC}
    assert "C:" not in body["message"] and "broadcast" not in body["message"]
