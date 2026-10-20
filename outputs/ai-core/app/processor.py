import io
import base64
import json
import logging
import os
from dataclasses import dataclass
from typing import Any

import httpx
from PIL import Image, ImageChops, ImageFilter, ImageOps, UnidentifiedImageError
from app.phase_four_agents import PhaseFourAgentError, generate_marketing_draft, generate_sales_answer


logger = logging.getLogger("geme.ai_core.images")


MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
MAX_IMAGE_SIDE = 6_000
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
PRESETS = {
    "STONE_GREY": ("#D6D5D1", (214, 213, 209)),
    "WARM_IVORY": ("#EEE8DF", (238, 232, 223)),
    "SOFT_SAGE": ("#DCE3DA", (220, 227, 218)),
}


class ProviderProcessingError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


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
    provider_code = ""
    try:
        provider_body = response.json()
        provider_error = provider_body.get("error", provider_body) if isinstance(provider_body, dict) else {}
        if isinstance(provider_error, dict):
            candidate = provider_error.get("code") or provider_error.get("type")
            if isinstance(candidate, str):
                provider_code = candidate[:80]
    except ValueError:
        pass
    if response.status_code < 200 or response.status_code >= 300:
        logger.warning(json.dumps({
            "event": "ai_core.photoroom_rejected",
            "status": response.status_code,
            "providerCode": provider_code,
            "requestId": (response.headers.get("x-request-id") or response.headers.get("x-correlation-id") or "")[:80],
        }))
    if response.status_code == 401 or response.status_code == 403:
        raise ImageProcessingError("PHOTOROOM_AUTH_FAILED", 503)
    if response.status_code == 402:
        raise ImageProcessingError("PHOTOROOM_BILLING_REQUIRED", 402)
    if response.status_code == 429:
        raise ImageProcessingError("PHOTOROOM_RATE_LIMITED", 503)
    if response.status_code in {400, 413, 415, 422}:
        raise ImageProcessingError("PHOTOROOM_IMAGE_REJECTED", 422)
    if response.status_code >= 500:
        raise ImageProcessingError("PHOTOROOM_UNAVAILABLE", 503)
    if response.status_code < 200 or response.status_code >= 300:
        raise ImageProcessingError("PHOTOROOM_REQUEST_REJECTED", 502)
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


