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
│   │   [ant.crosstoken.io]                                                │   │
│   │   /realtime/*  ──────────────────────────►  ant-realtime            │   │
│   │   /api/*       ──────────────────────────►  ant-api                 │   │
│   │   /ide/*       ──────────────────────────►  ant-api                 │   │
│   │   /*           ──────────────────────────►  ant-api (Default)       │   │
│   │                                                                      │   │
│   │   [ant-preview.crosstoken.io]  ← 별도 호스트                         │   │
│   │   /*           ──────────────────────────►  ant-preview             │   │
│   │                                                                      │   │
│   │   ※ ALB는 호스트 기반 + URI 기반 라우팅, WebSocket 자동 지원          │   │
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

**ant.crosstoken.io (메인 호스트):**

| Priority | Path | Target | LB Policy | 비고 |
|----------|------|--------|-----------|------|
| 1 | `/realtime/*` | ant-realtime | Round-robin | Redis Pub/Sub 기반 |
| 2 | `/api/*` | ant-api | Round-robin | REST API |
| 3 | `/ide/*` | ant-api | Round-robin | IDE Proxy |
| 4 | `/*` | ant-api | Round-robin | Default (SSR) |

**ant-preview.crosstoken.io (Preview 전용 호스트):**

| Priority | Path | Target | LB Policy | 비고 |
|----------|------|--------|-----------|------|
| 1 | `/*` | ant-preview | Round-robin | Preview 전용 (호스트 기반 라우팅) |

> **Why 별도 호스트?**
> SSR 앱의 절대 경로 리소스 (`/_next/*`, `/logos/*`)가 ALB URI 라우팅을 우회하여 ant-api로 가는 문제를 해결.
> 별도 호스트를 쓰면 모든 요청이 ant-preview로 라우팅됨. 상세: `02-preview-server.md` 섹션 3.
>
> **Why No Sticky Session?**
> - **SSE (ant-realtime)**: Redis Pub/Sub로 모든 Pod가 이벤트 수신. 재연결 시 다른 Pod도 OK.
> - **Preview (ant-preview)**: Redis에서 Dev Server Pod IP 조회 → 해당 Pod로 프록시. 0.0.0.0 binding.
> - **IDE (ant-api)**: Redis에서 IDE Pod IP 조회 → K8s Pod로 프록시.

**라우팅 동작:**
- `ant.crosstoken.io/realtime/stream` → ant-realtime (SSE)
- `ant.crosstoken.io/api/jobs/...` → ant-api (REST)
- `ant.crosstoken.io/ide/org:user:proj/` → ant-api (IDE Proxy)
- `ant-preview.crosstoken.io/org:user:proj:feat/*` → ant-preview (Preview)
- `ant-preview.crosstoken.io/_next/...` → ant-preview (SSR 리소스, Referer 기반)

### 2.3 WebSocket 지원

| 경로 | 프로토콜 | 용도 | 지원 |
|------|----------|------|------|
| `ant.crosstoken.io/ide/:key/*` | WebSocket | IDE 터미널, 파일 변경 | ✅ ALB 자동 지원 |
| `ant-preview.crosstoken.io/:key/*` | WebSocket | HMR (Hot Module Reload) | ✅ ALB 자동 지원 |

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
    └── HTML/JS/CSS 경로 Rewrite (절대경로 → /preview/:key/ prefix)
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
[SSE 연결 및 이벤트 전달 - 사용자 스코프 채널]

                          ┌─────────────────────────────────────────┐
                          │               Redis Pub/Sub             │
                          │                                         │
Job Worker ───────────────│──► realtime:broadcast:{orgId}:{userId} ►│
  (KanbanBroadcaster)     │──► realtime:workflow:{orgId}:{userId}  ►│
  (WorkflowBroadcaster)   │                                         │
  (MessageBroadcaster)    │    ┌─────────┼─────────┐                │
                          │    ▼         ▼         ▼                │
                          │  Pod A     Pod B     Pod C              │
                          │    │         │         │                │
                          │    ▼         ▼         ▼                │
                          │ User A     (무시)    User A             │
                          │ 연결 있음            연결 있음          │
                          └─────────────────────────────────────────┘

[재연결 시나리오]
1. Client A가 Pod X에 SSE 연결 (userContext 포함)
2. Pod X가 realtime:broadcast:{orgId}:{userId} 채널 구독
3. 네트워크 끊김 → 연결 종료 → 구독 해제
4. Client A 재연결 → Round-robin → Pod Y에 연결 (다른 Pod OK!)
5. Pod Y가 같은 user-scoped 채널 구독 → 이벤트 수신 가능 ✅
```

**핵심 설계:**
- 사용자별 스코프 채널 (`realtime:broadcast:{orgId}:{userId}`)
- SSE 연결 시 `userContext`로 구독 채널 결정 (Multi-Tenant 격리)
- **Sticky Session 불필요** (재연결 시 어떤 Pod도 OK)

### 3.4 ant-job (Job Worker)

**역할**: BullMQ Job 처리 (LLM 호출, 코드 생성, 실시간 브로드캐스트)

```
처리 흐름:
1. BullMQ에서 Job dequeue
2. 자식 프로세스(job-runner) 스폰 (런타임 환경변수로 컨텍스트 전달)
3. LLM API 호출 (Claude, GPT) - 스트리밍 응답 수신
4. LLMResponseService가 직접 Redis 처리:
   - SessionStore → Redis SET (세션 저장)
   - ContentMerger → thinking 이벤트 병합
   - MessageBroadcaster → Redis PUBLISH (user-scoped channel)
5. KanbanBroadcaster / WorkflowBroadcaster → Redis PUBLISH (실시간 UI)
6. 코드 생성 → EFS 저장
7. Job 완료 → Redis PUBLISH (job:status:updates → API Server)
```

**Chat 데이터 흐름 (상세):**
```
┌─────────────┐     Redis (직접 접근)        ┌─────────────┐
│  ant-job    │──── SET (세션 저장) ────────►│   Redis     │
│  (child     │──── PUBLISH (broadcast) ───►│             │
│   process)  │──── PUBLISH (workflow) ────►│  • Keys     │
└──────▲──────┘──── PUBLISH (kanban) ──────►│  • Pub/Sub  │
       │ LLM Stream                         └──────┬──────┘
       │                                           │
┌──────┴──────┐                               subscribe
│  LLM API    │                                    │
│ (Claude 등) │                           ┌────────▼────────┐
└─────────────┘                           │  ant-realtime   │
                                          │  (SSE Gateway)  │
                                          └────────┬────────┘
                                                   │ SSE
[API Server]                              ┌────────▼────────┐
  └── ChatService (경량화)                │     ant-ui      │
      ├── 메시지 조회/삭제 (GET/DELETE)   │    (브라우저)    │
      ├── 유저 메시지 추가 (POST)         └─────────────────┘
      └── triage 처리
```

> **Note**: Job Worker는 ant-api를 거치지 않고 직접 Redis에 접근합니다.
> LLMResponseService가 ContentMerger, 파일 카드 상태 관리 등을 자체 처리합니다.
> 
> @see REFACTORING-CHAT-SERVICE.md
> @see src/core/types/processEnv.ts (런타임 환경변수 중앙 정의)

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

> **중앙 정의**: `src/infrastructure/state/redisConstants.ts` (REDIS_KEYS)
> 모든 키는 `ant:` prefix를 공유하며, 도메인별로 계층화.

```
# Job (ant:job:*)
ant:job:status:{jobId}               # Job 상태 (running/completed/failed)
ant:job:logs:{jobId}                 # Job 실행 로그 (List)
ant:job:taskQueue:{jobId}            # Kanban 태스크 큐 스냅샷
ant:job:mapping:{jobId}              # projectId, featureName 매핑
ant:job:userStopped:{jobId}          # 사용자 중지 플래그
ant:job:workflow:{jobId}             # 워크플로우 노드 상태

# Chat (ant:chat:*)
ant:chat:session:{sessionKey}        # 세션 + 메시지 목록
ant:chat:currentMessage:{sessionKey} # 스트리밍 중인 메시지

# Choice (ant:choice:*)
ant:choice:pending:{choiceKey}       # Triage 선택 대기

# Infrastructure (ant:infra:*)
ant:infra:preview:{portKey}          # PreviewState (JSON)
ant:infra:preview:list               # Preview 목록 (SET)
ant:infra:preview:byPod:{podId}      # Pod별 Preview 인덱스 (SET)
ant:infra:ide:{portKey}              # IDEState (JSON)
ant:infra:ide:list                   # IDE 목록 (SET)
ant:infra:ide:instance:{instanceKey} # IDE 인스턴스 (K8s)
ant:infra:ide:lastAccess:{instanceKey} # IDE 마지막 접근 시간

# Index (ant:index:*)
ant:index:jobsByFeature:{projectId}:{featureName}  # Feature별 Job 인덱스 (SET)

# Key Format
# - IDE portKey:     {tenantId}:{userId}:{projectId} (3-part, project-level)
# - Preview portKey: {tenantId}:{userId}:{projectId}:{feature} (4-part, feature-level)
# - sessionKey:      {orgId}:{userId}:{projectId}/{featureName}
```

### 4.2 Pub/Sub 채널

> **중앙 정의**: `src/infrastructure/state/redisConstants.ts` (REDIS_CHANNELS)
> 채널은 **구독자(subscriber)**로 그룹화. 사용자 스코프 채널로 멀티테넌트 격리.

```
# Realtime Server 구독 → SSE로 프론트엔드 전달
realtime:broadcast:{orgId}:{userId}  # Chat, Kanban, FileTree 등 범용
realtime:workflow:{orgId}:{userId}   # 워크플로우 전용

# Job Worker 구독 → 프로세스 제어
job:stop                             # Job 중지 신호 (API Server → Job Worker)

# API Server 구독 → 내부 상태 동기화
job:status:updates                   # Job 완료/실패 알림 (Job Worker → API Server)
```

**채널 생성 함수** (redisConstants.ts):
```typescript
getRealtimeBroadcastChannel(orgId, userId)  // → "realtime:broadcast:{orgId}:{userId}"
getRealtimeWorkflowChannel(orgId, userId)   // → "realtime:workflow:{orgId}:{userId}"
parseChannelUserContext(channel)             // → { orgId, userId } | null
```

> **Multi-Tenant 격리**: 모든 실시간 채널은 `{orgId}:{userId}` 스코프.
> 다른 사용자의 이벤트가 누출되지 않음.

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
ANT_K8S_NAMESPACE=ant-ide                  # IDE Pod 네임스페이스
ANT_EFS_PVC_NAME=ant-workspaces-pvc        # EFS PVC 이름
# PORT 환경변수 불필요 - 기본값 8080, K8s Service가 라우팅
```

### 5.3 Preview Server (ant-preview)

```bash
ANT_REDIS_URL=redis://...                  # Redis (상태 관리)
ANT_WORKSPACE_BASE_PATH=/mnt/workspaces    # 워크스페이스 경로
# PORT 환경변수 불필요 - 기본값 8080, K8s Service가 라우팅

# ant-preview handles ALL preview operations:
# - POST /preview/projects/:id/start (Dev Server 시작)
# - POST /preview/projects/:id/stop (Dev Server 중지)
# - GET  /preview/projects/:id/status (상태 조회)
# - GET  /preview/:key/* (Dev Server 프록시)
```

> **⚠️ EFS File Watching**: EFS는 NFS 기반이므로 `inotify`(fs.watch)가 작동하지 않습니다.
> Dev Server(Vite, Next.js)의 파일 감시가 실패하여 프로세스가 크래시됩니다.
> ProcessSpawner가 자동으로 `CHOKIDAR_USEPOLLING=true`, `WATCHPACK_POLLING=true`를
> Dev Server 프로세스에 주입하여 해결합니다. 상세: `02-preview-server.md` 섹션 8.

### 5.4 Realtime Server (ant-realtime)

```bash
# PORT 환경변수 불필요 - 기본값 8080, K8s Service가 라우팅
```

### 5.5 Job Worker (ant-job)

```bash
ANT_REDIS_URL=redis://...                  # BullMQ 연결
ANT_API_URL=http://ant-api:8080            # API Server 내부 URL
ANT_WORKSPACE_BASE_PATH=/mnt/workspaces    # 워크스페이스 경로
ANTHROPIC_API_KEY=...                      # Claude API
OPENAI_API_KEY=...                         # OpenAI API
```

### 5.6 런타임 환경변수 (자식 프로세스)

> **중앙 정의**: `src/core/types/processEnv.ts` (CHILD_PROCESS_ENV)

Job Worker/API Server가 자식 프로세스(job-runner)를 스폰할 때 주입하는 환경변수.
DevOps가 관리하지 않으며, 인증된 사용자 세션에서 런타임으로 결정됨.

| 변수 | 필수 | 설명 | 예시 |
|------|------|------|------|
| `ANT_JOB_ID` | ✅ | Job 식별자 | `job_abc123` |
| `ANT_PROJECT_ID` | ✅ | 프로젝트 ID | `my-project` |
| `ANT_FEATURE` | ✅ | Feature 이름 | `login-page` |
| `ANT_JOB_TYPE` | ✅ | Job 타입 | `code`, `design`, `learn` |
| `ANT_AGENT` | ✅ | 에이전트 타입 | `architect`, `reviewer` |
| `ANT_USER_ID` | ✅ | 사용자 ID (인증 세션) | `user123` |
| `ANT_ORG_ID` | ✅ | 조직 ID (인증 세션) | `org456` |
| `ANT_PROJECT_PATH` | ✅ | 프로젝트 전체 경로 | `/mnt/workspaces/org/user/proj` |
| `ANT_FEATURE_PATH` | ✅ | Feature 전체 경로 | `.../proj/features/login-page` |
| `ANT_REDIS_URL` | ✅ | Redis URL | `rediss://...` |
| `ANT_API_URL` | ✅ | API Server URL | `http://ant-api:8080` |
| `ANT_USER_EMAIL` | ○ | 이메일 (userId@orgId) | `user123@org456` |
| `ANT_MODE` | ○ | 실행 모드 | `generate` (기본값) |
| `ANT_OVERRIDE_DIRECTIVE` | ○ | 오버라이드 지시 | - |

> **주의**: `ANT_USER_ID`와 `ANT_ORG_ID`는 `.env` 파일에 설정하지 않습니다.
> 사용자별로 다른 값이므로 반드시 인증 세션에서 동적으로 결정되어야 합니다.

### 5.7 환경별 차이

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

### 6.3 Ingress 설정

라우팅 규칙은 섹션 2.2 참조. Preview는 별도 호스트(`ant-preview.crosstoken.io`)를 사용하여 SSR 리소스 라우팅 문제를 해결합니다. 상세: `02-preview-server.md` 섹션 3.

Sticky Session 불필요 — 모든 서비스가 Redis 기반 상태 관리를 사용합니다.

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

**ant.crosstoken.io:**
- [ ] `/realtime/*` → ant-realtime (Round-robin)
- [ ] `/api/*` → ant-api (Round-robin)
- [ ] `/ide/*` → ant-api (Round-robin)
- [ ] `/*` → ant-api (Default, Round-robin)

**ant-preview.crosstoken.io (별도 호스트):**
- [ ] DNS 레코드: `ant-preview.crosstoken.io` → ALB
- [ ] SSL 인증서: `*.crosstoken.io` 와일드카드 또는 별도 인증서
- [ ] `/*` → ant-preview (Round-robin)
- [ ] CORS 설정: ant-preview ↔ ant-api 간 cross-origin 허용

**공통:**
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
