import json
import logging
import os
import secrets
import time
import base64
from typing import Any, Literal

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from app.processor import ImageProcessingError, ProviderProcessingError, process_image, process_task
from app.security import has_valid_internal_key
from app.technical_drawing import TechnicalDrawingError, create_technical_drawing
from app.product_agent import ProductAgentError, generate_product_draft


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps(
            {
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
                "level": record.levelname.lower(),
                "logger": record.name,
                "message": record.getMessage(),
            },
            ensure_ascii=False,
        )


handler = logging.StreamHandler()
handler.setFormatter(JsonLogFormatter())
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper(), handlers=[handler], force=True)
logger = logging.getLogger("geme.ai_core")
app = FastAPI(title="GEME AI Core", docs_url=None, redoc_url=None, openapi_url=None)

TaskType = Literal["CONTENT_DRAFT", "IMAGE_GENERATION", "PRODUCT_PUBLICATION_PROPOSAL", "SALES_ANSWER", "MARKETING_DRAFT_GENERATION"]


class ProcessTaskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(min_length=1, max_length=64)
    idempotency_key: str = Field(min_length=8, max_length=128)
    type: TaskType
    input: dict[str, Any]


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai-core"}


@app.post("/internal/tasks/process")
async def process_internal_task(
    request: ProcessTaskRequest,
    supplied_key: str = Header(default="", alias="X-AI-Core-Key"),
) -> dict[str, Any]:
    expected_key = os.getenv("AI_CORE_SHARED_SECRET", "").strip()
    if len(expected_key.encode("utf-8")) < 32:
        raise HTTPException(status_code=503, detail="Internal AI authentication is not configured")
    if not has_valid_internal_key(expected_key, supplied_key):
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        result = await process_task(request.task_id, request.type, request.input, request.idempotency_key)
    except ProviderProcessingError as error:
        logger.warning(json.dumps({"event": "ai_core.provider_failed", "taskId": request.task_id, "type": request.type, "code": error.code}))
        status = 429 if error.code in {"OPENAI_AGENT_RATE_LIMITED", "OPENAI_PRODUCT_RATE_LIMITED"} else 503
        raise HTTPException(status_code=status, detail=error.code) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Unsupported task type") from error
    logger.info(json.dumps({"event": "ai_core.task_processed", "taskId": request.task_id, "type": request.type, "mode": result.get("mode", "scaffold")}))
    return {"taskId": request.task_id, "result": result}


@app.post("/internal/images/process")
async def process_internal_image(
    image_file: UploadFile = File(...),
    preset: str = Form(...),
    classification_hint: str = Form(default=""),
    visual_prompt: str = Form(default="", max_length=1200),
    supplied_key: str = Header(default="", alias="X-AI-Core-Key"),
) -> Response:
    require_internal_key(supplied_key)
    try:
        image_bytes = await image_file.read(8 * 1024 * 1024 + 1)
        if len(image_bytes) > 8 * 1024 * 1024:
            raise ImageProcessingError("IMAGE_TOO_LARGE", 413)
        output, report = await process_image(
            image_bytes=image_bytes,
            mime_type=image_file.content_type or "",
            filename=image_file.filename or "product-image",
            preset=preset,
            classification_hint=classification_hint,
            api_key=os.getenv("PHOTOROOM_API_KEY", "").strip(),
            sandbox=os.getenv("PHOTOROOM_SANDBOX", "false").strip().lower() == "true",
            visual_prompt=visual_prompt,
            openai_api_key=os.getenv("OPENAI_API_KEY", "").strip(),
        )
    except ImageProcessingError as error:
        raise HTTPException(status_code=error.status_code, detail=error.code) from error
    except Exception as error:
        logger.exception("image processing failed")
        raise HTTPException(status_code=502, detail="IMAGE_PROCESSING_FAILED") from error

    logger.info(json.dumps({"event": "ai_core.image_processed", "preset": preset, "qc": report["qc"]["status"]}))
    qc_header = base64.urlsafe_b64encode(json.dumps(report, separators=(",", ":")).encode()).decode()
    return Response(
        content=output,
        media_type="image/png",
        headers={"Cache-Control": "no-store", "X-Geme-Image-Qc": qc_header},
    )


