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

from app.processor import ImageProcessingError, process_image, process_task
from app.security import has_valid_internal_key


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

TaskType = Literal["CONTENT_DRAFT", "IMAGE_GENERATION", "PRODUCT_PUBLICATION_PROPOSAL"]


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
        result = process_task(request.task_id, request.type, request.input, request.idempotency_key)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Unsupported task type") from error
    logger.info(json.dumps({"event": "ai_core.task_processed", "taskId": request.task_id, "type": request.type, "mode": "scaffold"}))
    return {"taskId": request.task_id, "result": result}


@app.post("/internal/images/process")
async def process_internal_image(
    image_file: UploadFile = File(...),
    preset: str = Form(...),
    classification_hint: str = Form(default=""),
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
