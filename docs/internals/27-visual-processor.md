# Visual Processor 통합

## 개요

Visual Job의 deliver 노드에서 최종 이미지에 후처리(배경 제거, 포맷 변환)를 적용하는 파이프라인. 실제 이미지 처리는 Python FastAPI 사이드카(`visual-processor`)에 위임하며, ant-cli는 Hexagonal Architecture 포트/어댑터를 통해 사이드카와 통신한다.

서버 자체의 기능 명세(API 스펙, 내부 아키텍처)는 [visual-processor/README.md](../../packages/ant-cli/src/periphery/integrations/visual-processor/README.md), 배포 가이드(Pod 리소스, K8s, 스케일링)는 [Cloud Deployment Guide](../infra/cloud-deployment-guide.md) Section 2.9에 있다.

## 아키텍처 결정

### 왜 별도 사이드카인가

| 대안 | 기각 사유 |
|------|----------|
| Node.js 네이티브 (ONNX Runtime) | PyTorch/ONNX 바인딩이 Python 생태계에 비해 불안정, BiRefNet 구현 부재 |
| 브라우저 WASM (Transformers.js) | 서버사이드 일관 품질 보장 불가, 사용자 디바이스 성능 의존 |
| ant-cli 프로세스 내 Python 호출 | 메모리 격리 불가, ~1.5 GB 모델이 job worker 프로세스에 상주 |

rembg + BiRefNet은 Python 생태계에서만 안정적으로 작동한다. Docker 컨테이너로 메모리와 CPU를 독립 관리하여 job worker의 안정성에 영향을 주지 않는다.

### 왜 rembg + BiRefNet인가

| 모델 | 품질 (DIS5K mAE) | 속도 (CPU) | 라이선스 |
|------|-----------------|-----------|---------|
| **BiRefNet-general** | **0.023** (SOTA) | 3–5s | MIT |
| ISNet | 0.041 | 1–2s | MIT |
| U2Net | 0.044 | ~1s | Apache-2.0 |
| SAM (ViT-H) | 0.031 | 10s+ | Apache-2.0 |

BiRefNet이 품질과 라이선스 양면에서 최적이다. rembg 라이브러리가 세션 관리, 이미지 전처리/후처리, 모델 다운로드를 추상화한다.

## 처리 파이프라인

### deliver 노드 호출 흐름

```
classify → assetType (logo/icon/hero/illustration/general)
                │
                ▼
        ASSET_OUTPUT_SPECS[assetType]
                │
                ▼
render → finalImage (JPEG buffer)
                │
                ▼
deliver ─── spec.requiresBgRemoval? ─── Y ── isAvailable()? ─── Y ── POST /remove-bg ── PNG buffer
                │                        │                        │
                │                        N                        N (sidecar 미실행)
                │                        │                        │
                │                        ▼                        ▼
                │                   원본 유지                  원본 유지 (graceful)
                │
                ▼
         imageMime ≠ spec.format? ─── Y ── sharp 포맷 변환
                │                     │
                N                     ▼
                │              변환된 buffer
                ▼
        writeFileSync (단일 디스크 쓰기)
```

deliver 노드는 최종 이미지(finalImage)에만 후처리를 적용한다. 드래프트(draftImages)는 사용자 선택용 미리보기이므로 원본 그대로 저장한다.

### 에셋 타입별 출력 스펙

| assetType | format | requiresBgRemoval | quality |
|-----------|--------|-------------------|---------|
| `logo` | png | true | — |
| `icon` | png | true | — |
| `illustration` | png | true | — |
| `hero` | jpeg | false | 90 |
| `general` | jpeg | false | 85 |

이 매핑은 `ASSET_OUTPUT_SPECS` 상수로 `types.ts`에 정의된다. deliver 노드가 `state.assetType`으로 조회한다.

### 실패 정책

bg-removal 또는 포맷 변환의 어떤 단계에서든 실패 시, 원본 이미지를 그대로 저장한다 (graceful degradation). 사이드카가 실행되지 않은 환경에서도 Visual Job은 정상 작동한다. 단, 투명 배경 처리가 생략될 뿐이다.

