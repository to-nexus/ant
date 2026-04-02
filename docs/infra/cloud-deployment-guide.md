# Ant Cloud Deployment Guide

EKS-based cloud deployment guide for DevOps teams.

---

## 1. Architecture Overview

### 1.1 Server Naming Convention

> **ant-api**, **ant-realtime**, **ant-job**, **ant-preview** are all execution modules of the `ant-cli` package by role.

| Server | Entrypoint | Role |
|-------|----------|------|
| **ant-api** | `server.js` | HTTP REST API, IDE Proxy |
| **ant-realtime** | `start-realtime-server.js` | SSE (Server-Sent Events) |
| **ant-job** | `start-job-worker.js` | AI Job Processing |
| **ant-preview** | `start-preview-server.js` | Preview API + Proxy + Dev Server |

> **Note**: `ant-api` and `ant-realtime` are separated for independent scaling. All services use **Round-robin** (Redis-based state management, no Sticky Session needed). See [23-cloud-ide.md](../architecture/23-cloud-ide.md) for details.

### 1.2 Deployment Modes

Ant uses **unified architecture** for both local and cloud deployments.

| Mode | Description | Difference |
|-----|------|----------------|
| **Local** | All components on single machine | Auth: `local:local` (auto), IDE: Docker |
| **Cloud** | Distributed deployment, horizontally scalable | Auth: OAuth required, IDE: Kubernetes |

> **Note**: Both modes require Redis and Preview Worker. The only differences are authentication mode and IDE orchestration.

### 1.3 Cloud Mode Architecture (EKS)

