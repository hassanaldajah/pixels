"""The Security Gate must reject every malicious fixture and accept the valid ones."""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from app.config import Settings
from security.errors import GateRejection
from security.gate import STEPS, SecurityGate

from . import fixtures as fx


def run(gate: SecurityGate, settings: Settings, data: bytes, name: str):  # type: ignore[no-untyped-def]
    job = settings.spool_dir / "job"
    job.mkdir(parents=True, exist_ok=True)
    upload = job / "upload.bin"
    upload.write_bytes(data)
    return gate.inspect(upload, filename=name, clean_png=job / "clean.png")


def reject(gate: SecurityGate, settings: Settings, data: bytes, name: str) -> GateRejection:
    with pytest.raises(GateRejection) as caught:
        run(gate, settings, data, name)
    return caught.value


# --- the valid image ---------------------------------------------------------------------------


def test_valid_png_is_accepted(gate: SecurityGate, settings: Settings) -> None:
    result = run(gate, settings, fx.valid_png(), "photo.png")
    assert result.meta["width"] == 64 and result.meta["height"] == 48
    assert [s.id for s in result.steps] == [sid for sid, _ in STEPS]
    assert all(s.status in ("passed", "partial") for s in result.steps)
    with Image.open(result.clean_path) as clean:
        assert clean.format == "PNG" and clean.size == (64, 48)


@pytest.mark.parametrize(
    ("builder", "name", "kind"),
    [
        (fx.valid_jpeg, "a.jpg", "jpeg"),
        (fx.valid_webp, "a.webp", "webp"),
        (fx.valid_tiff, "a.tif", "tiff"),
        (fx.valid_bmp, "a.bmp", "bmp"),
        (fx.valid_avif, "a.avif", "avif"),
        (fx.valid_heic, "a.heic", "heif"),
        (fx.valid_png_rgba, "a.png", "png"),
    ],
)
def test_every_allowed_format_is_accepted(
    gate: SecurityGate, settings: Settings, builder, name: str, kind: str  # type: ignore[no-untyped-def]
) -> None:
    result = run(gate, settings, builder(), name)
    assert result.meta["detected_kind"] == kind


def test_rgba_alpha_survives(gate: SecurityGate, settings: Settings) -> None:
    result = run(gate, settings, fx.valid_png_rgba(), "a.png")
    assert result.meta["has_alpha"] is True
    with Image.open(result.clean_path) as clean:
        assert clean.mode == "RGBA"


def test_file_without_extension_is_judged_by_content(
    gate: SecurityGate, settings: Settings
) -> None:
    assert run(gate, settings, fx.valid_png(), "clipboard").meta["detected_kind"] == "png"


# --- hostile files -----------------------------------------------------------------------------


def test_renamed_executable_is_rejected(gate: SecurityGate, settings: Settings) -> None:
    rejection = reject(gate, settings, fx.renamed_executable(), "photo.png")
    assert rejection.code == "type_mismatch" and rejection.step == "magic"
    assert "Windows executable" in rejection.message


def test_zip_appended_to_png_is_rejected(gate: SecurityGate, settings: Settings) -> None:
    rejection = reject(gate, settings, fx.zip_in_png(), "holiday.png")
    assert rejection.step == "polyglot"
    assert rejection.code in {"trailing_data", "embedded_archive"}


def test_zip_hidden_inside_jpeg_comment_is_rejected(gate: SecurityGate, settings: Settings) -> None:
    rejection = reject(gate, settings, fx.zip_hidden_in_jpeg_comment(), "x.jpg")
    assert rejection.step == "polyglot" and rejection.code == "embedded_archive"


def test_truncated_jpeg_is_rejected(gate: SecurityGate, settings: Settings) -> None:
    rejection = reject(gate, settings, fx.truncated_jpeg(), "cut.jpg")
    assert rejection.step == "structure" and rejection.code == "corrupt_image"


def test_decompression_bomb_is_rejected_before_decoding(
    gate: SecurityGate, settings: Settings
) -> None:
    rejection = reject(gate, settings, fx.decompression_bomb(), "bomb.png")
    assert rejection.step == "bomb" and rejection.code == "decompression_bomb"


def test_pixel_limit_is_configurable(settings: Settings) -> None:
    settings.max_pixels = 1_000
    rejection = reject(SecurityGate(settings), settings, fx.valid_png(), "big.png")
    assert rejection.code == "decompression_bomb"


def test_script_in_exif_is_rejected(gate: SecurityGate, settings: Settings) -> None:
    rejection = reject(gate, settings, fx.jpeg_with_script_in_exif(), "pic.jpg")
    assert rejection.step == "malware" and rejection.code == "suspicious_content"


def test_php_shell_in_png_text_chunk_is_rejected(gate: SecurityGate, settings: Settings) -> None:
    rejection = reject(gate, settings, fx.php_in_png_text_chunk(), "avatar.png")
    assert rejection.step == "malware"


