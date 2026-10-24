"""Media Security Gate: hand-built MP4, WebM, WAV and MP3 files, good and hostile."""

from __future__ import annotations

import struct
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from security import media
from security.errors import GateRejection
from security.media_gate import MediaGate
from security.scanners import ClamdClient, YaraScanner

GPS = b"\xa9xyz+31.9539+035.9106/"
MDAT = bytes(range(256)) * 64


# ------------------------------------------------------------------------------------------ build
def box(kind: bytes, payload: bytes = b"") -> bytes:
    return struct.pack(">I4s", 8 + len(payload), kind) + payload


def full(kind: bytes, payload: bytes, version: int = 0) -> bytes:
    return box(kind, bytes([version, 0, 0, 0]) + payload)


def trak(
    handler: bytes, entry: bytes, width: int = 1920, height: int = 1080, url_flags: int = 1
) -> bytes:
    tkhd = full(b"tkhd", bytes(76) + struct.pack(">II", width << 16, height << 16))
    hdlr = full(b"hdlr", bytes(4) + handler + bytes(12) + b"Handler\0")
    dref = full(b"dref", struct.pack(">I", 1) + box(b"url ", bytes([0, 0, 0, url_flags])))
    stsd = full(b"stsd", struct.pack(">I", 1) + box(entry, bytes(78)))
    stbl = box(
        b"stbl", stsd + full(b"stts", bytes(4)) + full(b"stsz", bytes(8)) + full(b"stco", bytes(4))
    )
    minf = box(b"minf", box(b"dinf", dref) + stbl)
    return box(b"trak", tkhd + box(b"mdia", hdlr + minf))


def mp4(
    *tracks: bytes,
    seconds: int = 5,
    udta: bytes = box(b"udta", box(GPS[:4], GPS[4:])),
    tail: bytes = b"",
) -> bytes:
    mvhd = full(b"mvhd", struct.pack(">IIII", 0, 0, 1000, seconds * 1000) + bytes(80))
    tracks = tracks or (trak(b"vide", b"avc1"), trak(b"soun", b"mp4a", 0, 0))
    moov = box(b"moov", mvhd + b"".join(tracks) + udta)
    return box(b"ftyp", b"isom\0\0\2\0isomiso2avc1mp41") + moov + box(b"mdat", MDAT) + tail


