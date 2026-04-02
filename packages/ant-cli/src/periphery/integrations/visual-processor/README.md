# visual-processor

AI 배경 제거 서버. [rembg](https://github.com/danielgatis/rembg) + [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) 기반 Python FastAPI 서비스.

이미지를 받아 배경을 제거한 투명 PNG를 반환한다.

## Quick Start

```bash
# 프로젝트 루트에서 (Redis, ChromaDB 등과 함께)
pnpm dev:infra

# 또는 단독 실행
cd packages/ant-cli/src/periphery/integrations/visual-processor
docker compose up -d
```

최초 기동 시 기본 모델(~1.2 GB)을 다운로드한다. Docker volume에 캐시되어 이후 재시작은 즉시 완료된다.

---

## API Specification

### POST /remove-bg

이미지의 배경을 제거하고 투명 PNG를 반환한다.

**Request:**

```
POST /remove-bg?model={model_name}
Content-Type: multipart/form-data
X-Request-Id: {uuid}          (선택, 없으면 서버가 생성)
```

| Parameter | Location | Type | Required | Default | Description |
|-----------|----------|------|----------|---------|-------------|
| `file` | body (form) | binary | Yes | — | 입력 이미지 |
| `model` | query | string | No | `birefnet-general` | rembg 모델명 |

입력 제한:
- 최대 파일 크기: `MAX_FILE_SIZE_MB` (기본 20 MB)
- 최대 픽셀 수: `MAX_PIXELS` (기본 4096x4096 = 16,777,216)
- 지원 포맷: JPEG, PNG, WebP, BMP, TIFF (PIL이 열 수 있는 모든 포맷)

**Response (200):**

```
Content-Type: image/png
Content-Disposition: inline; filename="output.png"
X-Processing-Time-Ms: 3421
X-Request-Id: abc-123
```

Body: 투명 배경 PNG 바이너리

**Error Responses:**

모든 에러는 `{"detail": "...", "request_id": "..."}` 형식.

| Status | Condition | detail |
|--------|-----------|--------|
| 400 | 유효하지 않은 이미지 파일 | `Invalid image file` |
| 400 | 픽셀 수 초과 | `Image too large: {w}x{h} ({n} pixels, max {m})` |
| 400 | 존재하지 않는 모델명 | `Unknown model: '{x}'. Use GET /models for available options.` |
| 413 | 파일 크기 초과 | `File too large: {n} bytes (max {m} bytes)` |
| 503 | 처리 슬롯 없음 | `At capacity ({n} concurrent). Retry later.` |
| 504 | 처리 타임아웃 | `Processing timeout ({n}s exceeded)` |
| 500 | 기타 내부 오류 | `Processing error: {exception}` |

**curl 예시:**

```bash
curl -X POST http://localhost:4103/remove-bg \
  -F "file=@input.jpg" \
  -o output.png

# 특정 모델 + request ID
curl -X POST "http://localhost:4103/remove-bg?model=birefnet-portrait" \
  -H "X-Request-Id: my-trace-123" \
  -F "file=@portrait.jpg" \
  -o output.png
```

### GET /health

서비스 상태 확인. K8s readiness/liveness probe 겸용.

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
| `status` | string | 항상 `"ok"` |
| `default_model` | string | 기동 시 프리로드된 모델 |
| `loaded_models` | string[] | 현재 메모리에 로드된 모델 목록 |
| `memory_mb` | number | 프로세스 RSS 메모리 (MB) |
| `concurrency.max` | number | worker당 최대 동시 처리 수 |
| `concurrency.active` | number | 현재 처리 중인 요청 수 |

### GET /models

사용 가능한 rembg 모델 목록 반환.

```json
{
  "models": ["birefnet-general", "birefnet-general-lite", "..."],
  "default": "birefnet-general"
}
```

---

## Server Architecture

### 모듈 구조

```
server/
├── config.py         # 환경변수 기반 설정 상수 (순수 데이터, 의존 없음)
├── processor.py      # ImageProcessor: 모델 세션 + 이미지 처리 + 동시성 제어
├── app.py            # FastAPI 앱 팩토리, 라우트, request-id 미들웨어
├── Dockerfile
└── requirements.txt
```

의존 방향: `config` → `processor` → `app` (단방향).

### 요청 수명주기

```
POST /remove-bg
  │
  ├─ middleware: X-Request-Id 부여 (수신 또는 UUID4 생성)
  │
  ├─ app.py: 입력 검증
  │   ├─ 파일 크기 > MAX_FILE_SIZE → 413
  │   └─ model not in AVAILABLE_MODELS → 400
  │
  ├─ processor.try_acquire() — BoundedSemaphore non-blocking
  │   └─ 실패 → 503
  │
  ├─ processor.submit(data, model, request_id)
  │   ├─ ThreadPoolExecutor에 _process 제출
  │   ├─ asyncio.wait_for(timeout=PROCESSING_TIMEOUT_S)
  │   └─ _process 내부:
  │       ├─ PIL.Image.open → 픽셀 검증 (> MAX_PIXELS → ValueError → 400)
  │       ├─ img.convert("RGBA")
  │       ├─ rembg.remove(img, session=model_session)
  │       ├─ output.save(format="PNG")
  │       └─ finally: _release() (semaphore 해제)
  │
  └─ 200 PNG + X-Request-Id + X-Processing-Time-Ms
```

### 동시성 모델 — 단일 게이트

`BoundedSemaphore`와 `ThreadPoolExecutor`가 동일한 `MAX_CONCURRENCY`를 공유하되, **semaphore release는 스레드 내부 `finally`에서만** 수행한다.

- **타임아웃 후 동작**: `wait_for`가 504를 반환해도 스레드는 계속 실행 중이고 semaphore도 점유 중. 다음 요청은 정확히 503을 받는다. 스레드 완료 시 `finally`에서 해제되어 다음 요청 수락.
- **프로세스 병렬성**: `UVICORN_WORKERS=N`으로 프로세스 복제. 각 worker가 독립 `ImageProcessor` 인스턴스를 보유.
- **총 동시성** = `UVICORN_WORKERS` × `MAX_CONCURRENCY`. 총 메모리 = workers × ~1.5 GB.

### 모델 세션 관리

| 전략 | 설명 |
|------|------|
| Startup preload | `REMBG_MODEL` 기본 모델을 서버 기동 시 프리로드 (cold-start 회피) |
| Lazy-load + cache | 비기본 모델은 첫 요청 시 로드. `threading.Lock` 기반 double-checked locking |
| 가중치 경로 | `~/.u2net/` (Docker volume `rembg-models`로 영속화) |

---

## Models

| 모델 | 품질 | 속도 | 적합 용도 |
|------|------|------|----------|
| `birefnet-general` | Highest (SOTA) | Moderate | **기본값** — 로고, 아이콘, 제품 사진 |
| `birefnet-general-lite` | High | Fast | 속도 우선 시 |
| `birefnet-portrait` | Highest | Moderate | 인물/초상화 |
| `birefnet-dis` | High | Moderate | 고밀도 객체 (DIS 특화) |
| `birefnet-massive` | Highest | Slow | 최대 정밀도 필요 시 |
| `u2net` | Good | Fast | 경량 범용 |
| `u2netp` | Fair | Fastest | 최소 리소스 |
| `u2net_human_seg` | Good | Fast | 인물 세그멘테이션 |
| `isnet-general-use` | Good | Fast | 경량 범용 |
| `isnet-anime` | Good | Fast | 애니메이션/일러스트 |
| `sam` | High | Very Slow | SAM 기반 (ViT-H) |

전체 목록은 `GET /models` 응답에서 확인.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REMBG_MODEL` | `birefnet-general` | 기동 시 프리로드할 기본 모델 |
| `MAX_FILE_SIZE_MB` | `20` | 업로드 파일 크기 제한 (MB) |
| `MAX_PIXELS` | `16777216` | 최대 이미지 픽셀 수 (기본 4096x4096) |
| `MAX_CONCURRENCY` | `1` | worker당 동시 처리 가능 요청 수 |
| `PROCESSING_TIMEOUT_S` | `60` | 단일 요청 처리 타임아웃 (초) |
| `UVICORN_WORKERS` | `2` | 프로세스 수. worker × MAX_CONCURRENCY = 총 동시성 |

---

## Resource Requirements

| 항목 | 값 | 비고 |
|------|---|------|
| 모델 다운로드 | ~1.2 GB | 최초 1회, volume에 영속화 |
| 모델 메모리 | ~1.5 GB × workers | worker별 독립 로드 |
| 처리 시간 (CPU) | 3–5s | 1024×1024 이미지 기준 |
| 처리 시간 (GPU) | <1s | CUDA 12.x 기준 (미구현) |
| 기본 동시성 | 2 req | 2 workers × 1 concurrent |

---

## Deployment

Pod 리소스, Kubernetes 매니페스트, 스케일링 전략, GPU 지원 등 배포 관련 내용은 [Cloud Deployment Guide](../../../../../../../docs/infra/cloud-deployment-guide.md) Section 2.9 참조.

**로컬 개발 시:**

```bash
# 프로젝트 루트에서 (Redis, ChromaDB 등과 함께)
pnpm dev:infra

# 또는 단독 실행
docker compose up -d
```

`rembg-models` named volume이 `~/.u2net`에 마운트되어 모델 가중치가 컨테이너 리빌드 후에도 영속된다.

---

## Future Extensions

이 서비스는 `visual-processor`라는 범용 이름으로, 향후 이미지 처리 엔드포인트를 점진적으로 추가한다:

| Endpoint | Purpose | Priority |
|----------|---------|----------|
| `POST /upscale` | AI 업스케일링 (Real-ESRGAN 등) | Medium |
| `POST /optimize` | 웹 최적화 (압축, 리사이즈) | Low |
| `POST /segment` | 세그멘테이션 마스크 반환 | Low |

---

## File Structure

```
visual-processor/
├── README.md               # ← 이 문서 (서버 기능 명세)
├── docker-compose.yml       # 서비스 정의, volume 마운트
└── server/
    ├── Dockerfile           # python:3.10-slim, uvicorn --factory
    ├── requirements.txt     # rembg[cpu], fastapi, uvicorn, pillow
    ├── config.py            # 환경변수 기반 설정 상수
    ├── processor.py         # ImageProcessor 클래스
    └── app.py               # FastAPI 앱 팩토리 + 라우트
```

ant-cli와의 통합 아키텍처는 [docs/architecture/27-visual-processor.md](../../../../../../../docs/architecture/27-visual-processor.md) 참조.