@pytest.mark.parametrize(
    ("builder", "name", "step"),
    [
        (fx.svg_file, "logo.svg", "allowlist"),
        (fx.svg_file, "logo.png", "allowlist"),
        (fx.gif_file, "anim.gif", "allowlist"),
        (fx.html_file, "page.html", "allowlist"),
    ],
)
def test_formats_outside_the_allowlist_are_rejected(
    gate: SecurityGate, settings: Settings, builder, name: str, step: str  # type: ignore[no-untyped-def]
) -> None:
    rejection = reject(gate, settings, builder(), name)
    assert rejection.step in (step, "magic")
    assert rejection.code in {"format_not_allowed", "type_mismatch"}


def test_extension_mismatch_between_real_images_is_rejected_by_default(
    gate: SecurityGate, settings: Settings
) -> None:
    rejection = reject(gate, settings, fx.valid_jpeg(), "actually-a-jpeg.png")
    assert rejection.code == "type_mismatch"


def test_extension_mismatch_can_be_relaxed(settings: Settings) -> None:
    settings.strict_extension_match = False
    result = run(SecurityGate(settings), settings, fx.valid_jpeg(), "actually-a-jpeg.png")
    assert result.meta["detected_kind"] == "jpeg"


def test_oversized_file_is_rejected(settings: Settings) -> None:
    settings.max_file_bytes = 100
    rejection = reject(SecurityGate(settings), settings, fx.valid_png(), "a.png")
    assert rejection.code == "file_too_large" and rejection.status_code == 413


def test_empty_file_is_rejected(gate: SecurityGate, settings: Settings) -> None:
    assert reject(gate, settings, b"", "a.png").code == "empty_file"


def test_garbage_is_rejected(gate: SecurityGate, settings: Settings) -> None:
    assert reject(gate, settings, b"\x00\x01\x02" * 100, "a.png").step in {"magic", "allowlist"}


# --- sanitising --------------------------------------------------------------------------------


def test_metadata_is_stripped_and_orientation_applied(
    gate: SecurityGate, settings: Settings
) -> None:
    result = run(gate, settings, fx.jpeg_with_gps_and_orientation(6), "pic.jpg")
    assert result.meta["orientation_applied"] == 6
    assert (result.meta["width"], result.meta["height"]) == (20, 40)  # 40x20 rotated upright
    assert {"EXIF", "GPS location"} <= set(result.meta["metadata_removed"])
    with Image.open(result.clean_path) as clean:
        assert len(clean.getexif()) == 0
        assert not clean.info.get("icc_profile")
    assert b"FixtureCam" not in result.clean_path.read_bytes()
    assert b"Exif" not in result.clean_path.read_bytes()


def test_png_text_chunks_are_dropped(gate: SecurityGate, settings: Settings) -> None:
    result = run(gate, settings, fx.png_with_text_chunk(), "a.png")
    assert "text chunks" in result.meta["metadata_removed"]
    assert b"must not survive" not in result.clean_path.read_bytes()


def test_original_bytes_never_reach_the_output(gate: SecurityGate, settings: Settings) -> None:
    original = fx.valid_jpeg()
    result = run(gate, settings, original, "a.jpg")
    assert result.clean_path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert original not in result.clean_path.read_bytes()


def test_clamav_missing_is_a_notice_not_a_failure(gate: SecurityGate, settings: Settings) -> None:
    settings.clamd_port = 1  # nothing listens here
    result = run(SecurityGate(settings), settings, fx.valid_png(), "a.png")
    malware = next(s for s in result.steps if s.id == "malware")
    assert malware.status == "partial"
    assert any("ClamAV" in n for n in result.notices)


def test_clamav_can_be_made_mandatory(settings: Settings) -> None:
    settings.clamd_port = 1
    settings.clamav_required = True
    assert (
        reject(SecurityGate(settings), settings, fx.valid_png(), "a.png").code == "clamav_required"
    )


def test_rejection_reports_which_steps_ran(gate: SecurityGate, settings: Settings) -> None:
    rejection = reject(gate, settings, fx.zip_in_png(), "a.png")
    states = {s["id"]: s["status"] for s in rejection.steps}
    assert states["size"] == "passed" and states["magic"] == "passed"
    assert states["polyglot"] == "failed" and states["sandbox"] == "pending"


def test_status_describes_the_environment(gate: SecurityGate) -> None:
    status = gate.status()
    assert status["yara"]["available"] is True and status["yara"]["rules"] >= 5
    assert "png" in status["allowed_formats"] and "svg" not in status["allowed_formats"]
    assert status["sandbox"]["memory_limit"] is True


def test_spool_is_left_clean_by_the_gate_on_failure(gate: SecurityGate, settings: Settings) -> None:
    reject(gate, settings, fx.truncated_jpeg(), "a.jpg")
    assert not Path(settings.spool_dir / "job" / "clean.png").exists()