## Hexagonal Architecture 통합

### Port

```
core/ports/backgroundRemoval.ts
├── BackgroundRemovalPort       (interface)
├── BackgroundRemovalResult     ({ data: Buffer, mimeType: 'image/png' })
└── BackgroundRemovalOptions    ({ model?: string })
```

`BackgroundRemovalPort`는 두 메서드를 정의한다:
- `removeBackground(imageData, mimeType, options?)` — 배경 제거 실행
- `isAvailable()` — 서비스 도달 가능 여부 확인 (graceful fallback에 사용)

### Adapters

| 어댑터 | 위치 | 역할 | isAvailable() |
|--------|------|------|---------------|
| `VisualProcessorClient` | `periphery/adapters/visualProcessor/` | HTTP로 사이드카 `/remove-bg` 호출 | `/health` 200이면 true |
| `NoopBackgroundRemoval` | 동일 | 패스스루 (원본 반환) | 항상 false |

`VisualProcessorClient`는 에러 시 서버의 `detail` 필드를 파싱하여 에러 메시지에 포함한다. 타임아웃은 60초 (BiRefNet CPU 대형 이미지 대응).

### DI (orchestrator.ts)

```
configData.visualSettings.removeBackground !== false
  → new VisualProcessorClient(ANT_VISUAL_PROCESSOR_URL)
  → else new NoopBackgroundRemoval()
```

기본값은 활성화(true). `VisualSettings.removeBackground = false`로 명시 비활성화 가능.

### deps 전달 경로

```
orchestrator.ts
  └→ runVisualGraph({ deps: { backgroundRemoval: VisualProcessorClient } })
      └→ graph.ts (StateGraph channels)
          └→ deliverNode(state)
              └→ state.deps.backgroundRemoval.removeBackground(...)
```

## 인프라 구성

### 포트 번호

| 서비스 | 포트 |
|--------|------|
| ant-api | 4100 |
| ant-realtime | 4101 |
| ant-preview | 4102 |
| **visual-processor** | **4103** |

### pnpm 스크립트

| 스크립트 | 동작 |
|---------|------|
| `pnpm dev:infra` | Redis + ChromaDB + Embedder + **visual-processor** 일괄 기동 |
| `pnpm dev:infra:visual` | visual-processor만 단독 기동 |
| `pnpm dev:infra:visual:down` | visual-processor만 중지 |

### 환경변수 (ant-cli 측)

| 변수 | 기본값 | 용도 |
|------|--------|------|
| `ANT_VISUAL_PROCESSOR_URL` | `http://localhost:4103` | 사이드카 접속 URL |

서버 측 환경변수는 [visual-processor/README.md](../../packages/ant-cli/src/periphery/integrations/visual-processor/README.md) 참조.

## 파일 구조

```
packages/ant-cli/src/
├── core/ports/
│   └── backgroundRemoval.ts              # Port interface
├── periphery/adapters/visualProcessor/
│   ├── VisualProcessorClient.ts          # HTTP adapter
│   └── NoopBackgroundRemoval.ts          # Noop adapter
├── periphery/integrations/visual-processor/
│   ├── README.md                         # 서버 기능 명세
│   ├── docker-compose.yml
│   └── server/
│       ├── Dockerfile
│       ├── requirements.txt
│       └── server.py
├── agents/creator/graph/visual/
│   ├── types.ts                          # VisualOutputSpec, ASSET_OUTPUT_SPECS
│   └── nodes/deliver.ts                  # 후처리 파이프라인
└── composition/orchestrator.ts           # DI 주입
```

## 경계

- Visual Job 워크플로우: [18-visual-job.md](18-visual-job.md)
- 에이전트 아키텍처: [11-agent-architecture.md](11-agent-architecture.md)
- 인프라스트럭처 (Redis, BullMQ): [02-infrastructure.md](02-infrastructure.md)
- 배포 가이드 (Pod 리소스, K8s, 스케일링): [cloud-deployment-guide.md](../infra/cloud-deployment-guide.md)
- 시스템 개요: [00-system-overview.md](00-system-overview.md)