```
Arrow Direction: A ──▶ B means "A initiates connection to B"
Service names used for K8s Service Discovery (not hardcoded ports)

                                      ┌─────────────────┐
                                      │   ant-ui (S3)   │
                                      │   CloudFront    │
                                      └────────┬────────┘
                                               │ HTTPS
                                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                                 EKS Cluster                                   │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  ALB (Ingress)                                                           │ │
│  │  ├── /api/* ──────────▶ ant-api (Round-robin)                           │ │
│  │  ├── /realtime/* ─────▶ ant-realtime (Round-robin, Redis Pub/Sub)       │ │
│  │  └── /preview/* ──────▶ ant-preview (Round-robin, Redis State)          │ │
│  └───────────────────────────────┬───────────────┬─────────────────────────┘ │
│                                  │               │                            │
│                                  ▼               ▼                            │
│  ┌──────────────────────┐  ┌──────────────────────┐                         │
│  │   ant-api (HPA)      │  │ ant-realtime (HPA)   │                         │
│  │   REST API, Proxy    │  │ SSE Only             │                         │
│  └──┬────────┬────┬─────┘  └──────────┬──────────┘                         │
│     │        │    │                    │                                     │
│     │        │    └───────┬────────────┤                                     │
│     │TCP     │HTTP        │            │TCP (Pub/Sub)                        │
│     │        │(Proxy)     │            │                                     │
│     ▼        ▼            │            ▼                                     │
│  ┌───────┐ ┌───────────┐  │         ┌───────┐                               │
│  │ redis │ │ant-preview│  │         │ redis │                               │
│  │ (svc) │ │  (svc)    │  │         │Pub/Sub│                               │
│  │       │ │           │  │         └───────┘                               │
│  │-State │ └─────┬─────┘  │                                                  │
│  │-Queue │       │        └─────────────────────────────────┐                │
│  │-Pub/Sub│       │                                          │                │
│  └───▲───┘       │                                          │                │
│      │            │                                          │                │
│      │TCP         │NFS       ┌──────────────────┐           │HTTP            │
│      │BullMQ Poll │          │     LLM API      │◀──────────┤(Proxy)         │
│      │            │          │    (External)    │           │                │
│  ┌───┴─────────┐ │          └──────────────────┘           ▼                │
│  │  ant-job    │ │                                   ┌───────────┐           │
│  │  (KEDA)     │ │                                   │  ant-ide  │           │
│  └──────┬──────┘ │                                   │  (Pods)   │           │
│         │         │                                   │  Dynamic  │           │
│         │NFS      │                                   │  1/user   │           │
│         │         │                                   └─────┬─────┘           │
│         ▼         ▼                                         │NFS             │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                          EFS (Shared Storage)                            │ │
│  │                         /mnt/workspaces                                  │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Domain Configuration (per environment):**

| Environment | ant-api | ant-realtime | ant-ui |
|-----|---------|--------------|--------|
| Dev | `dev-ant.crosstoken.io/api` | `dev-ant.crosstoken.io/realtime` | `dev-ant.crosstoken.io` |
| Stg | `stg-ant.crosstoken.io/api` | `stg-ant.crosstoken.io/realtime` | `stg-ant.crosstoken.io` |
| Prod | `ant.crosstoken.io/api` | `ant.crosstoken.io/realtime` | `ant.crosstoken.io` |

> **Note**: All services use **Round-robin**. No Sticky Session needed (Redis Pub/Sub for SSE, Redis State for Preview/IDE).

### 1.4 Component Roles and Scaling

| Component | Role | Scaling Method | LB Strategy |
|---------|------|--------------|-------------|
| **ant-api** | HTTP REST API, IDE Proxy | HPA (CPU/Request) | Round-robin |
| **ant-realtime** | SSE (Server-Sent Events) | HPA (Connections) | Round-robin |
| **ant-job** | AI Job Processing (Code/Design) | **KEDA (Queue Depth)** | N/A |
| **ant-preview** | Preview API + Proxy + Dev Server | HPA (CPU/Memory) | Round-robin |
| **ant-ide** | Cloud IDE (VSCode) | **Dynamic (1 Pod/User)** | N/A |
| **ant-ui** | CSR SPA (React) | S3 + CloudFront (CDN) | CDN |
| **Redis** | State, Queue, Pub/Sub | ElastiCache Cluster | N/A |
| **ChromaDB** | Vector DB (Code Search/RAG) | Vertical (Single Pod) | N/A |
| **Embedder** | Text Embedding Generation | Horizontal (HPA) | Round-robin |
| **visual-processor** | Image Background Removal (rembg/BiRefNet) | Horizontal (HPA) | Round-robin |

> **Why No Sticky Session?**: All services use Redis-based state management. SSE uses Redis Pub/Sub (all pods subscribe and can deliver). Preview/IDE use Redis State (any pod can lookup and proxy to correct target). Reconnections to different pods work correctly.

---

## 2. Pod Resource Requirements

### 2.1 ant-api

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    cpu: "2"
    memory: "4Gi"
```

| Item | Minimum | Recommended |
|-----|-----|-----|
| Replicas | 2 (HA) | 3+ (HPA) |
| CPU Request | 500m | 1 |
| Memory Request | 1Gi | 2Gi |

### 2.2 ant-realtime

> **Note:** SSE server handling real-time updates. Lightweight but connection-heavy.

```yaml
resources:
  requests:
    cpu: "250m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "1Gi"
```

| Item | Minimum | Recommended |
|-----|-----|-----|
| Replicas | 2 (HA) | 3+ (HPA) |
| CPU Request | 250m | 500m |
| Memory Request | 512Mi | 1Gi |

**Scaling Considerations:**
- Scale based on **connection count**, not CPU
- Each pod can handle thousands of SSE connections
- Memory grows with connection count
- **No Sticky Session needed** (Redis Pub/Sub broadcasts to all pods)

### 2.3 ant-job ⚠️ Long-Running Jobs

> **Note:** AI Jobs are mostly **I/O bound** (LLM API calls, file I/O).
> Concurrency can be set to 2~4 depending on pod resources.

```yaml
resources:
  requests:
    cpu: "1"
    memory: "4Gi"
  limits:
    cpu: "4"
    memory: "8Gi"
```

