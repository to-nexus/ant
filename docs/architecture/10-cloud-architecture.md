# ANT Cloud Architecture

> Multi-Pod 클라우드 환경을 위한 아키텍처 설계

## 1. 개요

### 1.1 Modular Monolith 구조

ANT는 **단일 코드베이스** (`ant-cli`)에서 **다중 서비스**로 배포되는 Modular Monolith 구조:

```
ant-cli (단일 코드베이스)
    │
    ├── ant-api        # REST API + IDE 프록시
    ├── ant-preview    # Preview 프록시 + Dev Server
    ├── ant-realtime   # SSE 전용
    └── ant-job        # Job 실행 (LLM 호출)
```

### 1.2 서비스 및 컴포넌트 매핑

| 서비스 | 컴포넌트 | 역할 | 스케일링 | LB 정책 | Multi-Pod |
|--------|----------|------|----------|---------|-----------|
| `ant-api` | API Server | REST API, SSR | HPA | Round-robin | ✅ Stateless |
| `ant-api` | IDE Orchestrator | IDE Pod 생성/관리 | - | - | ✅ Redis 상태 |
| `ant-api` | IDE Proxy | IDE 요청 프록시 | - | - | ✅ Redis 조회 (Pod IP) |
| `ant-preview` | Preview Service | Dev Server 실행 | HPA | Round-robin | ✅ Redis 상태 관리 |
| `ant-preview` | Preview Proxy | Preview 요청 프록시 | - | - | ✅ Redis 조회 (Pod IP) |
| `ant-realtime` | SSE Service | SSE 연결 관리 | KEDA | Round-robin | ✅ Redis Pub/Sub |
| `ant-job` | Job Worker | LLM 호출, 코드 생성 | KEDA | N/A (Queue) | ✅ BullMQ |
| (동적) | IDE Pod | VS Code 환경 | 사용자당 1개 | N/A | ✅ K8s Pod |

> **Note**: 모든 서비스가 Redis 기반 상태 관리를 사용하여 **Sticky Session 불필요**.

**공통 컴포넌트** (모든 서비스에서 사용):

| 컴포넌트 | 역할 | Multi-Pod |
|----------|------|-----------|
| Chat/Kanban/Workflow | 상태 관리 | ✅ Redis 상태 + Pub/Sub |
| Redis | 상태 저장, Pub/Sub, Port Registry | ✅ 공유 인프라 |
| EFS | 워크스페이스 파일 저장 | ✅ ReadWriteMany |

---

## 2. 전체 아키텍처