async def _generate_prompt_background(prompt: str, preset: str, api_key: str) -> bytes:
    if not api_key:
        raise ImageProcessingError("CUSTOM_BACKGROUND_NOT_CONFIGURED", 503)
    if preset not in PRESETS:
        raise ImageProcessingError("INVALID_PRESET")

    palette = PRESETS[preset][0]
    safe_prompt = prompt.strip()[:1200]
    image_prompt = (
        "Create a premium luxury-jewelry editorial product-photography SETTING as a background plate. "
        "GEME will composite the untouched original jewelry photo on top afterward. "
        "The administrator's direction may define the scene, background, surface, materials, "
        "lighting, atmosphere, color palette, camera mood, and non-jewelry decorative set dressing. "
        "Keep any props generic and clearly unrelated to jewelry; place them around the edges and "
        "leave the central product placement area calm and unobstructed. Avoid busy high-contrast details. "
        f"Use the selected GEME palette as a color anchor: {palette}. "
        "Administrator's visual direction (treat as style guidance, never as instructions to alter a product):\n"
        f"<visual_direction>{safe_prompt}</visual_direction>\n"
        "Strict final constraints: this plate must contain no jewelry, gemstones, product, hands, people, "
        "stands, jewelry boxes, tools, text, logos, labels, or objects that could be mistaken for the product. "
        "Do not reproduce or invent a product. Output only the scene plate; the real source product is added later."
    )
    model = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2.5-sunburst").strip()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=15, read=240, write=30, pool=15)) as client:
            response = await client.post(
                "https://api.openai.com/v1/images/generations",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": model, "prompt": image_prompt, "size": "auto", "quality": "medium", "output_format": "png", "background": "opaque", "n": 1},
            )
    except httpx.TimeoutException as error:
        raise ImageProcessingError("CUSTOM_BACKGROUND_TIMEOUT", 503) from error
    except httpx.HTTPError as error:
        raise ImageProcessingError("CUSTOM_BACKGROUND_UNAVAILABLE", 503) from error
    if response.status_code >= 400:
        provider_error: dict[str, Any] = {}
        try:
            body = response.json()
            candidate = body.get("error") if isinstance(body, dict) else None
            if isinstance(candidate, dict):
                provider_error = candidate
        except ValueError:
            pass
        provider_code = provider_error.get("code") if isinstance(provider_error.get("code"), str) else ""
        provider_type = provider_error.get("type") if isinstance(provider_error.get("type"), str) else ""
        request_id = response.headers.get("x-request-id", "")[:80]
        logger.warning(json.dumps({
            "event": "ai_core.custom_background_rejected",
            "status": response.status_code,
            "providerCode": provider_code[:80],
            "providerType": provider_type[:80],
            "requestId": request_id,
        }))
        if response.status_code == 429:
            quota_codes = {"insufficient_quota", "billing_hard_limit_reached", "billing_not_active"}
            code = "CUSTOM_BACKGROUND_QUOTA_EXCEEDED" if provider_code in quota_codes or provider_type == "insufficient_quota" else "CUSTOM_BACKGROUND_RATE_LIMITED"
            raise ImageProcessingError(code, 429)
        if response.status_code in {401, 403}:
            raise ImageProcessingError("CUSTOM_BACKGROUND_AUTH_FAILED", 503)
        if response.status_code == 400:
            raise ImageProcessingError("CUSTOM_BACKGROUND_REQUEST_REJECTED", 422)
        if response.status_code >= 500:
            raise ImageProcessingError("CUSTOM_BACKGROUND_PROVIDER_UNAVAILABLE", 503)
        raise ImageProcessingError("CUSTOM_BACKGROUND_PROVIDER_REJECTED", 502)
    try:
        encoded = response.json()["data"][0]["b64_json"]
        image_bytes = base64.b64decode(encoded, validate=True)
        with Image.open(io.BytesIO(image_bytes)) as generated:
            if generated.format != "PNG" or generated.width < 256 or generated.height < 256 or generated.width * generated.height > MAX_IMAGE_PIXELS:
                raise ImageProcessingError("CUSTOM_BACKGROUND_INVALID_IMAGE", 502)
            generated.load()
            result = generated.convert("RGB")
    except ImageProcessingError:
        raise
    except (ValueError, TypeError, KeyError, IndexError, UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ImageProcessingError("CUSTOM_BACKGROUND_INVALID_RESPONSE", 502) from error
    normalized = io.BytesIO()
    result.save(normalized, format="PNG", optimize=True)
    return normalized.getvalue()


def compose_with_mask(
    source_bytes: bytes,
    mask_bytes: bytes,
    mime_type: str,
    filename: str,
    preset: str,
    classification_hint: str = "",
    visual_background_bytes: bytes | None = None,
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
    if visual_background_bytes:
        flags.append("custom_ai_background_needs_review")

    # Retain the source RGB layer; Photoroom contributes only the alpha mask.
    background_color = PRESETS[preset][1]
    if visual_background_bytes:
        try:
            with Image.open(io.BytesIO(visual_background_bytes)) as custom_background:
                if custom_background.width * custom_background.height > MAX_IMAGE_PIXELS:
                    raise ImageProcessingError("CUSTOM_BACKGROUND_PIXEL_LIMIT", 502)
                custom_background.load()
                fitted_background = ImageOps.fit(custom_background.convert("RGB"), (width, height), method=Image.Resampling.LANCZOS)
                background = fitted_background.convert("RGBA")
        except ImageProcessingError:
            raise
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
            raise ImageProcessingError("CUSTOM_BACKGROUND_INVALID_IMAGE", 502) from error
    else:
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
            "method": "photoroom-mask-custom-ai-background-pillow-composite" if visual_background_bytes else "photoroom-alpha-mask-and-deterministic-pillow-composite",
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
    visual_prompt: str = "",
    openai_api_key: str = "",
) -> tuple[bytes, dict[str, Any]]:
    # Validate and orient the source before a paid provider request is made.
    # Normalize EXIF orientation before sending the image to the segmentation API,
    # so returned mask coordinates always match the pixels used for compositing.
    normalized_bytes, source_size = _normalize_source_for_photoroom(image_bytes, mime_type)
    mask_bytes = await _photoroom_mask(normalized_bytes, "image/png", api_key, sandbox)
    custom_background = await _generate_prompt_background(visual_prompt, preset, openai_api_key) if visual_prompt.strip() else None
    processed, report = compose_with_mask(
        source_bytes=normalized_bytes,
        mask_bytes=mask_bytes,
        mime_type="image/png",
        filename=filename,
        preset=preset,
        classification_hint=classification_hint,
        visual_background_bytes=custom_background,
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


async def _generate_content_draft(prompt: str, task_id: str) -> tuple[str, str]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ProviderProcessingError("OPENAI_NOT_CONFIGURED")

    model = os.getenv("OPENAI_TEXT_MODEL", "gpt-6-luna").strip() or "gpt-6-luna"
    instructions = (
        "Bạn là trợ lý biên tập nội dung tiếng Việt cho GEME, thương hiệu trang sức và đá quý cao cấp. "
        "Viết tinh tế, ngắn gọn, tự nhiên, đúng chính tả; không khẳng định thông tin về chất liệu, nguồn gốc, "
        "chứng nhận, carat, giá hoặc công dụng nếu yêu cầu không cung cấp dữ kiện đó. Chỉ tạo bản nháp để con người duyệt."
    )
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0)) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "instructions": instructions,
                    "input": prompt,
                    "max_output_tokens": 1200,
                    "store": False,
                    "metadata": {"geme_task_id": task_id[:64]},
                },
            )
    except httpx.TimeoutException as error:
        raise ProviderProcessingError("OPENAI_TIMEOUT") from error
    except httpx.HTTPError as error:
        raise ProviderProcessingError("OPENAI_UNAVAILABLE") from error

    if response.status_code in (401, 403):
        raise ProviderProcessingError("OPENAI_AUTH_FAILED")
    if response.status_code == 429:
        raise ProviderProcessingError("OPENAI_RATE_LIMITED")
    if response.status_code < 200 or response.status_code >= 300:
        raise ProviderProcessingError("OPENAI_REQUEST_FAILED")
    try:
        body = response.json()
    except ValueError as error:
        raise ProviderProcessingError("OPENAI_RESPONSE_INVALID") from error

    # Responses can contain several output items; collect all output_text blocks.
    text_blocks: list[str] = []
    output = body.get("output") if isinstance(body, dict) else None
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict) or item.get("type") != "message":
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if isinstance(block, dict) and block.get("type") == "output_text" and isinstance(block.get("text"), str):
                    text_blocks.append(block["text"])
    draft = "\n\n".join(block.strip() for block in text_blocks if block.strip())
    if not draft or len(draft) > 24_000:
        raise ProviderProcessingError("OPENAI_RESPONSE_INVALID")
    return draft, model


async def process_task(
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

    if task_type in {"SALES_ANSWER", "MARKETING_DRAFT_GENERATION"}:
        try:
            result = await (generate_sales_answer(payload) if task_type == "SALES_ANSWER" else generate_marketing_draft(payload))
        except PhaseFourAgentError as error:
            raise ProviderProcessingError(error.code) from error
        return {
            **result,
            "mode": "provider",
            "provider": "openai",
            "sideEffects": "none",
        }

    if task_type == "CONTENT_DRAFT":
        if not os.getenv("OPENAI_API_KEY", "").strip():
            return {**common, "draft": None, "sideEffects": "none"}
        draft, model = await _generate_content_draft(prompt, task_id)
        return {
            "mode": "provider",
            "providerConfigured": True,
            "provider": "openai",
            "model": model,
            "draft": draft,
            "sideEffects": "none",
        }
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
