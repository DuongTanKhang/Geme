import io
from dataclasses import dataclass
from typing import Any

import httpx
from PIL import Image, ImageChops, ImageFilter, ImageOps, UnidentifiedImageError


MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
MAX_IMAGE_SIDE = 6_000
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
PRESETS = {
    "STONE_GREY": ("#D6D5D1", (214, 213, 209)),
    "WARM_IVORY": ("#EEE8DF", (238, 232, 223)),
    "SOFT_SAGE": ("#DCE3DA", (220, 227, 218)),
}


@dataclass
class ImageProcessingError(Exception):
    code: str
    status_code: int = 422


def _open_source(image_bytes: bytes, mime_type: str) -> Image.Image:
    if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
        raise ImageProcessingError("IMAGE_TOO_LARGE" if image_bytes else "EMPTY_IMAGE", 413 if image_bytes else 422)
    if mime_type.lower().split(";", 1)[0].strip() not in ALLOWED_MIME_TYPES:
        raise ImageProcessingError("UNSUPPORTED_IMAGE_TYPE")
    try:
        with Image.open(io.BytesIO(image_bytes)) as probe:
            if probe.format not in {"JPEG", "PNG", "WEBP"}:
                raise ImageProcessingError("UNSUPPORTED_IMAGE_TYPE")
            if probe.width < 64 or probe.height < 64 or probe.width * probe.height > MAX_IMAGE_PIXELS:
                raise ImageProcessingError("INVALID_IMAGE_DIMENSIONS")
            if max(probe.size) > MAX_IMAGE_SIDE:
                raise ImageProcessingError("IMAGE_DIMENSION_LIMIT_EXCEEDED")
            probe.verify()
        with Image.open(io.BytesIO(image_bytes)) as image:
            return ImageOps.exif_transpose(image).convert("RGBA")
    except ImageProcessingError:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ImageProcessingError("INVALID_IMAGE_DATA") from error


def _normalize_source_for_photoroom(image_bytes: bytes, mime_type: str) -> tuple[bytes, tuple[int, int]]:
    source = _open_source(image_bytes, mime_type)
    normalized = io.BytesIO()
    source.save(normalized, format="PNG", optimize=True)
    return normalized.getvalue(), source.size


async def _photoroom_mask(image_bytes: bytes, mime_type: str, api_key: str, sandbox: bool) -> bytes:
    if not api_key:
        raise ImageProcessingError("PHOTOROOM_NOT_CONFIGURED", 503)
    if sandbox and not api_key.startswith("sandbox_"):
        raise ImageProcessingError("PHOTOROOM_SANDBOX_KEY_REQUIRED", 503)

    filename = "source.webp" if mime_type == "image/webp" else "source.png" if mime_type == "image/png" else "source.jpg"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
            response = await client.post(
                "https://sdk.photoroom.com/v1/segment",
                headers={"x-api-key": api_key},
                data={"format": "png", "channels": "rgba", "size": "full", "crop": "false", "despill": "false"},
                files={"image_file": (filename, image_bytes, mime_type)},
            )
    except httpx.TimeoutException as error:
        raise ImageProcessingError("PHOTOROOM_TIMEOUT", 503) from error
    except httpx.HTTPError as error:
        raise ImageProcessingError("PHOTOROOM_UNAVAILABLE", 503) from error
    if response.status_code == 401 or response.status_code == 403:
        raise ImageProcessingError("PHOTOROOM_AUTH_FAILED", 503)
    if response.status_code == 429:
        raise ImageProcessingError("PHOTOROOM_RATE_LIMITED", 503)
    if response.status_code < 200 or response.status_code >= 300:
        raise ImageProcessingError("PHOTOROOM_REQUEST_FAILED", 502)
    if not response.content or len(response.content) > 40 * 1024 * 1024:
        raise ImageProcessingError("PHOTOROOM_OUTPUT_INVALID", 502)
    return response.content


