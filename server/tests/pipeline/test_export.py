from __future__ import annotations

import io
import struct
import zlib

import numpy as np
import pytest
import tifffile
from PIL import Image, ImageCms

from pipeline import icc
from pipeline.export import ExportOptions, encode

from .helpers import gradient

SAFE_EXIF = {
    "ifd0": {"271": "FixtureCam", "272": "Model X"},
    "exif": {"33437": [28, 10], "34855": 400},
    "gps": {"1": "N", "2": [[51, 1], [30, 1], [0, 1]], "3": "W", "4": [[0, 1], [7, 1], [0, 1]]},
}


def opts(**values) -> ExportOptions:  # type: ignore[no-untyped-def]
    return ExportOptions.model_validate(values)


def open_image(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))


@pytest.mark.parametrize("fmt", ["png", "jpeg", "webp", "avif", "tiff"])
def test_every_format_round_trips_to_the_right_size(fmt: str) -> None:
    src = gradient(24, 40)
    encoded = encode(src, opts(format=fmt))
    with open_image(encoded.data) as image:
        assert image.size == (40, 24)
        assert (
            image.format
            == {"jpeg": "JPEG", "png": "PNG", "webp": "WEBP", "avif": "AVIF", "tiff": "TIFF"}[fmt]
        )
    assert encoded.media_type.startswith("image/")


def test_png_is_lossless_at_8_bit() -> None:
    src = gradient(16, 16)
    with open_image(encode(src, opts(format="png")).data) as image:
        decoded = np.asarray(image.convert("RGB"), dtype=np.float32) / 255
    assert np.abs(decoded - src[..., :3]).max() <= 0.5 / 255 + 1e-6


def test_png_keeps_alpha_only_when_needed() -> None:
    assert open_image(encode(gradient(8, 8), opts(format="png")).data).mode == "RGB"
    assert open_image(encode(gradient(8, 8, alpha=0.5), opts(format="png")).data).mode == "RGBA"


def test_jpeg_flattens_alpha_onto_the_chosen_background() -> None:
    src = gradient(8, 8, alpha=0.0)
    with open_image(
        encode(src, opts(format="jpeg", background="#ff0000", quality=100)).data
    ) as image:
        r, g, b = image.convert("RGB").getpixel((4, 4))
    assert r > 240 and g < 15 and b < 15


def test_jpeg_quality_changes_the_size() -> None:
    src = gradient(64, 64)
    assert len(encode(src, opts(format="jpeg", quality=20)).data) < len(
        encode(src, opts(format="jpeg", quality=95)).data
    )


def test_webp_lossless_is_exact() -> None:
    src = gradient(16, 16)
    with open_image(encode(src, opts(format="webp", lossless=True)).data) as image:
        decoded = np.asarray(image.convert("RGB"), dtype=np.float32) / 255
    assert np.abs(decoded - src[..., :3]).max() <= 0.5 / 255 + 1e-6


def test_16_bit_tiff_has_real_16_bit_precision_and_an_icc_profile() -> None:
    src = np.zeros((4, 4, 4), dtype=np.float32)
    src[..., 3] = 1
    src[..., 0] = np.linspace(0, 1, 16, dtype=np.float32).reshape(4, 4)
    data = encode(src, opts(format="tiff", bit_depth=16)).data
    array = tifffile.imread(io.BytesIO(data))
    assert array.dtype == np.uint16 and array.shape == (4, 4, 3)
    assert (
        len(np.unique(array[..., 0])) == 16
    )  # 16 distinct levels survive; 8 bits would merge some
    assert array[0, 1, 0] == round(1 / 15 * 65535)
    with tifffile.TiffFile(io.BytesIO(data)) as tif:
        assert tif.pages[0].tags[34675].value  # type: ignore[union-attr]