| Item | Minimum | Recommended |
|-----|-----|-----|
| Replicas | 2 | KEDA Auto-scaling |
| CPU Request | 1 | 2 |
| Memory Request | 4Gi | 8Gi |
| Concurrency | 2 | 2~4 (proportional to memory) |

**Scaling Formula:**
```
Required Pods = Concurrent Jobs ÷ concurrency
Example: 20 Jobs ÷ 2 = 10 Pods
```

### 2.4 ant-preview

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "2Gi"
  limits:
    cpu: "2"
    memory: "4Gi"
```

| Item | Minimum | Recommended |
|-----|-----|-----|
| Replicas | 2 | 3+ (HPA) |
| CPU Request | 500m | 1 |
| Memory Request | 2Gi | 4Gi |

### 2.5 ant-ide (Cloud IDE)

> **Note:** IDE Pods are dynamically created per user/project.
> Managed by `KubernetesIDEOrchestrator` (requires `ANT_K8S_NAMESPACE`).

```yaml
resources:
  requests:
    cpu: "1"
    memory: "1Gi"
  limits:
    cpu: "2"
    memory: "2Gi"
```

| Item | Minimum | Recommended |
|-----|-----|-----|
| Image | `gitpod/openvscode-server:latest` | Pinned version |
| CPU Request | 1 | 1 |
| Memory Request | 1Gi | 2Gi |
| Scaling | Dynamic (1 Pod per user/project) | With idle timeout |

**Scaling Characteristics:**
- Pods created on-demand when user opens IDE
- Pods terminated after idle timeout (configurable)
- Each Pod mounts user's workspace from EFS
- No HPA needed (lifecycle managed by `KubernetesIDEOrchestrator`)

### 2.6 ant-ui (S3 + CloudFront)

> CSR SPA (React/Vite). Build output (`dist/`) deployed to S3 + CloudFront.

| Environment | Method |
|-------------|--------|
| **Production** | S3 + CloudFront (CDN) |
| **Local Dev** | `pnpm dev:ui` (Vite dev server) |

**CloudFront Settings:**
- Error Pages: 404 → `/index.html` (SPA routing)
- SSL: ACM Certificate

> ⚠️ Vite env vars are injected at **build time**. Separate builds required per environment.

### 2.7 Redis (ElastiCache)

| Item | Minimum | Recommended |
|-----|-----|-----|
| Type | r6g.large | r6g.xlarge |
| Memory | 13 GB | 26 GB |
| Configuration | Single Node | Cluster Mode (3+ nodes) |

### 2.8 Vector Memory

> ChromaDB + Embedder are used for code search/RAG features.
> **Required** for AI job execution (code analysis, context retrieval).

**ChromaDB (Vector Database)**

| Item | Minimum | Recommended |
|-----|-----|-----|
| Image | `chromadb/chroma:latest` | `chromadb/chroma:0.4.x` |
| CPU | 1 vCPU | 2 vCPU |
| Memory | 2 GB | 4 GB |
| Storage | 10 GB | 50 GB (SSD) |

**Embedder (Embedding Service)**

| Item | Minimum | Recommended |
|-----|-----|-----|
| Image | Custom (sentence-transformers) | Custom |
| CPU | 2 vCPU | 4 vCPU |
| Memory | 4 GB | 8 GB |
| GPU | - | Optional (faster) |

**Communication:**
- ant-api → chromadb (HTTP): Vector search/storage
- ant-api → embedder (HTTP): Text embedding generation

**Scaling:**

| Component | Scaling | Notes |
|---------|---------|------|
| ChromaDB | **Vertical** (Single Pod) | Consider Chroma Cloud for large scale |
| Embedder | **Horizontal** (HPA possible) | CPU bound, parallelizable |

> ⚠️ ChromaDB does not currently support built-in clustering.
> For large-scale environments, consider managed services like [Chroma Cloud](https://www.trychroma.com/) or Pinecone.

### 2.9 visual-processor (Background Removal)

> **Note:** Python FastAPI sidecar for AI background removal. Uses rembg + BiRefNet model.
> Stateless service — horizontal scaling possible. Model weights reside in process memory (~1.5 GB per pod).

```yaml
resources:
  requests:
    cpu: "1"
    memory: "2Gi"
  limits:
    cpu: "2"
    memory: "4Gi"
