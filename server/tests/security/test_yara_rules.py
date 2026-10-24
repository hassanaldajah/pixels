"""The shipped YARA rules: they find real payloads and ignore random bytes in compressed pixels."""

from __future__ import annotations

import os

import pytest

from security.scanners import YaraScanner


@pytest.fixture(scope="module")
def yara() -> YaraScanner:
    scanner = YaraScanner()
    if not scanner.available:
        pytest.skip("YARA unavailable")
    return scanner


def test_real_server_code_is_found(yara: YaraScanner) -> None:
    for payload in (
        b'<%@ Page Language="C#" %><% Response.Write("x") %>',
        b"<%@language=vbscript%>",
        b"<?php system($_GET['c']); ?>",
        b"<script>alert(1)</script>",
    ):
        assert yara.scan_bytes(b"\x89PNG\r\n" + payload + os.urandom(64)), payload


def test_three_random_bytes_are_not_code(yara: YaraScanner) -> None:
    """The pictures that were wrongly rejected had '<%@' inside their compressed pixels."""
    data = (
        os.urandom(4096) + b"<%@qG92\x8f\x13" + os.urandom(4096) + b"<%@\x00\x01" + os.urandom(512)
    )
    assert yara.scan_bytes(data) == []
