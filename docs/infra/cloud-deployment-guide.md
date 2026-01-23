# Ant Cloud Deployment Guide

DevOps 팀을 위한 EKS 기반 클라우드 배포 가이드입니다.

---

## 1. 아키텍처 개요

### 1.1 서버 명명 규칙

> **ant-api**, **ant-job**, **ant-preview**는 모두 `ant-cli` 패키지의 역할별 실행 모듈입니다.

| 서버명 | 실행 파일 | 역할 |
|-------|----------|------|
| **ant-api** | `server.mjs` | HTTP API, Proxy |
| **ant-job** | `start-job-worker.mjs` | AI Job 처리 |
| **ant-preview** | `start-preview-worker.mjs` | Preview 서버 관리 |

### 1.2 배포 모드

Ant는 두 가지 배포 모드를 지원합니다:

| 모드 | 설명 | 인프라 요구사항 |
|-----|------|----------------|
| **Local** | 단일 서버에서 모든 컴포넌트 실행 | 서버 1대 |
| **Cloud** | 분산 배포, 수평 확장 가능 | EKS + Redis |

### 1.3 Cloud 모드 아키텍처 (EKS)

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
│  │  ALB (Ingress) ─── ant.crosstoken.io/api                                │ │
│  └───────────────────────────────┬─────────────────────────────────────────┘ │
│                                  │                                            │
│                                  ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                          ant-api (HPA)                                   │ │
│  └──┬─────────────┬─────────────┬──────────────┬───────────────────────────┘ │
│     │             │             │              │                              │
│     │             │             │              └──────────────────┐           │
│     │             │             │                                 │           │
│     │TCP          │HTTP         │HTTP          HTTP               │HTTPS      │
│     │             │             │              │                   │           │
│     ▼             ▼             ▼              ▼                   ▼           │
│  ┌───────┐  ┌───────────┐  ┌─────────┐  ┌──────────┐    ┌──────────────────┐ │
│  │ redis │  │ant-preview│  │chromadb │  │ embedder │    │     LLM API      │ │
│  │ (svc) │  │  (svc)    │  │ (svc)   │  │  (svc)   │    │    (External)    │ │
│  │       │  │           │  │         │  │          │    └──────────────────┘ │
│  │-State │  └─────┬─────┘  └─────────┘  └──────────┘                         │
│  │-Queue │        │                                                          │
│  │-Pub/Sub│        │                                                          │
│  └───▲───┘        │                                                          │
│      │             │                                                          │
│      │TCP          │NFS                                                       │
│      │BullMQ Poll  │                                                          │
│      │             │                                                          │
│  ┌───┴─────────┐  │                                                          │
│  │  ant-job    │  │                                                          │
│  │  (KEDA)     │  │                                                          │
│  └──────┬──────┘  │                                                          │
│         │          │                                                          │
│         │NFS       │                                                          │
│         │          │                                                          │
│         ▼          ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                          EFS (Shared Storage)                            │ │
│  │                         /mnt/workspaces                                  │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

**도메인 구성 (환경별):**

| 환경 | ant-api | ant-ui |
|-----|---------|--------|
| Dev | `dev-ant.crosstoken.io/api` | `dev-ant.crosstoken.io` |
| Stg | `stg-ant.crosstoken.io/api` | `stg-ant.crosstoken.io` |
| Prod | `ant.crosstoken.io/api` | `ant.crosstoken.io` |

### 1.4 컴포넌트 역할 및 스케일링

| 컴포넌트 | 역할 | 스케일링 방식 |
|---------|------|--------------|
| **ant-api** | HTTP API, Proxy (Preview/IDE) | HPA (CPU/Request) |
| **ant-job** | AI Job 처리 (Code/Design) | **KEDA (Queue Depth)** |
| **ant-preview** | Preview 서버 관리 | HPA (CPU/Memory) |
| **ant-ui** | CSR SPA (React) | S3 + CloudFront |
| **Redis** | State, Queue, Pub/Sub | ElastiCache Cluster |
| **ChromaDB** | Vector DB (코드 검색/RAG) | Optional, Single Pod |
| **Embedder** | 텍스트 임베딩 생성 | Optional, Single Pod |

---

## 2. Pod 리소스 요구사항

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

| 항목 | 최소 | 권장 |
|-----|-----|-----|
| Replicas | 2 (HA) | 3+ (HPA) |
| CPU Request | 500m | 1 |
| Memory Request | 1Gi | 2Gi |

### 2.2 ant-job ⚠️ Long-Running Jobs

> **참고:** AI Job은 대부분 **I/O bound** (LLM API 호출, 파일 I/O)입니다.
> Pod 리소스에 따라 concurrency=2~4 설정 가능합니다.

```yaml
resources:
  requests:
    cpu: "1"
    memory: "4Gi"
  limits:
    cpu: "4"
    memory: "8Gi"
```

| 항목 | 최소 | 권장 |
|-----|-----|-----|
| Replicas | 2 | KEDA 자동 스케일링 |
| CPU Request | 1 | 2 |
| Memory Request | 4Gi | 8Gi |
| Concurrency | 2 | 2~4 (메모리 비례) |

**스케일링 공식:**
```
필요 Pod 수 = 동시 Job 수 ÷ concurrency
예: 20 Jobs ÷ 2 = 10 Pods
```

### 2.3 ant-preview

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "2Gi"
  limits:
    cpu: "2"
    memory: "4Gi"
