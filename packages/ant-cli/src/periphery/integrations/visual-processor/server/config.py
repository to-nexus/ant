"""
Configuration constants loaded from environment variables.

Pure data module — no dependencies on other project modules.
"""

from __future__ import annotations

import os

DEFAULT_MODEL: str = os.getenv("REMBG_MODEL", "u2net")
MAX_FILE_SIZE: int = int(os.getenv("MAX_FILE_SIZE_MB", "20")) * 1024 * 1024
MAX_PIXELS: int = int(os.getenv("MAX_PIXELS", str(4096 * 4096)))
MAX_CONCURRENCY: int = int(os.getenv("MAX_CONCURRENCY", "1"))
PROCESSING_TIMEOUT_S: int = int(os.getenv("PROCESSING_TIMEOUT_S", "60"))
MAX_INFERENCE_DIM: int = int(os.getenv("MAX_INFERENCE_DIM", "768"))

AVAILABLE_MODELS: frozenset[str] = frozenset([
    "birefnet-general",
    "birefnet-general-lite",
    "birefnet-portrait",
    "birefnet-dis",
    "birefnet-hrsod",
    "birefnet-cod",
    "birefnet-massive",
    "u2net",
    "u2netp",
    "u2net_human_seg",
    "isnet-general-use",
    "isnet-anime",
    "sam",
])