```

| Item | Minimum | Recommended |
|-----|-----|-----|
| Image | Custom (rembg + FastAPI) | Custom |
| Replicas | 1 | 2+ (HPA) |
| CPU Request | 1 | 2 |
| Memory Request | 2Gi | 4Gi |
| GPU | - | Optional (significantly faster) |
| Port | 4103 | 4103 |

**Model Download:**
- Default model (birefnet-general) is ~1.2 GB, downloaded on first startup
- Use a PVC or pre-baked image to avoid download delay on pod scaling
- Docker volume `rembg-models` maps to `~/.u2net/` for local dev

**Scaling:**

| Load | Replicas | RAM |
|------|----------|-----|
| Low (<10 req/min) | 1 | 2–4 GB |
| Medium (10–50 req/min) | 2–3 | 4–12 GB total |
| High (>50 req/min) | GPU pods | 2 GB + VRAM |

**GPU Support (Future):**
- Replace `rembg[cpu]` with `rembg[gpu]` in `requirements.txt`
- Use `nvidia/cuda:12.1.0-runtime-ubuntu22.04` as base image
- Add NVIDIA device plugin to K8s nodes

**Communication:**
- ant-job → visual-processor (HTTP): Background removal requests from deliver node
- Endpoint: `POST /remove-bg`, `GET /health`

**Environment Variables:**

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REMBG_MODEL` | No | `birefnet-general` | Default model to preload at startup |
| `MAX_FILE_SIZE_MB` | No | `20` | Max upload file size in MB |
| `MAX_CONCURRENCY` | No | `1` | Concurrent requests per worker process |
| `PROCESSING_TIMEOUT_S` | No | `60` | Per-request processing timeout (seconds) |
| `MAX_PIXELS` | No | `16777216` | Max image pixels (width x height). Default = 4096x4096 |
| `UVICORN_WORKERS` | No | `2` | Worker process count. Total throughput = workers × MAX_CONCURRENCY |

> Set `ANT_VISUAL_PROCESSOR_URL` in ant-job environment to point to visual-processor service URL (e.g., `http://visual-processor:4103`).

---

## 3. Kubernetes Deployment Guide

### 3.1 Required Resources

**EKS Resources:**