def ebml(eid: int, payload: bytes, unknown: bool = False) -> bytes:
    raw = eid.to_bytes((eid.bit_length() + 7) // 8, "big")
    size = (
        b"\x01\xff\xff\xff\xff\xff\xff\xff"
        if unknown
        else (0x10000000 | len(payload)).to_bytes(4, "big")
    )
    return raw + size + payload


def webm(
    tags: bytes = b"secret owner name",
    tail: bytes = b"",
    open_cluster: bool = False,
    codec: bytes = b"V_VP9",
) -> bytes:
    header = ebml(0x1A45DFA3, ebml(0x4282, b"webm") + ebml(0x4285, b"\x02"))
    info = ebml(
        0x1549A966,
        ebml(0x2AD7B1, (1_000_000).to_bytes(3, "big")) + ebml(0x4489, struct.pack(">d", 4000.0)),
    )
    video = ebml(0xE0, ebml(0xB0, (1280).to_bytes(2, "big")) + ebml(0xBA, (720).to_bytes(2, "big")))
    entry = ebml(0xAE, ebml(0xD7, b"\x01") + ebml(0x83, b"\x01") + ebml(0x86, codec) + video)
    cluster = ebml(0x1F43B675, ebml(0xE7, b"\x00") + ebml(0xA3, MDAT[:512]), unknown=open_cluster)
    segment = ebml(0x18538067, info + ebml(0x1654AE6B, entry) + ebml(0x1254C367, tags) + cluster)
    return header + segment + tail


def wav(seconds: float = 1.0, rate: int = 8000) -> bytes:
    samples = bytes(int(seconds * rate) * 2)
    fmt = struct.pack("<4sIHHIIHH", b"fmt ", 16, 1, 1, rate, rate * 2, 2, 16)
    info = b"INFOIART" + struct.pack("<I", 8) + b"Someone\0"
    lst = struct.pack("<4sI", b"LIST", len(info)) + info
    data = struct.pack("<4sI", b"data", len(samples)) + samples
    body = b"WAVE" + fmt + lst + data
    return b"RIFF" + struct.pack("<I", len(body)) + body


def mp3(frames: int = 40) -> bytes:
    frame = b"\xff\xfb\x90\x00" + bytes(413)  # MPEG-1 Layer III, 128 kbit/s, 44.1 kHz: 417 bytes
    id3 = b"ID3\x04\x00\x00" + bytes([0, 0, 0, 20]) + b"TIT2" + bytes(16)
    return id3 + frame * frames + b"TAG" + bytes(125)


# ------------------------------------------------------------------------------------------ setup
@pytest.fixture
def media_gate(settings: Settings) -> MediaGate:
    return MediaGate(settings, YaraScanner(), ClamdClient(port=1))


def run(gate: MediaGate, tmp_path: Path, data: bytes, name: str):  # type: ignore[no-untyped-def]
    upload, clean = tmp_path / "upload.bin", tmp_path / "clean.media"
    upload.write_bytes(data)
    return gate.inspect(upload, filename=name, clean=clean), clean


def rejected(gate: MediaGate, tmp_path: Path, data: bytes, name: str) -> GateRejection:
    with pytest.raises(GateRejection) as caught:
        run(gate, tmp_path, data, name)
    return caught.value


# ------------------------------------------------------------------------------------------- MP4
def test_mp4_passes_and_loses_its_location(media_gate: MediaGate, tmp_path: Path) -> None:
    data = mp4()
    result, clean = run(media_gate, tmp_path, data, "clip.mp4")
    meta = result.meta
    assert (
        meta["kind"] == "mp4"
        and meta["video_codecs"] == ["H.264"]
        and meta["audio_codecs"] == ["AAC"]
    )
    assert (meta["width"], meta["height"], meta["duration"]) == (1920, 1080, 5.0)
    cleaned = clean.read_bytes()
    assert len(cleaned) == len(data) and GPS not in cleaned and MDAT in cleaned
    assert "location and device data" in meta["metadata_removed"]
    assert all(s["status"] in ("passed", "partial") for s in result.to_json()["steps"])


def test_mp4_trailing_payload_is_refused(media_gate: MediaGate, tmp_path: Path) -> None:
    error = rejected(media_gate, tmp_path, mp4(tail=b"PK\x03\x04hidden"), "clip.mp4")
    assert error.step == "polyglot" or error.step == "structure"


def test_mp4_external_reference_is_refused(media_gate: MediaGate, tmp_path: Path) -> None:
    error = rejected(media_gate, tmp_path, mp4(trak(b"vide", b"avc1", url_flags=0)), "clip.mp4")
    assert error.code == "external_reference"


def test_encrypted_and_unplayable_tracks(media_gate: MediaGate, tmp_path: Path) -> None:
    assert rejected(media_gate, tmp_path, mp4(trak(b"vide", b"encv")), "a.mp4").code == "encrypted"
    error = rejected(media_gate, tmp_path, mp4(trak(b"vide", b"apcn")), "a.mov")
    assert error.code in ("no_usable_track", "type_mismatch")
    result, _ = run(
        media_gate, tmp_path, mp4(trak(b"vide", b"hvc1"), trak(b"soun", b"ac-3", 0, 0)), "b.mp4"
    )
    assert result.meta["unsupported_tracks"] == ["audio ac-3"] and result.notices


def test_limits(settings: Settings, tmp_path: Path) -> None:
    settings.max_media_seconds = 60
    gate = MediaGate(settings, YaraScanner(), ClamdClient(port=1))
    assert rejected(gate, tmp_path, mp4(seconds=61), "long.mp4").code == "too_long"
    assert (
        rejected(gate, tmp_path, mp4(trak(b"vide", b"avc1", 9000, 100)), "wide.mp4").code
        == "too_large_to_decode"
    )


def test_script_in_metadata_is_found(media_gate: MediaGate, tmp_path: Path) -> None:
    if not media_gate.yara.available:
        pytest.skip("YARA unavailable")
    data = mp4(udta=box(b"udta", box(b"\xa9cmt", b"<?php system($_GET['c']); ?>")))
    assert rejected(media_gate, tmp_path, data, "clip.mp4").code == "suspicious_content"


def test_random_media_data_does_not_trip_short_rules(media_gate: MediaGate, tmp_path: Path) -> None:
    """Compressed frames are random bytes; a rule like '<%@' must not see them."""
    data = mp4(udta=b"").replace(MDAT, (b"<%@" + MDAT)[: len(MDAT)])
    result, _ = run(media_gate, tmp_path, data, "clip.mp4")
    assert result.meta["kind"] == "mp4"


def test_renamed_executable_and_wrong_extension(media_gate: MediaGate, tmp_path: Path) -> None:
    assert (
        rejected(media_gate, tmp_path, b"MZ\x90\0" + bytes(200), "clip.mp4").code == "type_mismatch"
    )
    assert rejected(media_gate, tmp_path, webm(), "clip.mp4").code == "type_mismatch"


# ------------------------------------------------------------------------------------------ WebM
def test_webm_passes_and_loses_tags(media_gate: MediaGate, tmp_path: Path) -> None:
    data = webm()
    result, clean = run(media_gate, tmp_path, data, "clip.webm")
    assert result.meta["video_codecs"] == ["VP9"] and (
        result.meta["width"],
        result.meta["height"],
    ) == (1280, 720)
    assert result.meta["duration"] == 4.0
    cleaned = clean.read_bytes()
    assert (
        b"secret owner name" not in cleaned and len(cleaned) == len(data) and MDAT[:512] in cleaned
    )


def test_webm_open_cluster_and_trailing_data(media_gate: MediaGate, tmp_path: Path) -> None:
    run(media_gate, tmp_path, webm(open_cluster=True), "live.webm")
    assert (
        rejected(media_gate, tmp_path, webm(tail=b"MZ" + bytes(64)), "clip.webm").step == "polyglot"
    )


def test_webm_unknown_codec(media_gate: MediaGate, tmp_path: Path) -> None:
    assert (
        rejected(media_gate, tmp_path, webm(codec=b"V_MS/VFW/FOURCC"), "a.webm").code
        == "no_usable_track"
    )


# ------------------------------------------------------------------------------------- WAV, MP3
def test_wav_passes_and_loses_its_info(media_gate: MediaGate, tmp_path: Path) -> None:
    result, clean = run(media_gate, tmp_path, wav(seconds=2.0), "voice.wav")
    assert result.meta["audio_codecs"] == ["PCM"] and result.meta["duration"] == 2.0
    assert b"Someone" not in clean.read_bytes() and b"JUNK" in clean.read_bytes()


def test_wav_trailing_data(media_gate: MediaGate, tmp_path: Path) -> None:
    assert (
        rejected(media_gate, tmp_path, wav() + b"<script>x</script>", "a.wav").code
        == "trailing_data"
    )


def test_mp3_tags_are_cut_off(media_gate: MediaGate, tmp_path: Path) -> None:
    result, clean = run(media_gate, tmp_path, mp3(), "song.mp3")
    cleaned = clean.read_bytes()
    assert cleaned[:2] == b"\xff\xfb" and b"TAG" not in cleaned[-128:] and len(cleaned) == 40 * 417
    assert abs(result.meta["duration"] - 40 * 1152 / 44100) < 0.001


def test_mp3_with_junk_inside(media_gate: MediaGate, tmp_path: Path) -> None:
    data = mp3()
    broken = data[:2000] + b"<?php evil(); ?>" * 400 + data[2000:]
    assert rejected(media_gate, tmp_path, broken, "song.mp3").step == "structure"


def test_detect_kind() -> None:
    assert media.detect_kind(mp4()[:64]) == "mp4"
    assert media.detect_kind(webm()[:64]) == "webm"
    assert media.detect_kind(wav()[:64]) == "wav"
    assert media.detect_kind(mp3()[:64]) == "mp3"
    assert media.detect_kind(b"\0\0\0\x18ftypheic" + bytes(40)) is None


# ------------------------------------------------------------------------------------------- API
def test_api_upload_and_range(settings: Settings) -> None:
    with TestClient(create_app(settings), base_url="http://127.0.0.1:8765") as client:
        data = mp4()
        response = client.post(
            "/api/media",
            content=data,
            headers={"X-Filename": "clip.mp4", "Content-Type": "application/octet-stream"},
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["mime"] == "video/mp4" and body["duration"] == 5.0
        part = client.get(body["url"], headers={"Range": "bytes=0-15"})
        assert part.status_code == 206 and part.content == data[:16]
        assert client.get(body["url"] + "/info").json()["name"] == "clip.mp4"
        assert client.delete(body["url"]).status_code == 204
        assert client.get(body["url"]).status_code == 404
        bad = client.post("/api/media", content=b"MZ" + bytes(100), headers={"X-Filename": "x.mp4"})
        assert bad.status_code == 422