```

| 항목 | 최소 | 권장 |
|-----|-----|-----|
| Replicas | 2 | 3+ (HPA) |
| CPU Request | 500m | 1 |
| Memory Request | 2Gi | 4Gi |

### 2.4 Redis (ElastiCache)

| 항목 | 최소 | 권장 |
|-----|-----|-----|
| 타입 | r6g.large | r6g.xlarge |
| Memory | 13 GB | 26 GB |
| 구성 | Single Node | Cluster Mode (3+ nodes) |

### 2.5 Vector Memory (Optional)

> ChromaDB + Embedder는 코드 검색/RAG 기능에 사용됩니다.
> 해당 기능을 사용하지 않으면 생략 가능합니다.

**ChromaDB (Vector Database)**

| 항목 | 최소 | 권장 |
|-----|-----|-----|
| Image | `chromadb/chroma:latest` | `chromadb/chroma:0.4.x` |
| CPU | 1 vCPU | 2 vCPU |
| Memory | 2 GB | 4 GB |
| Storage | 10 GB | 50 GB (SSD) |

**Embedder (Embedding Service)**

| 항목 | 최소 | 권장 |
|-----|-----|-----|
| Image | Custom (sentence-transformers) | Custom |
| CPU | 2 vCPU | 4 vCPU |
| Memory | 4 GB | 8 GB |
| GPU | - | Optional (faster) |

**통신:**
- ant-api → chromadb (HTTP): Vector 검색/저장
- ant-api → embedder (HTTP): 텍스트 임베딩 생성

**스케일링:**

| 컴포넌트 | 스케일링 | 비고 |
|---------|---------|------|
| ChromaDB | **Vertical** (단일 Pod) | 대용량 시 Chroma Cloud 고려 |
| Embedder | **Horizontal** (HPA 가능) | CPU 바운드, 병렬화 가능 |

> ⚠️ ChromaDB는 현재 내장 클러스터링을 지원하지 않습니다. 
> 대규모 환경에서는 [Chroma Cloud](https://www.trychroma.com/) 또는 Pinecone 등 관리형 서비스 권장.

---

## 3. Kubernetes 배포 가이드

### 3.1 필수 리소스

| 리소스 | 용도 |
|--------|------|
| Deployment | ant-api, ant-job, ant-preview |
| Service | ant-api, ant-preview (ClusterIP) |
| Ingress | ALB → ant-api |
| PVC | EFS (workspaces), gp3 (chromadb) |
| Secret | API Keys, Redis URL |

### 3.2 컨테이너 실행 커맨드

| 서버 | Command |
|------|---------|
| ant-api | `node dist/server.mjs` |
| ant-job | `node dist/start-job-worker.mjs` |
| ant-preview | `node dist/start-preview-worker.mjs` |

### 3.3 주요 설정 원칙

**스케일링:**
- ant-api: **HPA** (CPU 기반)
- ant-job: **KEDA** (Redis Queue Depth 기반) - [KEDA 설치 필요](https://keda.sh/)
- ant-preview: **HPA** (CPU/Memory 기반)

**볼륨:**
- `/mnt/workspaces`: EFS (ReadWriteMany) - ant-api, ant-job, ant-preview 공유
- ChromaDB: gp3 (ReadWriteOnce) - Optional

**Probe:**
- ant-api: `/api/health`
- ant-preview: `/health`
- ant-job: Probe 불필요 (Worker)

**Secret 관리:**
- API Keys, Redis URL은 K8s Secret 또는 AWS Secrets Manager 사용
- 환경변수로 주입

### 3.4 Vector Memory (Optional)

> 코드 검색/RAG 기능 사용 시에만 필요

| 컴포넌트 | Image |
|---------|-------|
| ChromaDB | `chromadb/chroma:latest` |
| Embedder | Custom (ECR) |

---

## 4. 환경변수

> **참조:** `packages/ant-cli/.env.example.cloud`

```bash
# 파일 복사 후 값 수정
cp packages/ant-cli/.env.example.cloud packages/ant-cli/.env
```

**서버별 필요 섹션:**

| 서버 | 필요 섹션 |
|-----|----------|
| ant-api | COMMON + ant-api |
| ant-job | COMMON + ant-job |
| ant-preview | COMMON + ant-preview |

**ant-ui (빌드 타임):**
```bash
VITE_CLOUD_BACKEND_BASE=https://ant.crosstoken.io/api
```

---

## 5. 네트워크 구성

**필수 통신:**

| From | To | 용도 |
|------|-----|------|
| ALB | ant-api | HTTPS Ingress |
| ant-api, ant-job, ant-preview | Redis | State, Queue |
| ant-api, ant-job | LLM API (External) | AI 호출 |
| ant-api | ant-preview | Preview 관리 |

**주의:**
- ant-job은 Inbound 불필요 (Worker)
- Redis는 VPC 내부에서만 접근 가능하게 설정

---

## 6. 스토리지

### 6.1 EFS 구성

```
/mnt/workspaces/           # ANT_WORKSPACE_BASE_PATH
├── {tenantId}/
│   └── {userId}/
│       └── {projectId}/
│           └── {feature}/
│               ├── src/
│               ├── package.json
│               └── ...
```

**EFS Requirements:**
- Performance mode: General Purpose
- Throughput mode: Bursting (또는 Provisioned for heavy load)
- Encryption: At rest enabled
- Access points: Create for `/mnt/workspaces`

---

## 7. Ant 특화 주의사항

### 스토리지

- **EFS 필수**: ant-api, ant-job, ant-preview가 동일 workspace 공유 (ReadWriteMany)
- EBS 불가

### 스케일링

- **ant-job**: KEDA + Redis Queue Depth 기반 권장
  - HPA(CPU/Memory)는 Queue 상태 반영 불가
- **동시 Job 수 = replicas × concurrency**
  - concurrency 높이면 Pod 메모리도 비례 증가

### Job 특성

- Timeout 없음 (완료까지 실행)
- 필요시 BullMQ `jobTimeout` 설정