def test_16_bit_png_header_and_pixels() -> None:
    src = gradient(6, 6)
    data = encode(src, opts(format="png", bit_depth=16)).data
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    width, height, depth, colour = struct.unpack(">IIBB", data[16:26])
    assert (width, height, depth, colour) == (6, 6, 16, 2)
    assert b"iCCP" in data
    # Decode the IDAT stream by hand and compare with the source.
    pos, idat = 8, b""
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos : pos + 8])
        if kind == b"IDAT":
            idat += data[pos + 8 : pos + 8 + length]
        pos += 12 + length
    rows = zlib.decompress(idat)
    stride = 1 + 6 * 3 * 2
    first_row = np.frombuffer(rows[1:stride], dtype=">u2").reshape(6, 3)
    assert np.abs(first_row / 65535 - src[0, :, :3]).max() < 1 / 65535 + 1e-6


def test_display_p3_profile_is_embedded_and_pixels_are_converted() -> None:
    red = np.zeros((2, 2, 4), dtype=np.float32)
    red[..., 0] = 1
    red[..., 3] = 1
    for fmt in ("png", "jpeg", "webp"):
        with open_image(
            encode(red, opts(format=fmt, profile="Display P3", quality=100)).data
        ) as image:
            profile = ImageCms.ImageCmsProfile(io.BytesIO(image.info["icc_profile"]))
            assert ImageCms.getProfileDescription(profile).strip() == "Display P3"
            r, g, b = image.convert("RGB").getpixel((0, 0))
            assert abs(r - 234) <= 3 and abs(g - 51) <= 4 and abs(b - 35) <= 4, fmt
    with open_image(encode(red, opts(format="png", profile="sRGB")).data) as image:
        assert image.convert("RGB").getpixel((0, 0)) == (255, 0, 0)
        assert (
            ImageCms.getProfileDescription(
                ImageCms.ImageCmsProfile(io.BytesIO(image.info["icc_profile"]))
            ).strip()
            == "sRGB"
        )


def test_generated_profiles_are_valid_for_littlecms() -> None:
    for name in ("sRGB", "Display P3"):
        data = icc.profile_bytes(name)
        assert int.from_bytes(data[:4], "big") == len(data) and data[36:40] == b"acsp"
        ImageCms.ImageCmsProfile(io.BytesIO(data))


def test_lcms_agrees_with_the_numeric_p3_conversion() -> None:
    srgb = ImageCms.createProfile("sRGB")
    p3 = ImageCms.ImageCmsProfile(io.BytesIO(icc.profile_bytes("Display P3")))
    transform = ImageCms.buildTransform(
        srgb, p3, "RGB", "RGB", renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC
    )
    samples = [(255, 0, 0), (0, 255, 0), (30, 140, 220), (128, 128, 128)]
    for rgb in samples:
        via_lcms = ImageCms.applyTransform(Image.new("RGB", (1, 1), rgb), transform).getpixel(
            (0, 0)
        )
        ours = icc.to_display_p3(np.array([[rgb]], dtype=np.float32) / 255)[0, 0] * 255
        assert max(abs(a - b) for a, b in zip(via_lcms, ours, strict=True)) <= 2.5, rgb


def test_exif_is_not_attached_unless_asked() -> None:
    data = encode(gradient(8, 8), opts(format="jpeg"), SAFE_EXIF).data
    assert len(open_image(data).getexif()) == 0


def test_camera_info_is_re_attached_without_gps_by_default() -> None:
    for fmt in ("jpeg", "png", "webp"):
        data = encode(gradient(8, 8), opts(format=fmt, keep_camera_info=True), SAFE_EXIF).data
        exif = open_image(data).getexif()
        assert exif.get(0x010F) == "FixtureCam" and exif.get(0x0110) == "Model X", fmt
        assert not exif.get_ifd(0x8825), fmt
        assert exif.get_ifd(0x8769).get(0x8827) == 400, fmt


def test_gps_is_only_written_when_explicitly_enabled() -> None:
    data = encode(
        gradient(8, 8), opts(format="jpeg", keep_camera_info=True, keep_gps=True), SAFE_EXIF
    ).data
    gps = open_image(data).getexif().get_ifd(0x8825)
    assert gps.get(1) == "N" and gps.get(3) == "W"


def test_options_are_validated() -> None:
    for bad in (
        {"format": "gif"},
        {"quality": 0},
        {"quality": 101},
        {"bit_depth": 12},
        {"background": "red"},
        {"extra": 1},
    ):
        with pytest.raises(ValueError):
            opts(**bad)
