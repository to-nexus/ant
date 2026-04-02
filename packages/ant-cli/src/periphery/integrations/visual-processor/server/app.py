"""
FastAPI application factory.

Thin HTTP layer: request ID middleware, input validation, error mapping.
All processing is delegated to ImageProcessor.
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import UnidentifiedImageError

from config import (
    AVAILABLE_MODELS,
    DEFAULT_MODEL,
    MAX_CONCURRENCY,
    MAX_FILE_SIZE,
    PROCESSING_TIMEOUT_S,
)
from processor import ImageProcessor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("visual-processor")


def create_app() -> FastAPI:
    """Application factory. Each uvicorn worker calls this independently."""

    processor = ImageProcessor()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        processor.startup()
        logger.info("visual-processor ready")
        yield
        processor.shutdown()
        logger.info("visual-processor shutdown")

    app = FastAPI(title="visual-processor", version="1.0.0", lifespan=lifespan)

    # ------------------------------------------------------------------
    # Middleware: Request ID
    # ------------------------------------------------------------------

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response

    # ------------------------------------------------------------------
    # Exception handler: unified error format
    # ------------------------------------------------------------------

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        request_id = getattr(request.state, "request_id", "-")
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail, "request_id": request_id},
        )

    # ------------------------------------------------------------------
    # Routes
    # ------------------------------------------------------------------

    @app.post("/remove-bg")
    async def remove_bg(
        request: Request,
        file: UploadFile = File(...),
        model: str = Query(DEFAULT_MODEL, description="rembg model name"),
    ):
        request_id: str = getattr(request.state, "request_id", "-")
        start = time.monotonic()

        data = await file.read()
        if len(data) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"File too large: {len(data)} bytes (max {MAX_FILE_SIZE} bytes)",
            )

        if model not in AVAILABLE_MODELS:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown model: '{model}'. Use GET /models for available options.",
            )

        if not processor.try_acquire():
            logger.warning(
                "[%s] rejected: at capacity (%d/%d active)",
                request_id, processor._active, MAX_CONCURRENCY,
            )
            raise HTTPException(
                status_code=503,
                detail=f"At capacity ({MAX_CONCURRENCY} concurrent). Retry later.",
            )

        try:
            result_bytes = await processor.submit(data, model, request_id)
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=504,
                detail=f"Processing timeout ({PROCESSING_TIMEOUT_S}s exceeded)",
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except UnidentifiedImageError:
            raise HTTPException(status_code=400, detail="Invalid image file")
        except RuntimeError:
            raise HTTPException(status_code=503, detail="Server shutting down")
        except Exception as exc:
            logger.exception("[%s] processing failed", request_id)
            raise HTTPException(status_code=500, detail=f"Processing error: {exc}")

        elapsed = time.monotonic() - start
        logger.info(
            "[%s] remove-bg  model=%s  in=%d bytes  out=%d bytes  elapsed=%.2fs",
            request_id, model, len(data), len(result_bytes), elapsed,
        )

        return Response(
            content=result_bytes,
            media_type="image/png",
            headers={
                "Content-Disposition": 'inline; filename="output.png"',
                "X-Processing-Time-Ms": str(int(elapsed * 1000)),
            },
        )

    @app.get("/health")
    async def health():
        return processor.health_snapshot()

    @app.get("/models")
    async def list_models():
        return {"models": sorted(AVAILABLE_MODELS), "default": DEFAULT_MODEL}

    return app