def classify_product_image(filename: str, classification_hint: str = "") -> dict[str, Any]:
    """Suggest a label from admin metadata and filename; this is not a trained vision model."""
    labels = ["opal", "emerald", "jade", "ring", "bracelet", "silver", "gemstone", "jewelry"]
    normalized = f"{classification_hint} {filename}".casefold()
    aliases = {
        "opal": ("opal", "đá quý", "da quy"),
        "emerald": ("emerald", "emer", "lục bảo", "luc bao"),
        "jade": ("jade", "jadeite", "bạch ngọc", "ngoc bich", "vòng ngọc"),
        "ring": ("ring", "nhẫn", "nhan"),
        "bracelet": ("bracelet", "vòng tay", "vong tay"),
        "silver": ("silver", "bạc", "bac", "reflective", "polished"),
        "gemstone": ("gem", "stone", "đá", "da", "gemstone", "đá quý", "da quy"),
        "jewelry": ("jewelry", "jewel", "trang sức", "trang suc", "pendant", "necklace"),
    }
    matched = [label for label in labels if any(alias in normalized for alias in aliases[label])]
    if not matched:
        return {"suggestion": "unclassified", "confidence": 0.0, "method": "filename_and_admin_hint", "needsReview": True}
    risk_flags = []
    if "opal" in matched:
        risk_flags.append("opal_color_review")
    if "emerald" in matched or "jade" in matched or "gemstone" in matched:
        risk_flags.append("gemstone_color_review")
    if "ring" in matched or "bracelet" in matched or "jewelry" in matched:
        risk_flags.append("jewelry_structure_review")
    if "silver" in matched:
        risk_flags.append("reflective_metal_review")
    if any(term in normalized for term in ("transparent", "clear", "trong suốt", "trong suot")):
        risk_flags.append("transparent_stone_review")
    return {
        "suggestion": matched[0],
        "labels": matched,
        "confidence": 0.7 if classification_hint else 0.35,
        "method": "filename_and_admin_hint",
        "needsReview": True,
        "riskFlags": risk_flags,
    }


def compose_with_mask(
    source_bytes: bytes,
    mask_bytes: bytes,
    mime_type: str,
    filename: str,
    preset: str,
    classification_hint: str = "",
) -> tuple[bytes, dict[str, Any]]:
    source = _open_source(source_bytes, mime_type)
    if preset not in PRESETS:
        raise ImageProcessingError("INVALID_PRESET")
    try:
        with Image.open(io.BytesIO(mask_bytes)) as mask_image:
            if mask_image.format not in {"PNG", "WEBP"}:
                raise ImageProcessingError("INVALID_MASK_FORMAT", 502)
            mask_image.load()
            mask_rgba = mask_image.convert("RGBA")
    except ImageProcessingError:
        raise
    except (UnidentifiedImageError, OSError) as error:
        raise ImageProcessingError("INVALID_MASK_DATA", 502) from error

    if mask_rgba.size != source.size:
        raise ImageProcessingError("MASK_DIMENSIONS_MISMATCH", 502)
    alpha = mask_rgba.getchannel("A")
    source_alpha = source.getchannel("A")
    alpha = ImageChops.darker(alpha, source_alpha)
    bounds = alpha.point(lambda value: 255 if value > 16 else 0).getbbox()
    if not bounds:
        raise ImageProcessingError("EMPTY_FOREGROUND_MASK", 502)

    width, height = source.size
    foreground_pixels = sum(1 for value in alpha.getdata() if value > 16)
    area_ratio = foreground_pixels / (width * height)
    edge_pixels = sum(1 for value in alpha.getdata() if 8 < value < 248)
    edge_ratio = edge_pixels / (width * height)
    margin_x = max(2, int(width * 0.002))
    margin_y = max(2, int(height * 0.002))
    near_edge = bounds[0] <= margin_x or bounds[1] <= margin_y or bounds[2] >= width - margin_x or bounds[3] >= height - margin_y
    classification = classify_product_image(filename, classification_hint)
    flags = list(classification.get("riskFlags", []))
    if area_ratio < 0.01 or area_ratio > 0.92:
        flags.append("foreground_area_uncertain")
    if near_edge:
        flags.append("foreground_touches_frame")
    if edge_ratio > 0.08:
        flags.append("mask_edge_detail_review")
    if classification.get("needsReview") and not flags:
        flags.append("classification_uncertain")

    # Retain the source RGB layer; Photoroom contributes only the alpha mask.
    background_color = PRESETS[preset][1]
    background = Image.new("RGBA", (width, height), (*background_color, 255))

    shadow_alpha = alpha.filter(ImageFilter.GaussianBlur(radius=max(2, min(width, height) * 0.008)))
    shadow_offset = max(1, int(height * 0.012))
    shadow_alpha = shadow_alpha.transform(
        (width, height),
        Image.Transform.AFFINE,
        (1, 0, 0, 0, 1, -shadow_offset),
        fillcolor=0,
    )
    shadow_alpha = shadow_alpha.point(lambda value: int(value * 0.16))
    shadow = Image.new("RGBA", (width, height), (24, 27, 25, 0))
    shadow.putalpha(shadow_alpha)
    background.alpha_composite(shadow)

    foreground = source.copy()
    foreground.putalpha(alpha)
    background.alpha_composite(foreground)

    # Full-opacity subject pixels must be bit-identical to the orientation-normalized original.
    opaque = alpha.point(lambda value: 255 if value == 255 else 0)
    output_rgb = background.convert("RGB")
    source_rgb = source.convert("RGB")
    expected = Image.composite(source_rgb, Image.new("RGB", source.size), opaque)
    actual = Image.composite(output_rgb, Image.new("RGB", source.size), opaque)
    opaque_pixels_preserved = ImageChops.difference(expected, actual).getbbox() is None

    if not opaque_pixels_preserved:
        raise ImageProcessingError("FOREGROUND_PRESERVATION_CHECK_FAILED", 500)
    output = io.BytesIO()
    background.save(output, format="PNG", optimize=True)
    qc_status = "REVIEW" if flags else "PASS"
    report = {
        "classification": classification,
        "qc": {
            "status": qc_status,
            "flags": sorted(set(flags)),
            "dimensions": {"width": width, "height": height},
            "mask": {"foregroundRatio": round(area_ratio, 5), "partialAlphaRatio": round(edge_ratio, 5)},
            "opaqueForegroundPixelsPreserved": opaque_pixels_preserved,
            "method": "photoroom-alpha-mask-and-deterministic-pillow-composite",
        },
    }
    return output.getvalue(), report