| Resource | Purpose |
|--------|------|
| Deployment | ant-api, ant-realtime, ant-job, ant-preview, visual-processor |
| Service | ant-api, ant-realtime, ant-preview, visual-processor (ClusterIP) |
| Ingress | ALB → ant-api (/api/*), ant-realtime (/realtime/*), ant-preview (/preview/*) |
| PVC | EFS (workspaces), gp3 (chromadb) |
| Secret | API Keys, Redis URL |
| Namespace | ant-ide (for IDE Pods) |
| ServiceAccount | ant-api (for K8s API access to manage IDE Pods) |
| RBAC | Role/RoleBinding for IDE Pod management |

> **Important**: All Ingress paths use **Round-robin**. No Sticky Session needed (all services use Redis-based state management).

**AWS Resources (ant-ui):**

| Resource | Purpose |
|--------|------|
| S3 Bucket | Static file hosting (dist/) |
| CloudFront Distribution | CDN, SSL termination |
| ACM Certificate | HTTPS for CloudFront |
| Route53 Record | DNS (ant.crosstoken.io → CloudFront) |

### 3.2 Container Run Commands

| Server | Command |
|------|---------|
| ant-api | `node dist/server.js` |
| ant-realtime | `node dist/start-realtime-server.js` |
| ant-job | `node dist/start-job-worker.js` |
| ant-preview | `node dist/start-preview-server.js` |
| visual-processor | `uvicorn server:app --host 0.0.0.0 --port 4103` |

### 3.3 Key Configuration Principles

**Scaling:**
- ant-api: **HPA** (CPU-based, Round-robin LB)
- ant-realtime: **HPA** (Connection-based, Round-robin LB)
- ant-job: **KEDA** (Redis Queue Depth-based) - [KEDA installation required](https://keda.sh/)
- ant-preview: **HPA** (CPU/Memory-based)
- ant-ide: **Dynamic** (Pods created/deleted by `KubernetesIDEOrchestrator`)

**Volumes:**
- `/mnt/workspaces`: EFS (ReadWriteMany) - shared by ant-api, ant-realtime, ant-job, ant-preview, ant-ide
- ChromaDB: gp3 (ReadWriteOnce)

**Probes:**
- ant-api: `/api/health`
- ant-realtime: `/health` or `/api/health`
- ant-preview: `/health`
- ant-job: No probe needed (Worker)
- ant-ide: No probe needed (Pods managed by ant-api)

**Secret Management:**
- Use K8s Secret or AWS Secrets Manager for API Keys, Redis URL
- Inject via environment variables

### 3.4 Vector Memory

> Required for AI job execution (code search/RAG)

| Component | Image |
|---------|-------|
| ChromaDB | `chromadb/chroma:latest` |
| Embedder | Custom (ECR) |

---

## 4. Environment Variables

> **Reference:** `packages/ant-cli/.env.example.cloud`

```bash
# Copy and modify values
cp packages/ant-cli/.env.example.cloud packages/ant-cli/.env
```

**Required sections per server:**

| Server | Required Sections |
|-----|----------|
| ant-api | COMMON + LLM API + API SERVER |
| ant-realtime | COMMON |
| ant-job | COMMON + LLM API + JOB WORKER |
| ant-preview | COMMON |

**Key Environment Variables:**

| Variable | Description | Required By | Example |
|----------|-------------|-------------|---------|
| `ANT_SERVER_MODE` | Authentication mode | All | `cloud` |
| `ANT_REDIS_URL` | Redis connection URL | All | `redis://redis.internal:6379` |
| `ANT_WORKSPACE_BASE_PATH` | Workspace root path | All | `/mnt/workspaces` |
| `ANT_K8S_NAMESPACE` | IDE K8s namespace | ant-api | `ant-ide` |
| `ANT_API_URL` | API Server URL | ant-job | `http://ant-api:8080` |
| `ANTHROPIC_API_KEY` | Claude API Key | ant-api, ant-job | `sk-ant-...` |

**Port Configuration:**

> ⚠️ K8s 환경에서는 PORT 환경변수가 불필요합니다. 모든 서비스는 기본 포트 8080을 사용하며, K8s Service가 라우팅합니다.
>
> 로컬 개발 환경에서는 `package.json` 스크립트에서 `PORT=4100` 등으로 포트 충돌을 방지합니다.

**ant-ui:**

| Variable | Purpose | Required |
|----------|---------|----------|
| `VITE_CLOUD_BACKEND_BASE` | Cloud backend URL (without /api suffix) | Yes |
| `VITE_SKIP_AUTH_FOR_LOCALHOST` | Skip OAuth for local mode | Optional |

> ⚠️ 사용자는 UI에서 백엔드 모드(local/cloud)와 로컬 포트를 설정할 수 있습니다.
> - **Cloud 모드**: `VITE_CLOUD_BACKEND_BASE`로 연결 (Ingress 라우팅)
> - **Local 모드**: `http://localhost:{port}`로 연결 (사용자가 온프레미스 백엔드 사용 시)

---

## 5. Network Configuration

**Required Communication:**

| From | To | Purpose |
|------|-----|------|
| User Browser | CloudFront | ant-ui (static assets) |
| User Browser | ALB (/api/*) | ant-api (REST API calls) |
| User Browser | ALB (/realtime/*) | ant-realtime (SSE connections) |
| User Browser | ALB (/preview/*) | ant-preview (Preview API + Proxy) |
| ALB | ant-api | HTTPS Ingress (Round-robin) |
| ALB | ant-realtime | HTTPS Ingress (Round-robin) |
| ALB | ant-preview | HTTPS Ingress (Round-robin) |
| ant-api, ant-realtime, ant-job, ant-preview | Redis | State, Queue, Pub/Sub |
| ant-api, ant-job | LLM API (External) | AI Calls |
| ant-api | ant-ide Pods | IDE Proxy |
| ant-ide | EFS | Workspace Mount |

**Notes:**
- ant-ui: CloudFront serves static files (S3 origin), API calls go to ALB
- ant-realtime: SSE uses Redis Pub/Sub (Round-robin OK)
- ant-job does not need Inbound (Worker pulls from queue)
- ant-ide Pods are created dynamically by ant-api via K8s API
- Redis should only be accessible within VPC
- Redis Pub/Sub broadcasts messages from ant-job to ant-realtime for SSE delivery

---

## 6. Storage

### 6.1 EFS Configuration

```
/mnt/workspaces/                    # ANT_WORKSPACE_BASE_PATH
├── {organizationId}/               # e.g., to.nexus
│   └── {userId}/                   # e.g., probe
│       └── {projectId}/            # e.g., my-app
│           ├── config.json
│           ├── codebase/           # Git repository
│           └── features/
│               └── {featureId}/
│                   ├── inputs/
│                   ├── outputs/
│                   └── sessions/
```

> **Note**: Path resolution is handled by `UnifiedWorkspaceResolver` using `userContext` from authentication layer.

**EFS Requirements:**
- Performance mode: General Purpose
- Throughput mode: Bursting (or Provisioned for heavy load)
- Encryption: At rest enabled
- Access points: Create for `/mnt/workspaces`

---

## 7. Ant-Specific Considerations

### Infrastructure (Required)

| Component | Requirement | Implementation |
|-----------|-------------|----------------|
| **Redis** | Required (both local & cloud) | `RedisStateStore` |
| **Job Queue** | Required (both local & cloud) | `BullMQJobQueue` |
| **Realtime Server** | Required (both local & cloud) | `RealtimeServer` (SSE + Redis Pub/Sub) |
| **Preview Server** | Required (both local & cloud) | `PreviewServer` (API + Proxy + Dev Server) |
| **IDE** | Docker (local) or K8s (cloud) | `LocalIDEOrchestrator` / `KubernetesIDEOrchestrator` |

> **Note**: Local and cloud use identical infrastructure components. Only authentication mode and IDE orchestration differ.
> 
> **Architecture Change**: SSE is now handled by dedicated `ant-realtime` server (separated from `ant-api`). See [23-cloud-ide.md](../architecture/23-cloud-ide.md) for details.

### Storage

- **EFS Required**: ant-api, ant-realtime, ant-job, ant-preview share the same workspace (ReadWriteMany)
- EBS not supported

### Scaling

- **ant-job**: KEDA + Redis Queue Depth-based recommended
  - HPA (CPU/Memory) cannot reflect queue state
- **Concurrent Jobs = replicas × concurrency**
  - Increasing concurrency requires proportional pod memory increase

### Job Characteristics

- No timeout (runs until completion)
- Configure BullMQ `jobTimeout` if needed

### Authentication Mode

| Mode | `ANT_SERVER_MODE` | Behavior |
|------|-------------------|----------|
| Local | `local` | Auth skipped, tenant auto-set to `local:local` |
| Cloud | `cloud` | OAuth/explicit auth required |

### IDE Orchestration

| Environment | `ANT_K8S_NAMESPACE` | Orchestrator |
|-------------|---------------------|--------------|
| Local | Not set | `LocalIDEOrchestrator` (Docker) |
| Cloud | Set (e.g., `ant-ide`) | `KubernetesIDEOrchestrator` (K8s) |

---

## 8. Ingress Configuration Examples

### 8.1 ALB Ingress for ant-api (Round-robin)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ant-api-ingress
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
spec:
  rules:
  - host: ant.crosstoken.io
    http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: ant-api
            port:
              number: 8080
```

### 8.2 ALB Ingress for ant-realtime (Round-robin)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ant-realtime-ingress
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    # SSE optimizations — prevent ALB from dropping long-lived connections
    alb.ingress.kubernetes.io/idle-timeout: '3600'
    alb.ingress.kubernetes.io/backend-protocol: HTTP
    alb.ingress.kubernetes.io/load-balancer-attributes: idle_timeout.timeout_seconds=3600
    alb.ingress.kubernetes.io/target-group-attributes: deregistration_delay.timeout_seconds=30
    # No Sticky Session needed - Redis Pub/Sub handles broadcast
spec:
  rules:
  - host: ant.crosstoken.io
    http:
      paths:
      - path: /realtime
        pathType: Prefix
        backend:
          service:
            name: ant-realtime
            port:
              number: 8080
```

> **Note**: No Sticky Session needed. Redis Pub/Sub broadcasts messages to all pods. Reconnections to different pods work correctly.

> **SSE-specific annotations**:
> - `idle-timeout: 3600` — ALB default is 60s, far too short for SSE. 1 hour keeps connections alive between heartbeats (10s interval).
> - `backend-protocol: HTTP` — Forces HTTP/1.1. HTTP/2 GOAWAY frames can prematurely close SSE streams.
> - `deregistration_delay: 30` — During rolling deploys, existing connections are drained for 30s. SSE clients auto-reconnect, so a short delay is sufficient.

### 8.3 Preview 리소스 경로 처리 (Path Rewrite)

Preview 페이지에서 로드하는 리소스 (`/logos/*`, `/icons/*`, `/_next/*` 등)의 절대 경로 문제는 **서버 사이드 Path Rewrite**로 해결합니다.

> **Note**: ALB Controller는 URI 기반 라우팅만 지원합니다 (Referer, Header 기반 라우팅 불가).

**동작 방식:**
```
1. Dev Server 렌더링: <img src="/logos/header.svg">

2. PreviewProxy (ant-preview) Rewrite:
   <img src="/preview/org:user:proj:feat/logos/header.svg">

3. 브라우저 요청: GET /preview/org:user:proj:feat/logos/header.svg

4. Ingress: /preview/* → ant-preview ✅
```

**Ingress 설정 (ALB):**

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ant-ingress
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
spec:
  rules:
  - host: ant-server.crosstoken.io
    http:
      paths:
      - path: /realtime
        pathType: Prefix
        backend:
          service:
            name: ant-realtime
            port:
              number: 8080
      - path: /preview
        pathType: Prefix
        backend:
          service:
            name: ant-preview
            port:
              number: 8080
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: ant-api
            port:
              number: 8080
      - path: /ide
        pathType: Prefix
        backend:
          service:
            name: ant-api
            port:
              number: 8080
      - path: /
        pathType: Prefix
        backend:
          service:
            name: ant-api
            port:
              number: 8080
```

**라우팅 동작:**

| 요청 | 라우팅 대상 | 비고 |
|-----|-------------|------|
| `/preview/org:user:proj:feat/*` | ant-preview | Preview 페이지 + 모든 리소스 |
| `/api/*` | ant-api | REST API |
| `/ide/*` | ant-api | IDE Proxy |
| `/*` | ant-api | Default (SSR, etc.) |

> **Note**: ant-preview의 `previewProxy`가 HTML/JS/CSS에서 절대 경로를 `/preview/:serverKey/` prefix로 변환합니다.
> SSR 앱의 경우 hydration mismatch 경고가 발생할 수 있으나 기능에는 영향 없습니다.