### 2.1 시스템 구성도

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Internet                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AWS ALB (Application Load Balancer)                  │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         Ingress Rules                                │   │
│   │                                                                      │   │
│   │   /realtime/*  ──────────────────────────►  ant-realtime            │   │
│   │                                              (Round-robin)           │   │
│   │                                                                      │   │
│   │   /preview/*   ──────────────────────────►  ant-preview             │   │
│   │                                              (Round-robin)           │   │
│   │                                                                      │   │
│   │   /*           ──────────────────────────►  ant-api                 │   │
│   │                                              (Round-robin, Default)  │   │
│   │                                                                      │   │
│   │   ※ /ide/* 요청은 /* 규칙에 의해 ant-api로 라우팅                    │   │
│   │   ※ ALB는 WebSocket 자동 지원 (IDE 터미널 등)                        │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                    │                    │
                    ▼                    ▼                    ▼
┌───────────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐
│     ant-realtime      │  │      ant-preview      │  │       ant-api         │
│     (SSE Server)      │  │   (Preview Server)    │  │    (API Server)       │
│                       │  │                       │  │                       │
│  ┌─────────────────┐  │  │  ┌─────────────────┐  │  │  ┌─────────────────┐  │
│  │   SSEService    │  │  │  │ PreviewService  │  │  │  │   REST API      │  │
│  │                 │  │  │  │                 │  │  │  │                 │  │
│  │ • Feature SSE   │  │  │  │ • Dev Server    │  │  │  │ • /api/*        │  │
│  │ • Workflow SSE  │  │  │  │   (Vite, Next)  │  │  │  │ • Jobs          │  │
│  │ • Redis Pub/Sub │  │  │  │ • Port 30000+   │  │  │  │ • Chat          │  │
│  └─────────────────┘  │  │  └─────────────────┘  │  │  │ • Files         │  │
│                       │  │                       │  │  └─────────────────┘  │
│                       │  │  ┌─────────────────┐  │  │                       │
│                       │  │  │ Preview Proxy   │  │  │  ┌─────────────────┐  │
│                       │  │  │                 │  │  │  │   IDE Proxy     │  │
│                       │  │  │ /preview/:key/* │  │  │  │                 │  │
│                       │  │  │ → localhost     │  │  │  │ /ide/:key/*     │  │
│                       │  │  └─────────────────┘  │  │  │ → K8s Pod IP    │  │
│                       │  │                       │  │  └─────────────────┘  │
│                       │  │                       │  │                       │
│                       │  │                       │  │  ┌─────────────────┐  │
│                       │  │                       │  │  │ IDE Orchestrator│  │
│                       │  │                       │  │  │                 │  │
│                       │  │                       │  │  │ • Pod 생성/삭제  │  │
│                       │  │                       │  │  │ • Redis 등록    │  │
│                       │  │                       │  │  └─────────────────┘  │
└───────────┬───────────┘  └───────────┬───────────┘  └───────────┬───────────┘
            │                          │                          │
            └──────────────────────────┼──────────────────────────┘
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            ▼                          ▼                          ▼
     ┌───────────┐              ┌───────────┐              ┌───────────┐
     │   Redis   │              │  ant-job  │              │    EFS    │
     │           │              │           │              │           │
     │ • State   │◄────────────►│ • BullMQ  │              │ • 워크스페이스│
     │ • Pub/Sub │              │ • LLM 호출 │──────────────►│ • 코드 저장 │
     │ • Port Map│              │ • 코드 생성│              │           │
     └───────────┘              └───────────┘              └───────────┘
                                                                  │
                                                                  │
                                    ┌─────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────────┐
                    │         ant-ide namespace         │
                    │                                   │
                    │   ┌─────────┐  ┌─────────┐       │
                    │   │IDE Pod A│  │IDE Pod B│  ...  │
                    │   │         │  │         │       │
                    │   │openvscode│  │openvscode│      │
                    │   │:3000    │  │:3000    │       │
                    │   │         │  │         │       │
                    │   │ EFS     │  │ EFS     │       │
                    │   │ Mount   │  │ Mount   │       │
                    │   └─────────┘  └─────────┘       │
                    └───────────────────────────────────┘
```

### 2.2 Ingress 라우팅 규칙

| Priority | Path | Target | LB Policy | 비고 |
|----------|------|--------|-----------|------|
| 1 | `/realtime/*` | ant-realtime | Round-robin | Redis Pub/Sub 기반 |
| 2 | `/preview/*` | ant-preview | Round-robin | Redis 상태 관리 기반 |
| 3 | `/*` | ant-api | Round-robin | Default (REST, IDE, SSR) |

> **Why No Sticky Session?**
> - **SSE (ant-realtime)**: Redis Pub/Sub로 모든 Pod가 이벤트 수신. 재연결 시 다른 Pod도 OK.
> - **Preview (ant-preview)**: Redis에서 Dev Server Pod IP 조회 → 해당 Pod로 프록시. 0.0.0.0 binding.
> - **IDE (ant-api)**: Redis에서 IDE Pod IP 조회 → K8s Pod로 프록시.

**라우팅 동작:**
- `/realtime/stream` → ant-realtime (SSE)
- `/preview/org:user:proj:feat/` → ant-preview (Preview)
- `/api/jobs/...` → ant-api (REST)
- `/ide/org:user:proj/` → ant-api (IDE Proxy)
- `/_next/...` → ant-api (SSR Assets)

### 2.3 WebSocket 지원

| 경로 | 프로토콜 | 용도 | 지원 |
|------|----------|------|------|
| `/ide/:key/*` | WebSocket | IDE 터미널, 파일 변경 | ✅ ALB 자동 지원 |
| `/preview/:key/*` | WebSocket | HMR (Hot Module Reload) | ✅ ALB 자동 지원 |

> **Note**: AWS ALB는 WebSocket을 자동으로 지원합니다. 별도 설정 불필요.

---

## 3. 컴포넌트 상세

### 3.1 ant-api (API Server)

**역할**: REST API + IDE 오케스트레이션 + SSR

```
Endpoints:
├── REST API
│   ├── POST /api/projects/:id/features/:feature/execute  # Job 실행
│   ├── GET  /api/jobs/:jobId/status                      # Job 상태
│   ├── POST /api/chat/message                            # 채팅
│   ├── GET  /api/files/:projectId/:feature               # 파일 목록
│   └── ...
│
├── IDE Proxy (/ide/*)
│   ├── GET  /ide/:serverKey/*          # IDE 정적 리소스
│   ├── WS   /ide/:serverKey/*          # IDE WebSocket (터미널)
│   └── IDE 요청 → K8s Pod IP:3000 프록시
│
├── IDE Management
│   ├── POST /api/cloud-ide/start       # IDE Pod 생성
│   ├── POST /api/cloud-ide/stop        # IDE Pod 삭제
│   └── GET  /api/cloud-ide/status      # IDE 상태
│
└── SSR Assets
    └── /*                              # Next.js SSR 정적 파일
```

**IDE 프록시 흐름:**
```
Client                  ALB                 ant-api              K8s Pod
  │                      │                     │                    │
  │  /ide/org:user:proj  │                     │                    │
  │─────────────────────►│                     │                    │
  │                      │  /* (default rule)  │                    │
  │                      │────────────────────►│                    │
  │                      │                     │  Redis lookup      │
  │                      │                     │  org:user:proj     │
  │                      │                     │  → Pod IP:3000     │
  │                      │                     │                    │
  │                      │                     │  proxy request     │
  │                      │                     │───────────────────►│
  │                      │                     │◄───────────────────│
  │◄─────────────────────│◄────────────────────│                    │
```

### 3.2 ant-preview (Preview Server)

**역할**: Preview 관련 모든 기능을 자체 완결 (Redis 기반 상태 관리)

```
ant-preview (포트 4102)
│
├── Preview API (모든 Preview 관리 기능)
│   ├── POST /preview/projects/:id/start   # Dev Server 시작
│   ├── POST /preview/projects/:id/stop    # Dev Server 중지
│   └── GET  /preview/projects/:id/status  # 상태 조회
│
├── PreviewService (Dev Server 생명주기)
│   ├── 프로젝트 구조 탐지 (Vite, Next.js, etc.)
│   ├── npm install 실행
│   ├── Dev Server 프로세스 실행 (port 30000+, 0.0.0.0 binding)
│   └── Redis에 PreviewState 등록 (host, port, running, ready 등)
│
└── Preview Proxy (GET /preview/:key/*)
    ├── Redis에서 PreviewState 조회 (host, port)
    ├── 해당 Pod IP:port로 프록시 (Cross-Pod 통신)
    ├── Referer 기반 정적 자원 라우팅
    └── HTML 경로 Rewrite
```

**Redis PreviewState 구조:**
```typescript
interface PreviewState {
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
  port: number;
  host: string;           // Pod IP (0.0.0.0에서 listen)
  running: boolean;
  ready: boolean;
  packages?: PreviewPackage[];
  startedAt?: number;
  lastAccessedAt?: number;
}
```

**Preview 흐름 (Multi-Pod):**
```
Client                  ALB              ant-preview Pod A      ant-preview Pod B
  │                      │                    │                       │
  │  POST /preview/projects/:id/start        │                       │
  │─────────────────────►│───────────────────►│                       │
  │                      │                    │  1. npm install        │
  │                      │                    │  2. npm run dev --host 0.0.0.0
  │                      │                    │     (port 30001)       │
  │                      │                    │  3. Redis: PreviewState
  │                      │                    │     { host: Pod_A_IP, port: 30001 }
  │◄─────────────────────│◄───────────────────│                       │
  │                      │                    │                       │
  │  GET /preview/:key/* │                    │                       │
  │─────────────────────►│  Round-robin       │                       │
  │                      │───────────────────►│                       │
  │                      │                    │  Redis lookup          │
  │                      │                    │  → Pod_A_IP:30001     │
  │                      │                    │  proxy to Pod A       │
  │◄─────────────────────│◄───────────────────│◄──────────────────────│
  │                      │                    │                       │
  │  GET /preview/:key/* │  Round-robin       │                       │
  │─────────────────────►│──────────────────────────────────────────►│
  │                      │                    │                       │  Redis lookup
  │                      │                    │                       │  → Pod_A_IP:30001
  │                      │                    │  ◄─── proxy to Pod A ─│
  │◄─────────────────────│◄───────────────────│◄──────────────────────│
```

**핵심 설계:**
- Dev Server가 `0.0.0.0`에서 listen → 다른 Pod에서도 접근 가능
- Redis에 Pod IP 저장 → 어떤 Pod가 요청 받아도 올바른 Dev Server로 프록시
- **Sticky Session 불필요** (Redis 기반 상태 관리)

### 3.3 ant-realtime (SSE Server)

**역할**: SSE 연결 관리 (Redis Pub/Sub 기반, Stateless)

```
Endpoints:
├── GET /realtime/projects/:id/features/:feature/stream  # Feature SSE
│   └── Chat, Kanban, FileTree, Git 변경 실시간 전송
│
└── GET /realtime/jobs/:jobId/workflow/stream            # Workflow SSE
    └── LangGraph 노드 상태, 진행률 실시간 전송
```

**Redis Pub/Sub 기반 동작:**
```
[SSE 연결 및 이벤트 전달]

                          ┌─────────────────────────────────────────┐
                          │               Redis Pub/Sub             │
                          │                                         │
Job Worker ───────────────│──► sse:broadcast ─────────────────────►│
                          │              │                          │
                          │    ┌─────────┼─────────┐                │
                          │    ▼         ▼         ▼                │
                          │  Pod A     Pod B     Pod C              │
                          │    │         │         │                │
                          │    ▼         ▼         ▼                │
                          │ Client 1  Client 2  Client 3            │
                          └─────────────────────────────────────────┘

[재연결 시나리오]
1. Client A가 Pod X에 SSE 연결
2. 네트워크 끊김 → 연결 종료
3. Client A 재연결 → Round-robin → Pod Y에 연결 (다른 Pod OK!)
4. URL 파라미터로 projectId/featureName 전달 (Stateless)
5. Pod Y가 Redis Subscribe → 이벤트 수신 가능 ✅
```

**핵심 설계:**
- 모든 Pod가 Redis Pub/Sub 구독
- SSE 연결 정보를 URL 파라미터로 전달 (Stateless)
- **Sticky Session 불필요** (재연결 시 어떤 Pod도 OK)

### 3.4 ant-job (Job Worker)

**역할**: BullMQ Job 처리 (LLM 호출, 코드 생성)

```
처리 흐름:
1. BullMQ에서 Job dequeue
2. LLM API 호출 (Claude, GPT)
3. 코드 생성 → EFS 저장
4. Redis Pub/Sub으로 상태 broadcast
5. Job 완료 상태 Redis 저장
```

### 3.5 IDE Pods (ant-ide namespace)

**역할**: 사용자별 격리된 VS Code 환경

```
Pod 구성:
├── Container: openvscode-server
│   ├── Port: 3000
│   ├── --server-base-path: /ide/{instanceKey}
│   └── Workspace: /workspace
│
├── Volume Mount:
│   ├── EFS PVC (ReadWriteMany)
│   └── subPath: {tenant}/{user}/{project}/codebase
│
└── Labels/Annotations:
    ├── ant.crosstoken.io/instance-key: org:user:project
    └── ant.crosstoken.io/workspace-path: /mnt/workspaces/...
```

---

## 4. 데이터 모델

### 4.1 Redis Key 구조

```
# Session (Chat)
ant:chat:session:{sessionKey}        # 세션 + 메시지 목록
ant:chat:currentMessage:{sessionKey} # 스트리밍 중인 메시지

# Job State
ant:job:status:{jobId}               # Job 상태
ant:job:logs:{jobId}                 # Job 로그 (List)
ant:job:mapping:{jobId}              # projectId, featureName 매핑
ant:job:userStopped:{jobId}          # 사용자 중지 마커

# Workflow State
ant:workflow:state:{jobId}           # 현재 노드, 히스토리 등

# Task Queue (Kanban)
ant:taskQueue:{jobId}                # 현재 태스크, 큐, 완료 목록

# Port Registry (State Objects)
ant:preview:{tenantId}:{userId}:{projectId}:{feature}  # PreviewState (JSON)
ant:ide:{tenantId}:{userId}:{projectId}                # IDEState (JSON)

# Key Format
# - IDE: {tenantId}:{userId}:{projectId} (3-part, project-level)
# - Preview: {tenantId}:{userId}:{projectId}:{feature} (4-part, feature-level)

# PreviewState Structure (stored as JSON)
# {
#   tenantId, userId, projectId, feature,
#   port: number,           # Dev Server port (30000+)
#   host: string,           # Pod IP (for cross-pod proxy)
#   running: boolean,       # Process running
#   ready: boolean,         # Server ready to serve
#   packages?: [],          # Detected packages
#   startedAt?: number,     # Start timestamp
#   lastAccessedAt?: number # Last access (for idle timeout)
# }

# IDEState Structure (stored as JSON)
# {
#   tenantId, userId, projectId,
#   port: number,           # IDE port (3000)
#   host: string,           # Pod IP
#   podId: string,          # K8s Pod name
#   startedAt?: number,
#   lastAccessedAt?: number
# }
```

### 4.2 Pub/Sub 채널

```
# Chat
chat:broadcast:{sessionKey}   # 채팅 메시지
chat:stream:{sessionKey}      # LLM 스트리밍 청크

# UI Updates
kanban:update:{sessionKey}    # 칸반 업데이트
filetree:update:{sessionKey}  # 파일트리 변경

# Job/Workflow
workflow:update:{jobId}       # 워크플로우 상태
job:status:{jobId}            # Job 상태 변경
job:stop                      # Job 중지 신호

# Broadcast
sse:broadcast                 # 범용 브로드캐스트
sse:workflow                  # 워크플로우 전용
```

---

## 5. 환경 설정

### 5.1 공통 (필수)

```bash
ANT_REDIS_URL=redis://localhost:6379       # Redis (필수)
ANT_WORKSPACE_BASE_PATH=/mnt/workspaces    # 워크스페이스 경로
ANT_ENCRYPTION_KEY=...                     # 암호화 키
```

### 5.2 API Server (ant-api)

```bash
ANT_SERVER_MODE=cloud                      # 인증 모드 (local | cloud)
ANT_CLI_PORT=4100                          # API 서버 포트
ANT_K8S_NAMESPACE=ant-ide                  # IDE Pod 네임스페이스
ANT_EFS_PVC_NAME=ant-workspaces-pvc        # EFS PVC 이름
```

### 5.3 Preview Server (ant-preview)

```bash
ANT_PREVIEW_PORT=4102                      # Preview 서버 포트
ANT_REDIS_URL=redis://...                  # Redis (상태 관리)
ANT_WORKSPACE_BASE_PATH=/mnt/workspaces    # 워크스페이스 경로

# ant-preview handles ALL preview operations:
# - POST /preview/projects/:id/start (Dev Server 시작)
# - POST /preview/projects/:id/stop (Dev Server 중지)
# - GET  /preview/projects/:id/status (상태 조회)
# - GET  /preview/:key/* (Dev Server 프록시)
```

### 5.4 Realtime Server (ant-realtime)

```bash
ANT_REALTIME_PORT=4101                     # Realtime 서버 포트
```

### 5.5 Job Worker (ant-job)

```bash
ANT_REDIS_URL=redis://...                  # BullMQ 연결
ANTHROPIC_API_KEY=...                      # Claude API
OPENAI_API_KEY=...                         # OpenAI API
```

### 5.6 환경별 차이

| 구분 | Local | Cloud |
|------|-------|-------|
| Auth | local:local (auto) | OAuth |
| State | Redis | Redis |
| Job Queue | BullMQ | BullMQ |
| Preview | 로컬 프로세스 | ant-preview Pod 내 프로세스 |
| IDE | Docker | Kubernetes |
| Storage | Local FS | EFS |

---

## 6. 인프라 요구사항

### 6.1 Kubernetes 리소스

| Component | Replicas | CPU | Memory | 비고 |
|-----------|----------|-----|--------|------|
| ant-api | 2+ | 2 | 2GB | HPA (CPU 70%) |
| ant-preview | 2+ | 4 | 4GB | Dev Server 실행 |
| ant-realtime | 2+ | 1 | 512MB | KEDA (connections) |
| ant-job | 2+ | 4 | 8GB | KEDA (queue depth) |
| IDE Pod | 동적 | 2 | 4GB | 사용자당 1개 |

### 6.2 공유 인프라

| Component | Spec | 비고 |
|-----------|------|------|
| Redis | 2 CPU, 4GB | ElastiCache (Multi-AZ) |
| EFS | 100GB+ | ReadWriteMany |
| ALB | - | WebSocket 자동 지원 |

### 6.3 Ingress 설정 (AWS ALB)

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
  - http:
      paths:
      # SSE - Round-robin (Redis Pub/Sub 기반)
      - path: /realtime
        pathType: Prefix
        backend:
          service:
            name: ant-realtime
            port:
              number: 4101
      # Preview - Round-robin (Redis 상태 관리 기반)
      - path: /preview
        pathType: Prefix
        backend:
          service:
            name: ant-preview
            port:
              number: 4100
      # Default (API, IDE, SSR) - Round-robin
      - path: /
        pathType: Prefix
        backend:
          service:
            name: ant-api
            port:
              number: 4100
---
# Sticky Session 불필요!
# 모든 서비스가 Redis 기반 상태 관리 사용:
# - ant-realtime: Redis Pub/Sub로 모든 Pod가 이벤트 수신
# - ant-preview: Redis에서 Dev Server Pod IP 조회 → 해당 Pod로 프록시
# - ant-api: Redis에서 IDE Pod IP 조회 → K8s Pod로 프록시
```

---

## 7. 데이터 흐름

### 7.1 Job 실행 흐름

```
┌────────┐    ┌─────────┐    ┌───────────┐    ┌───────────┐    ┌──────────┐
│Frontend│    │ ant-api │    │   Redis   │    │  ant-job  │    │   EFS    │
└───┬────┘    └────┬────┘    └─────┬─────┘    └─────┬─────┘    └────┬─────┘
    │              │               │                │               │
    │ POST /execute│               │                │               │
    │─────────────►│               │                │               │
    │              │ BullMQ enqueue│                │               │
    │              │──────────────►│                │               │
    │              │               │                │               │
    │              │               │  dequeue Job   │               │
    │              │               │◄───────────────│               │
    │              │               │                │               │
    │              │               │                │  LLM 호출      │
    │              │               │                │──────────────►│
    │              │               │                │               │
    │              │               │                │  코드 저장     │
    │              │               │                │──────────────►│
    │              │               │                │               │
    │              │               │  Pub/Sub       │               │
    │              │               │◄───────────────│               │
    │              │               │                │               │
    └──────────────│───────────────│────────────────┘               │
                   │               │                                 │
              ant-realtime         │                                 │
                   │               │                                 │
                   │  Subscribe    │                                 │
                   │◄──────────────│                                 │
                   │               │                                 │
    │  SSE push    │               │                                 │
    │◄─────────────│               │                                 │
```

### 7.2 IDE 접속 흐름

```
┌────────┐    ┌─────────┐    ┌───────────┐    ┌───────────┐    ┌──────────┐
│Frontend│    │ ant-api │    │   Redis   │    │  K8s API  │    │ IDE Pod  │
└───┬────┘    └────┬────┘    └─────┬─────┘    └─────┬─────┘    └────┬─────┘
    │              │               │                │               │
    │ POST /start  │               │                │               │
    │─────────────►│               │                │               │
    │              │               │  Pod 존재 확인  │               │
    │              │               │───────────────►│               │
    │              │               │                │               │
    │              │               │  Pod 없음      │               │
    │              │               │◄───────────────│               │
    │              │               │                │               │
    │              │               │  Pod 생성      │               │
    │              │───────────────│───────────────►│               │
    │              │               │                │  Pod Running  │
    │              │               │                │◄──────────────│
    │              │               │                │               │
    │              │  등록 IP:Port │                │               │
    │              │──────────────►│                │               │
    │              │               │                │               │
    │  URL 반환    │               │                │               │
    │◄─────────────│               │                │               │
    │              │               │                │               │
    │ /ide/key/*   │               │                │               │
    │─────────────►│               │                │               │
    │              │  lookup       │                │               │
    │              │──────────────►│                │               │
    │              │  IP:3000      │                │               │
    │              │◄──────────────│                │               │
    │              │               │                │               │
    │              │               │  proxy         │               │
    │              │───────────────│───────────────►│──────────────►│
    │◄─────────────│◄──────────────│◄───────────────│◄──────────────│
```

### 7.3 Preview 접속 흐름 (Multi-Pod)

```
┌────────┐    ┌────────────────┐    ┌───────────┐    ┌───────────────────┐
│Frontend│    │ ant-preview    │    │   Redis   │    │ Dev Server        │
│        │    │ (any Pod)      │    │           │    │ (Pod A, 0.0.0.0)  │
└───┬────┘    └──────┬─────────┘    └─────┬─────┘    └─────────┬─────────┘
    │                │                    │                    │
    │ POST /start    │                    │                    │
    │───────────────►│ (Pod A)            │                    │
    │                │  npm install       │                    │
    │                │  npm run dev --host│                    │
    │                │                    │  ┌────────────────►│ (0.0.0.0:30001)
    │                │                    │  │                 │
    │                │  등록 PreviewState │  │                 │
    │                │  { host: Pod_A_IP, │  │                 │
    │                │    port: 30001 }   │  │                 │
    │                │───────────────────►│  │                 │
    │                │                    │  │                 │
    │  URL 반환      │                    │  │                 │
    │◄───────────────│                    │  │                 │
    │                │                    │  │                 │
    │ /preview/key/* │                    │  │                 │
    │───────────────►│ (Pod B, Round-robin)  │                 │
    │                │  Redis lookup      │  │                 │
    │                │───────────────────►│  │                 │
    │                │  Pod_A_IP:30001    │  │                 │
    │                │◄───────────────────│  │                 │
    │                │                    │  │                 │
    │                │  Cross-Pod proxy ──│──┘                 │
    │                │  (Pod B → Pod A)   │                    │
    │                │────────────────────│───────────────────►│
    │◄───────────────│◄───────────────────│◄───────────────────│
```

**핵심**: 어떤 Pod가 요청을 받아도 Redis에서 실제 Dev Server Pod IP를 조회하여 프록시.

---

## 8. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Redis 장애 | 높음 | ElastiCache Multi-AZ, Failover |
| Worker 장애 | 중간 | BullMQ 자동 재시도 (3회) |
| Dev Server Pod 종료 | 중간 | lastAccessedAt 체크 + 재시작 가이드 |
| IDE Pod 시작 지연 | 중간 | Timeout 4분, Node 여유 확보 |
| EFS 성능 | 중간 | Provisioned Throughput |

---

## 9. 모니터링

### 9.1 주요 메트릭

| 컴포넌트 | 메트릭 | 임계치 |
|----------|--------|--------|
| ant-api | CPU, Memory | 70% |
| ant-preview | CPU, Memory | 70% |
| ant-realtime | SSE Connections | 1000/pod |
| ant-job | Queue Depth | 10 |
| Redis | Memory, Connections | 80% |

### 9.2 Health Check Endpoints

| 서비스 | Endpoint | 용도 |
|--------|----------|------|
| ant-api | `/api/health` | Liveness, Readiness |
| ant-preview | `/api/health` | Liveness, Readiness |
| ant-realtime | `/health` | Liveness, Readiness |

---

## 10. 배포 체크리스트

### 10.1 Ingress 설정

- [ ] `/realtime/*` → ant-realtime (Round-robin)
- [ ] `/preview/*` → ant-preview (Round-robin)
- [ ] `/*` → ant-api (Default, Round-robin)
- [ ] ALB WebSocket 지원 확인
- [ ] ~~Sticky Session~~ 불필요 (Redis 기반 상태 관리)

### 10.2 환경변수

- [ ] `ANT_REDIS_URL` 설정
- [ ] `ANT_WORKSPACE_BASE_PATH` 설정
- [ ] `ANT_K8S_NAMESPACE` 설정 (IDE용)
- [ ] `ANT_EFS_PVC_NAME` 설정

### 10.3 Kubernetes 리소스

- [ ] EFS PVC 생성 (ReadWriteMany)
- [ ] ant-ide namespace 생성
- [ ] RBAC 설정 (IDE Pod 생성 권한)
- [ ] Service Account 설정

### 10.4 스케일링

- [ ] HPA 설정 (ant-api, ant-preview)
- [ ] KEDA 설정 (ant-realtime, ant-job)
- [ ] Pod Disruption Budget 설정

---

## 11. Future Enhancements

### 11.1 Idle Timeout

현재 Preview/IDE는 명시적 종료까지 실행됩니다. 리소스 최적화를 위해 Idle Timeout 구현 예정:

```typescript
// lastAccessedAt 기반 idle 체크
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30분

async function checkIdleInstances() {
  const previews = await stateStore.listPreviews();
  const now = Date.now();
  
  for (const preview of previews) {
    if (preview.lastAccessedAt && now - preview.lastAccessedAt > IDLE_TIMEOUT_MS) {
      await previewService.stop(preview.tenantId, preview.userId, preview.projectId, preview.feature);
    }
  }
}
```

### 11.2 Preview 현재 구조 (이미 Scalable)

ant-preview는 **이미 Multi-Pod로 수평 확장** 가능한 구조:

```
[현재 - Multi-Pod Scalable]

ant-preview Pod A              ant-preview Pod B
├── PreviewService             ├── PreviewService
├── Dev Server (process 1)     ├── Dev Server (process 4)
├── Dev Server (process 2)     └── Dev Server (process 5)
└── Dev Server (process 3)
        │                              │
        └──────────┬───────────────────┘
                   ▼
              Redis (상태 공유)
              - host: Pod IP
              - port: 30001
              - lastAccessedAt
```

**확장성 보장:**
- HPA로 ant-preview Pod 수평 확장
- Redis 기반 상태 관리 (어떤 Pod가 요청받아도 올바른 Dev Server로 프록시)
- Dev Server는 0.0.0.0에서 listen (Cross-Pod 통신 가능)

**미래 옵션 (필요시):**
- 더 강력한 격리가 필요한 경우: Dev Server마다 별도 K8s Pod 생성 (IDE와 유사)
- 현재 프로세스 레벨 격리로 충분하면 불필요
