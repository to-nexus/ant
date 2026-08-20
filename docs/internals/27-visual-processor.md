# Visual Processor Integration

## Overview

The pipeline that applies post-processing (background removal, format conversion) to the final image in the Visual Job's deliver node. The actual image processing is delegated to a Python FastAPI sidecar (`visual-processor`), and ant-cli communicates with the sidecar through Hexagonal Architecture ports/adapters.

For the server's own functional specification (API spec, internal architecture), see [visual-processor/README.md](../../packages/ant-cli/src/periphery/integrations/visual-processor/README.md). Deployment (Pod resources, K8s, scaling) is in the scope of each deployment infrastructure.

## Architecture Decisions

### Why a separate sidecar

| Alternative | Reason for rejection |
|------|----------|
| Node.js native (ONNX Runtime) | PyTorch/ONNX bindings are unstable compared to the Python ecosystem; no BiRefNet implementation |
| Browser WASM (Transformers.js) | Cannot guarantee consistent server-side quality; depends on user device performance |
| Python call inside the ant-cli process | No memory isolation; a ~1.5 GB model would reside in the job worker process |

rembg + BiRefNet works reliably only in the Python ecosystem. Managing memory and CPU independently in a Docker container avoids affecting job worker stability.

### Why rembg + BiRefNet

| Model | Quality (DIS5K mAE) | Speed (CPU) | License |
|------|-----------------|-----------|---------|
| **BiRefNet-general** | **0.023** (SOTA) | 3–5s | MIT |
| ISNet | 0.041 | 1–2s | MIT |
| U2Net | 0.044 | ~1s | Apache-2.0 |
| SAM (ViT-H) | 0.031 | 10s+ | Apache-2.0 |

BiRefNet is optimal on both quality and license. The rembg library abstracts session management, image pre/post-processing, and model downloads.

## Processing Pipeline

### The deliver node call flow

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
                │                        N                        N (sidecar not running)
                │                        │                        │
                │                        ▼                        ▼
                │                   keep original             keep original (graceful)
                │
                ▼
         imageMime ≠ spec.format? ─── Y ── sharp format conversion
                │                     │
                N                     ▼
                │              converted buffer
                ▼
        writeFileSync (single disk write)
```

The deliver node applies post-processing only to the final image (finalImage). Drafts (draftImages) are previews for user selection, so they are saved untouched.

### Output Specs per Asset Type

| assetType | format | requiresBgRemoval | quality |
|-----------|--------|-------------------|---------|
| `logo` | png | true | — |
| `icon` | png | true | — |
| `illustration` | png | true | — |
| `hero` | jpeg | false | 90 |
| `general` | jpeg | false | 85 |

This mapping is defined as the `ASSET_OUTPUT_SPECS` constant in `types.ts`. The deliver node looks it up by `state.assetType`.

### Failure Policy

If any stage of bg-removal or format conversion fails, the original image is saved as-is (graceful degradation). The Visual Job works normally even in environments where the sidecar is not running — only the transparent-background processing is skipped.

## Hexagonal Architecture Integration

### Port

```
core/ports/backgroundRemoval.ts
├── BackgroundRemovalPort       (interface)
├── BackgroundRemovalResult     ({ data: Buffer, mimeType: 'image/png' })
└── BackgroundRemovalOptions    ({ model?: string })
```

`BackgroundRemovalPort` defines two methods:
- `removeBackground(imageData, mimeType, options?)` — perform background removal
- `isAvailable()` — check whether the service is reachable (used for graceful fallback)

### Adapters

| Adapter | Location | Role | isAvailable() |
|--------|------|------|---------------|
| `VisualProcessorClient` | `periphery/adapters/visualProcessor/` | Calls the sidecar's `/remove-bg` over HTTP | true when `/health` returns 200 |
| `NoopBackgroundRemoval` | Same | Pass-through (returns the original) | Always false |

`VisualProcessorClient` parses the server's `detail` field on error and includes it in the error message. The timeout is 60 seconds (accommodating BiRefNet on CPU with large images).

### DI (orchestrator.ts)

```
configData.visualSettings.removeBackground !== false
  → new VisualProcessorClient(ANT_VISUAL_PROCESSOR_URL)
  → else new NoopBackgroundRemoval()
```

The default is enabled (true). Can be explicitly disabled with `VisualSettings.removeBackground = false`.

### deps Passing Path

```
orchestrator.ts
  └→ runVisualGraph({ deps: { backgroundRemoval: VisualProcessorClient } })
      └→ graph.ts (StateGraph channels)
          └→ deliverNode(state)
              └→ state.deps.backgroundRemoval.removeBackground(...)
```

## Infrastructure Configuration

### Port Numbers

| Service | Port |
|--------|------|
| ant-api | 4100 |
| ant-realtime | 4101 |
| ant-preview (control plane) | 4102 |
| ant-preview (user content origin) | 4103 |
| **visual-processor** | **4104** (host) → 4103 (in-container) |

4103 on the host belongs to ant-preview's content listener
(`getPreviewContentPort` = `PORT + 1`), whose bind failure is fatal by design —
so the sidecar publishes on 4104 and keeps 4103 inside the container.

### pnpm Scripts

| Script | Behavior |
|---------|------|
| `pnpm dev:infra` | Starts Redis + ChromaDB + Embedder + **visual-processor** together |
| `pnpm dev:infra:visual` | Starts visual-processor alone |
| `pnpm dev:infra:visual:down` | Stops visual-processor alone |

### Environment Variables (ant-cli side)

| Variable | Default | Purpose |
|------|--------|------|
| `ANT_VISUAL_PROCESSOR_URL` | `http://localhost:4104` | Sidecar connection URL |

For server-side environment variables, see [visual-processor/README.md](../../packages/ant-cli/src/periphery/integrations/visual-processor/README.md).

## File Structure

```
packages/ant-cli/src/
├── core/ports/
│   └── backgroundRemoval.ts              # Port interface
├── periphery/adapters/visualProcessor/
│   ├── VisualProcessorClient.ts          # HTTP adapter
│   └── NoopBackgroundRemoval.ts          # Noop adapter
├── periphery/integrations/visual-processor/
│   ├── README.md                         # Server functional specification
│   ├── docker-compose.yml
│   └── server/
│       ├── Dockerfile
│       ├── requirements.txt
│       └── server.py
├── agents/creator/graph/visual/
│   ├── types.ts                          # VisualOutputSpec, ASSET_OUTPUT_SPECS
│   └── nodes/deliver.ts                  # Post-processing pipeline
└── composition/orchestrator.ts           # DI wiring
```

## Boundaries

- Visual Job workflow: [18-visual-job.md](18-visual-job.md)
- Agent architecture: [11-agent-architecture.md](11-agent-architecture.md)
- Infrastructure (Redis, BullMQ): [02-infrastructure.md](02-infrastructure.md)
- System overview: [00-system-overview.md](00-system-overview.md)
