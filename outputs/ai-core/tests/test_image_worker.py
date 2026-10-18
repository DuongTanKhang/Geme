import io
import unittest

from PIL import Image, ImageDraw

from app.processor import (
    ImageProcessingError,
    _normalize_source_for_photoroom,
    _open_source,
    classify_product_image,
    compose_with_mask,
    convert_image,
    process_image,
)


def encode(image: Image.Image, image_format: str = "PNG", **options) -> bytes:
    target = io.BytesIO()
    image.save(target, format=image_format, **options)
    return target.getvalue()


def mask_png(size: tuple[int, int]) -> bytes:
    mask = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(mask).rectangle((20, 20, size[0] - 21, size[1] - 21), fill=(255, 255, 255, 255))
    return encode(mask)


class ImageWorkerTests(unittest.TestCase):
    def setUp(self):
        self.source = Image.new("RGB", (96, 96), (88, 91, 94))
        for x in range(28, 68):
            for y in range(24, 72):
                self.source.putpixel((x, y), (92, 38, 142))
        self.source_bytes = encode(self.source)
        self.mask_bytes = mask_png(self.source.size)

    def test_composite_preserves_fully_opaque_foreground_pixels(self):
        result, report = compose_with_mask(
            self.source_bytes,
            self.mask_bytes,
            "image/png",
            "emerald-ring.png",
            "STONE_GREY",
            "ring",
        )
        output = Image.open(io.BytesIO(result)).convert("RGB")
        for x in range(20, 76):
            for y in range(20, 76):
                if self.source.getpixel((x, y)) == (92, 38, 142):
                    self.assertEqual(output.getpixel((x, y)), (92, 38, 142))
        self.assertTrue(report["qc"]["opaqueForegroundPixelsPreserved"])
        self.assertIn("jewelry_structure_review", report["qc"]["flags"])

    def test_shadow_does_not_wrap_to_the_opposite_edge(self):
        _, report = compose_with_mask(
            self.source_bytes,
            self.mask_bytes,
            "image/png",
            "ring.png",
            "WARM_IVORY",
        )
        self.assertEqual(report["qc"]["dimensions"], {"width": 96, "height": 96})

    def test_rejects_mime_content_mismatch_and_bad_dimensions(self):
        with self.assertRaises(ImageProcessingError):
            _open_source(b"not an image", "image/png")
        with self.assertRaises(ImageProcessingError):
            _open_source(encode(Image.new("RGB", (32, 32))), "image/png")

    def test_classifier_marks_opal_and_transparent_risk(self):
        result = classify_product_image("opal-transparent-stone.png")
        self.assertEqual(result["suggestion"], "opal")
        self.assertIn("opal_color_review", result["riskFlags"])
        self.assertIn("transparent_stone_review", result["riskFlags"])
        self.assertTrue(result["needsReview"])

    def test_export_conversion_supports_png_jpeg_and_webp(self):
        for output_format, expected_mime in (
            ("png", "image/png"),
            ("jpeg", "image/jpeg"),
            ("webp", "image/webp"),
        ):
            converted, mime = convert_image(encode(self.source.convert("RGBA")), output_format)
            self.assertEqual(mime, expected_mime)
            with Image.open(io.BytesIO(converted)) as image:
                self.assertEqual(image.size, self.source.size)


    def test_exif_orientation_is_normalized_before_mask_generation(self):
        source = Image.new("RGB", (120, 80), (180, 120, 90))
        exif = Image.Exif()
        exif[274] = 6
        source_bytes = encode(source, "JPEG", exif=exif)
        normalized_bytes, size = _normalize_source_for_photoroom(source_bytes, "image/jpeg")
        self.assertEqual(size, (80, 120))
        with Image.open(io.BytesIO(normalized_bytes)) as normalized:
            self.assertEqual(normalized.format, "PNG")
            self.assertEqual(normalized.size, (80, 120))


if __name__ == "__main__":
    unittest.main()