@app.post("/internal/images/technical-drawing")
async def create_internal_technical_drawing(
    image_file: UploadFile = File(...),
    product_name: str = Form(..., max_length=180),
    sku: str = Form(..., max_length=64),
    supplied_key: str = Header(default="", alias="X-AI-Core-Key"),
) -> Response:
    require_internal_key(supplied_key)
    image_bytes = await image_file.read(8 * 1024 * 1024 + 1)
    if len(image_bytes) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="IMAGE_TOO_LARGE")
    try:
        output, report = await create_technical_drawing(
            image_bytes=image_bytes,
            mime_type=image_file.content_type or "",
            filename=image_file.filename or "product-reference",
            product_name=product_name,
            sku=sku,
            api_key=os.getenv("OPENAI_API_KEY", "").strip(),
        )
    except TechnicalDrawingError as error:
        status = 503 if error.code in {"OPENAI_NOT_CONFIGURED", "OPENAI_ANALYSIS_UNAVAILABLE", "OPENAI_IMAGE_UNAVAILABLE", "OPENAI_ANALYSIS_TIMEOUT", "OPENAI_IMAGE_TIMEOUT"} else 502
        logger.warning(json.dumps({"event": "ai_core.technical_drawing_failed", "sku": sku, "code": error.code}))
        raise HTTPException(status_code=status, detail=error.code) from error
    except Exception as error:
        logger.exception("technical drawing generation failed")
        raise HTTPException(status_code=502, detail="TECHNICAL_DRAWING_FAILED") from error

    logger.info(json.dumps({"event": "ai_core.technical_drawing_created", "sku": sku, "qc": report["qc"]["status"]}))
    qc_header = base64.urlsafe_b64encode(json.dumps(report, separators=(",", ":")).encode()).decode()
    return Response(content=output, media_type="image/png", headers={"Cache-Control": "no-store", "X-Geme-Image-Qc": qc_header})


@app.post("/internal/products/generate-draft")
async def generate_internal_product_draft(
    image_file: UploadFile = File(...),
    category_options: str = Form(..., max_length=48_000),
    material_options: str = Form(..., max_length=48_000),
    gemstone_options: str = Form(..., max_length=48_000),
    supplied_key: str = Header(default="", alias="X-AI-Core-Key"),
) -> dict[str, Any]:
    require_internal_key(supplied_key)
    image_bytes = await image_file.read(8 * 1024 * 1024 + 1)
    if len(image_bytes) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="IMAGE_TOO_LARGE")

    def parse_options(value: str) -> list[str]:
        try:
            result = json.loads(value)
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=422, detail="INVALID_CATALOG_OPTIONS") from error
        if not isinstance(result, list) or len(result) > 300 or any(not isinstance(item, str) for item in result):
            raise HTTPException(status_code=422, detail="INVALID_CATALOG_OPTIONS")
        return result

    try:
        result = await generate_product_draft(
            image_bytes=image_bytes,
            mime_type=image_file.content_type or "",
            categories=parse_options(category_options),
            materials=parse_options(material_options),
            gemstones=parse_options(gemstone_options),
            api_key=os.getenv("OPENAI_API_KEY", "").strip(),
        )
    except ProductAgentError as error:
        status = {
            "OPENAI_PRODUCT_RATE_LIMITED": 429,
            "OPENAI_NOT_CONFIGURED": 503,
            "OPENAI_PRODUCT_TIMEOUT": 503,
            "OPENAI_PRODUCT_UNAVAILABLE": 503,
            "OPENAI_PRODUCT_QUOTA_EXCEEDED": 503,
            "OPENAI_PRODUCT_AUTH_FAILED": 503,
            "OPENAI_PRODUCT_ACCESS_DENIED": 503,
            "OPENAI_PRODUCT_MODEL_UNAVAILABLE": 503,
        }.get(error.code, 502)
        if error.code in {"UNSUPPORTED_IMAGE_TYPE", "IMAGE_TOO_LARGE", "IMAGE_PIXEL_LIMIT", "INVALID_IMAGE"}:
            status = 422
        logger.warning(json.dumps({"event": "ai_core.product_agent_failed", "code": error.code}))
        raise HTTPException(status_code=status, detail=error.code) from error
    except Exception as error:
        logger.exception("product draft generation failed")
        raise HTTPException(status_code=502, detail="PRODUCT_DRAFT_GENERATION_FAILED") from error

    logger.info(json.dumps({"event": "ai_core.product_draft_generated", "needsReview": result["needs_review"], "confidence": result["confidence_score"]}))
    return {"result": result}


@app.post("/internal/images/convert")
async def convert_internal_image(
    image_file: UploadFile = File(...),
    output_format: str = Form(...),
    supplied_key: str = Header(default="", alias="X-AI-Core-Key"),
) -> Response:
    require_internal_key(supplied_key)
    try:
        image_bytes = await image_file.read(40 * 1024 * 1024 + 1)
        if len(image_bytes) > 40 * 1024 * 1024:
            raise ImageProcessingError("IMAGE_TOO_LARGE", 413)
        from app.processor import convert_image
        output, mime_type = convert_image(image_bytes, output_format)
    except ImageProcessingError as error:
        raise HTTPException(status_code=error.status_code, detail=error.code) from error
    return Response(content=output, media_type=mime_type, headers={"Cache-Control": "no-store"})


def require_internal_key(supplied_key: str) -> None:
    expected_key = os.getenv("AI_CORE_SHARED_SECRET", "").strip()
    if len(expected_key.encode("utf-8")) < 32:
        raise HTTPException(status_code=503, detail="Internal AI authentication is not configured")
    if not has_valid_internal_key(expected_key, supplied_key):
        raise HTTPException(status_code=401, detail="Unauthorized")
