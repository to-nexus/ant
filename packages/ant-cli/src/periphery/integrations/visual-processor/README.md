# visual-processor

AI background-removal server. Python FastAPI service based on [rembg](https://github.com/danielgatis/rembg) + [BiRefNet](https://github.com/ZhengPeng7/BiRefNet).

Takes an image and returns a transparent PNG with the background removed.

## Quick Start

```bash
# From the project root (together with Redis, ChromaDB, etc.)
pnpm dev:infra

# Or run standalone
cd packages/ant-cli/src/periphery/integrations/visual-processor
docker compose up -d
```

On first startup it downloads the default model (~1.2 GB). The model is cached in a Docker volume, so subsequent restarts complete immediately.

---

## API Specification

### POST /remove-bg

Removes the background from an image and returns a transparent PNG.

**Request:**

```
POST /remove-bg?model={model_name}
Content-Type: multipart/form-data
X-Request-Id: {uuid}          (optional; the server generates one if absent)
```

| Parameter | Location | Type | Required | Default | Description |
|-----------|----------|------|----------|---------|-------------|
| `file` | body (form) | binary | Yes | — | Input image |
| `model` | query | string | No | `birefnet-general` | rembg model name |

Input limits:
- Max file size: `MAX_FILE_SIZE_MB` (default 20 MB)
- Max pixel count: `MAX_PIXELS` (default 4096x4096 = 16,777,216)
- Supported formats: JPEG, PNG, WebP, BMP, TIFF (any format PIL can open)

**Response (200):**

```
Content-Type: image/png
Content-Disposition: inline; filename="output.png"
X-Processing-Time-Ms: 3421
X-Request-Id: abc-123
```

Body: PNG binary with transparent background

**Error Responses:**

All errors use the shape `{"detail": "...", "request_id": "..."}`.

| Status | Condition | detail |
|--------|-----------|--------|
| 400 | Invalid image file | `Invalid image file` |
| 400 | Pixel count exceeded | `Image too large: {w}x{h} ({n} pixels, max {m})` |
| 400 | Unknown model name | `Unknown model: '{x}'. Use GET /models for available options.` |
| 413 | File size exceeded | `File too large: {n} bytes (max {m} bytes)` |
| 503 | No processing slot available | `At capacity ({n} concurrent). Retry later.` |
| 504 | Processing timeout | `Processing timeout ({n}s exceeded)` |
| 500 | Other internal error | `Processing error: {exception}` |

**curl examples:**

```bash
curl -X POST http://localhost:4103/remove-bg \
  -F "file=@input.jpg" \
  -o output.png

# Specific model + request ID
curl -X POST "http://localhost:4103/remove-bg?model=birefnet-portrait" \
  -H "X-Request-Id: my-trace-123" \
  -F "file=@portrait.jpg" \
  -o output.png
```

### GET /health

Service health check. Doubles as a K8s readiness/liveness probe.

```json
{
  "status": "ok",
  "default_model": "birefnet-general",
  "loaded_models": ["birefnet-general"],
  "memory_mb": 1847.3,
  "concurrency": { "max": 1, "active": 0 }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"ok"` |
| `default_model` | string | Model preloaded at startup |
| `loaded_models` | string[] | Models currently loaded in memory |
| `memory_mb` | number | Process RSS memory (MB) |
| `concurrency.max` | number | Max concurrent requests per worker |
| `concurrency.active` | number | Requests currently being processed |

### GET /models

Returns the list of available rembg models.

```json
{
  "models": ["birefnet-general", "birefnet-general-lite", "..."],
  "default": "birefnet-general"
}
```

---

## Server Architecture

### Module structure

```
server/
├── config.py         # Environment-variable-driven config constants (pure data, no dependencies)
├── processor.py      # ImageProcessor: model sessions + image processing + concurrency control
├── app.py            # FastAPI app factory, routes, request-id middleware
├── Dockerfile
└── requirements.txt
```

Dependency direction: `config` → `processor` → `app` (one-way).

### Request lifecycle

```
POST /remove-bg
  │
  ├─ middleware: assign X-Request-Id (received or generated as UUID4)
  │
  ├─ app.py: input validation
  │   ├─ file size > MAX_FILE_SIZE → 413
  │   └─ model not in AVAILABLE_MODELS → 400
  │
  ├─ processor.try_acquire() — BoundedSemaphore non-blocking
  │   └─ failure → 503
  │
  ├─ processor.submit(data, model, request_id)
  │   ├─ submit _process to ThreadPoolExecutor
  │   ├─ asyncio.wait_for(timeout=PROCESSING_TIMEOUT_S)
  │   └─ inside _process:
  │       ├─ PIL.Image.open → pixel validation (> MAX_PIXELS → ValueError → 400)
  │       ├─ img.convert("RGBA")
  │       ├─ rembg.remove(img, session=model_session)
  │       ├─ output.save(format="PNG")
  │       └─ finally: _release() (release semaphore)
  │
  └─ 200 PNG + X-Request-Id + X-Processing-Time-Ms
```

### Concurrency model — single gate

The `BoundedSemaphore` and the `ThreadPoolExecutor` share the same `MAX_CONCURRENCY`, but **the semaphore is released only in the thread's internal `finally`**.

- **Behavior after timeout**: even after `wait_for` returns a 504, the thread keeps running and still holds the semaphore. The next request correctly receives a 503. When the thread completes, the `finally` releases the slot and the next request is accepted.
- **Process parallelism**: replicate processes with `UVICORN_WORKERS=N`. Each worker holds an independent `ImageProcessor` instance.
- **Total concurrency** = `UVICORN_WORKERS` × `MAX_CONCURRENCY`. Total memory = workers × ~1.5 GB.

### Model session management

| Strategy | Description |
|------|------|
| Startup preload | Preload the `REMBG_MODEL` default model at server startup (avoids cold-start) |
| Lazy-load + cache | Non-default models load on first request. Double-checked locking via `threading.Lock` |
| Weights path | `~/.u2net/` (persisted via the `rembg-models` Docker volume) |

---

## Models

| Model | Quality | Speed | Suited for |
|------|------|------|----------|
| `birefnet-general` | Highest (SOTA) | Moderate | Logos, icons, product photos (high quality) |
| `birefnet-general-lite` | High | Fast | When speed matters most |
| `birefnet-portrait` | Highest | Moderate | People/portraits |
| `birefnet-dis` | High | Moderate | Dense objects (DIS-specialized) |
| `birefnet-massive` | Highest | Slow | When maximum precision is required |
| `u2net` | Good | Fast | **Default** — lightweight general-purpose |
| `u2netp` | Fair | Fastest | Minimal resources |
| `u2net_human_seg` | Good | Fast | Human segmentation |
| `isnet-general-use` | Good | Fast | Lightweight general-purpose |
| `isnet-anime` | Good | Fast | Animation/illustration |
| `sam` | High | Very Slow | SAM-based (ViT-H) |

See the `GET /models` response for the full list.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REMBG_MODEL` | `u2net` | Default model to preload at startup |
| `MAX_FILE_SIZE_MB` | `20` | Upload file size limit (MB) |
| `MAX_PIXELS` | `16777216` | Max image pixel count (default 4096×4096) |
| `MAX_INFERENCE_DIM` | `768` | Max dimension to downscale to before inference. Larger images are shrunk to this size for processing |
| `MAX_CONCURRENCY` | `1` | Concurrent requests allowed per worker |
| `PROCESSING_TIMEOUT_S` | `60` | Per-request processing timeout (seconds) |
| `UVICORN_WORKERS` | `1` | Process count. workers × MAX_CONCURRENCY = total concurrency |

---

## Resource Requirements

| Item | Value | Notes |
|------|---|------|
| Model download | ~170 MB (u2net) / ~1.2 GB (birefnet) | First run only, persisted in volume |
| Model memory | ~0.2–1.5 GB × workers | Varies by model, loaded independently per worker |
| Processing time (CPU) | 3–5s | For a 1024×1024 image |
| Processing time (GPU) | <1s | With CUDA 12.x (not implemented) |
| Default concurrency | 1 req | 1 worker × 1 concurrent |

---

## Deployment

Pod resources, Kubernetes manifests, scaling strategy, GPU support, and other deployment concerns are the scope of each operator's deployment infrastructure (not included in the OSS tree).

**For local development:**

```bash
# From the project root (together with Redis, ChromaDB, etc.)
pnpm dev:infra

# Or run standalone
docker compose up -d
```

The `rembg-models` named volume is mounted at `~/.u2net`, so model weights persist across container rebuilds.

---

## Future Extensions

This service carries the general-purpose name `visual-processor`; image-processing endpoints will be added incrementally over time:

| Endpoint | Purpose | Priority |
|----------|---------|----------|
| `POST /upscale` | AI upscaling (Real-ESRGAN, etc.) | Medium |
| `POST /optimize` | Web optimization (compression, resizing) | Low |
| `POST /segment` | Return segmentation masks | Low |

---

## File Structure

```
visual-processor/
├── README.md               # ← This document (server functional spec)
├── docker-compose.yml       # Service definition, volume mounts
└── server/
    ├── Dockerfile           # python:3.10-slim, uvicorn --factory
    ├── requirements.txt     # rembg[cpu], fastapi, uvicorn, pillow
    ├── config.py            # Environment-variable-driven config constants
    ├── processor.py         # ImageProcessor class
    └── app.py               # FastAPI app factory + routes
```

For the integration architecture with ant-cli, see [docs/internals/27-visual-processor.md](../../../../../../docs/internals/27-visual-processor.md).
