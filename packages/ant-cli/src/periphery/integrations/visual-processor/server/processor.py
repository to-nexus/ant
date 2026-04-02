"""
Image processing engine with bounded concurrency.

Owns model sessions, thread pool, and admission control.
External callers use the try_acquire() → submit() protocol only.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import resource
import threading
from concurrent.futures import ThreadPoolExecutor

from PIL import Image
from rembg import remove, new_session

from config import DEFAULT_MODEL, MAX_CONCURRENCY, MAX_INFERENCE_DIM, MAX_PIXELS, PROCESSING_TIMEOUT_S

logger = logging.getLogger("visual-processor")


class ImageProcessor:
    """
    Thread-safe image processor with bounded concurrency.

    Concurrency model — single gate:
      BoundedSemaphore and ThreadPoolExecutor share the same MAX_CONCURRENCY.
      Semaphore is acquired in the async handler (try_acquire),
      but released ONLY inside the thread's finally (_process).
      This guarantees the semaphore always reflects actual thread occupation.
    """

    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(max_workers=MAX_CONCURRENCY)
        self._semaphore = threading.BoundedSemaphore(MAX_CONCURRENCY)
        self._session_lock = threading.Lock()
        self._sessions: dict[str, object] = {}
        self._active = 0

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def startup(self) -> None:
        """Preload the default model so first request avoids cold-start."""
        self._get_session(DEFAULT_MODEL)
        logger.info(
            "processor ready  model=%s  concurrency=%d  timeout=%ds",
            DEFAULT_MODEL, MAX_CONCURRENCY, PROCESSING_TIMEOUT_S,
        )

    def shutdown(self) -> None:
        """Drain in-flight work, then release model sessions."""
        self._executor.shutdown(wait=True, cancel_futures=True)
        self._sessions.clear()
        logger.info("processor shutdown")

    # ------------------------------------------------------------------
    # Admission control
    # ------------------------------------------------------------------

    def try_acquire(self) -> bool:
        """Non-blocking slot acquisition. Returns True if a slot is available."""
        acquired = self._semaphore.acquire(blocking=False)
        if acquired:
            self._active += 1
        return acquired

    def _release(self) -> None:
        """Release a slot. Called ONLY from _process finally or submit error path."""
        self._active -= 1
        self._semaphore.release()

    # ------------------------------------------------------------------
    # Processing
    # ------------------------------------------------------------------

    async def submit(
        self,
        data: bytes,
        model: str,
        request_id: str,
    ) -> bytes:
        """
        Submit image data for background removal.

        Caller MUST have successfully called try_acquire() first.
        The semaphore is released inside _process (on success/failure)
        or here (if executor rejects the submission).
        """
        try:
            loop = asyncio.get_running_loop()
            return await asyncio.wait_for(
                loop.run_in_executor(
                    self._executor, self._process, data, model, request_id,
                ),
                timeout=PROCESSING_TIMEOUT_S,
            )
        except RuntimeError:
            # Executor rejected submission (e.g., during shutdown).
            # _process never started, so release manually.
            self._release()
            raise

    def _process(self, data: bytes, model: str, request_id: str) -> bytes:
        """CPU-bound: validate → downscale → rembg.remove → PNG bytes. Runs in thread pool."""
        try:
            img = Image.open(io.BytesIO(data))
            px = img.width * img.height
            if px > MAX_PIXELS:
                raise ValueError(
                    f"Image too large: {img.width}x{img.height} "
                    f"({px} pixels, max {MAX_PIXELS})"
                )

            if max(img.width, img.height) > MAX_INFERENCE_DIM:
                orig_size = (img.width, img.height)
                img.thumbnail((MAX_INFERENCE_DIM, MAX_INFERENCE_DIM), Image.LANCZOS)
                logger.info(
                    "[%s] downscaled %dx%d → %dx%d for inference",
                    request_id, orig_size[0], orig_size[1], img.width, img.height,
                )

            img = img.convert("RGBA")

            session = self._get_session(model)
            result: Image.Image = remove(img, session=session)

            buf = io.BytesIO()
            result.save(buf, format="PNG")
            return buf.getvalue()
        finally:
            self._release()

    # ------------------------------------------------------------------
    # Model session management (thread-safe)
    # ------------------------------------------------------------------

    def _get_session(self, model: str) -> object:
        """Double-checked locking for lazy model loading."""
        if model in self._sessions:
            return self._sessions[model]
        with self._session_lock:
            if model in self._sessions:
                return self._sessions[model]
            logger.info("loading model: %s", model)
            self._sessions[model] = new_session(model)
            logger.info("model loaded: %s", model)
            return self._sessions[model]

    # ------------------------------------------------------------------
    # Observability
    # ------------------------------------------------------------------

    def health_snapshot(self) -> dict:
        """Return current health metrics."""
        mem_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        if os.uname().sysname == "Darwin":
            mem_mb /= 1024 * 1024
        else:
            mem_mb /= 1024

        return {
            "status": "ok",
            "default_model": DEFAULT_MODEL,
            "loaded_models": list(self._sessions.keys()),
            "memory_mb": round(mem_mb, 1),
            "concurrency": {
                "max": MAX_CONCURRENCY,
                "active": self._active,
            },
        }