async def process_image(
    image_bytes: bytes,
    mime_type: str,
    filename: str,
    preset: str,
    classification_hint: str,
    api_key: str,
    sandbox: bool = False,
) -> tuple[bytes, dict[str, Any]]:
    # Validate and orient the source before a paid provider request is made.
    # Normalize EXIF orientation before sending the image to the segmentation API,
    # so returned mask coordinates always match the pixels used for compositing.
    normalized_bytes, source_size = _normalize_source_for_photoroom(image_bytes, mime_type)
    mask_bytes = await _photoroom_mask(normalized_bytes, "image/png", api_key, sandbox)
    processed, report = compose_with_mask(
        source_bytes=normalized_bytes,
        mask_bytes=mask_bytes,
        mime_type="image/png",
        filename=filename,
        preset=preset,
        classification_hint=classification_hint,
    )
    report["qc"]["sourceDimensions"] = {"width": source_size[0], "height": source_size[1]}
    return processed, report


def convert_image(image_bytes: bytes, output_format: str) -> tuple[bytes, str]:
    normalized = output_format.strip().lower()
    if normalized not in {"png", "jpeg", "webp"}:
        raise ImageProcessingError("INVALID_EXPORT_FORMAT")
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image.load()
            image = image.convert("RGBA")
            if normalized == "png":
                mime_type, save_format, options = "image/png", "PNG", {"optimize": True}
            elif normalized == "jpeg":
                rgb = Image.new("RGB", image.size, PRESETS["STONE_GREY"][1])
                rgb.paste(image, mask=image.getchannel("A"))
                image = rgb
                mime_type, save_format, options = "image/jpeg", "JPEG", {"quality": 94, "optimize": True, "progressive": True}
            else:
                mime_type, save_format, options = "image/webp", "WEBP", {"quality": 94, "method": 6}
            output = io.BytesIO()
            image.save(output, format=save_format, **options)
            return output.getvalue(), mime_type
    except (UnidentifiedImageError, OSError) as error:
        raise ImageProcessingError("INVALID_IMAGE_DATA") from error


def process_task(
    task_id: str,
    task_type: str,
    payload: dict[str, Any],
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    prompt = str(payload.get("prompt", ""))[:5000]
    common = {
        "mode": "scaffold",
        "providerConfigured": False,
        "message": "AI Core đã nhận tác vụ. Nhà cung cấp AI chưa được bật trong Phase 1.",
    }

    if task_type == "CONTENT_DRAFT":
        return {**common, "draft": None, "sideEffects": "none"}
    if task_type == "IMAGE_GENERATION":
        # Contract only: no paid image API call and no media/product write.
        return {
            **common,
            "imageWorker": {
                "requestId": task_id,
                "idempotencyKey": idempotency_key or task_id,
                "prompt": prompt,
                "provider": "disabled",
                "state": "provider_not_configured",
                "outputAssetUrl": None,
            },
            "sideEffects": "none",
        }
    if task_type == "PRODUCT_PUBLICATION_PROPOSAL":
        return {
            **common,
            "approvalRequired": True,
            "proposal": None,
            "sideEffects": "none",
        }
    raise ValueError("UNSUPPORTED_TASK_TYPE")
