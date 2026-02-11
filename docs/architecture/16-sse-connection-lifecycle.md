# SSE 연결 Lifecycle

> 클라이언트(ant-ui)와 서버(ant-realtime) 양쪽의 SSE 연결 관리 전체 흐름

---

## 1. 개요

ANT는 두 개의 **독립된 SSE 연결**을 사용한다:

| 연결 | 엔드포인트 | 키 단위 | 데이터 타입 |
|------|-----------|---------|------------|
| **Unified SSE** | `/realtime/projects/:id/features/:feature/stream` | project + feature | kanban, chat, fileTree, preview, gitChange |
| **Workflow SSE** | `/realtime/jobs/:jobId/workflow/stream` | jobId | workflow 노드 상태 |

**분리 이유**: Unified SSE는 project/feature 단위로 항상 연결되지만, Workflow SSE는 실행 중인 job이 있을 때만 해당 jobId로 연결된다. Job이 없으면 Workflow SSE는 존재하지 않는다.

---

## 2. 아키텍처

```
┌──────────────────────────────────────────────────────────────────────┐
│  ant-ui (브라우저)                                                    │
│                                                                      │
│  SSEManager (Singleton)                                              │
│  ├── Unified EventSource  ──► /realtime/.../stream                   │
│  │   └── onmessage → routeMessage → handlers (kanban, chat, ...)    │
│  └── Workflow EventSource ──► /realtime/jobs/:jobId/workflow/stream  │
│      └── onmessage → routeMessage → handlers (workflow)             │
│                                                                      │
│  Store (Zustand)                                                     │
│  ├── sseSlice: initializeSSE(), updateKanban(), connectionStatus    │
│  ├── jobSlice: setRunning() → connectWorkflow()                     │
│  └── useWorkflowSSE(): 핸들러 등록 + connectWorkflow 보장            │
└──────────────────────────────────────────────────────────────────────┘
          │ HTTP(S)                              │ HTTP(S)
          ▼                                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ant-realtime (SSE 전용 서버)                                        │
│                                                                      │
│  SSEService                                                          │
│  ├── registerClient()          → Redis subscribe (user-scoped)      │
│  ├── registerWorkflowClient()  → Redis subscribe (user-scoped)      │
│  ├── sendInitialState()        → 연결 직후 초기 상태 전송             │
│  └── broadcastLocal()          → Redis 메시지 → SSE 클라이언트       │
│                                                                      │
│  초기 상태 조회                                                       │
│  ├── KanbanService.getKanbanData()    → 세션 파일 + Redis            │
│  ├── ChatService.getMessagesAsync()   → 세션 파일 / Redis            │
│  └── WorkflowStateService.getInitialState() → Redis                 │
└──────────────────────────────────────────────────────────────────────┘
          │ Redis Pub/Sub                        │ Redis GET/SET
          ▼                                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Redis                                                               │
│                                                                      │
│  Pub/Sub 채널 (사용자 스코프):                                        │
│  ├── realtime:broadcast:{orgId}:{userId}  ← KanbanBroadcaster 등    │
│  └── realtime:workflow:{orgId}:{userId}   ← WorkflowBroadcaster     │
│                                                                      │
│  키-값 저장:                                                          │
│  ├── ant:job:status:{jobId}              → JobStatusData             │
│  ├── ant:job:workflow:{jobId}            → WorkflowRealtimeState     │
│  ├── ant:job:task-queue:{jobId}          → TaskQueueSnapshot         │
│  └── ant:index:jobs-by-feature:{p}:{f}  → Set<jobId>               │
└──────────────────────────────────────────────────────────────────────┘
          ▲ Redis PUBLISH + SET
          │
┌──────────────────────────────────────────────────────────────────────┐
│  ant-job (Job Worker)                                                │
│                                                                      │
│  KanbanBroadcaster   → Redis PUBLISH (broadcast 채널) + SET          │
│  WorkflowBroadcaster → Redis PUBLISH (workflow 채널) + SET           │
│  MessageBroadcaster  → Redis PUBLISH (broadcast 채널)                │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. 연결 Lifecycle

### 3.1 Unified SSE

**연결 시점**: `projectSlice.setSelectedFeature()` → `sseSlice.initializeSSE()` → `sseManager.connect(projectId, featureName, jobType)`

**핸들러 등록** (`initializeSSE` 내부):
- `kanban` → `updateKanban(data)` (Store 상태 업데이트)
- `chat` → `addChatMessage()` / `updateChatMessage()` 등
- `fileTree` → `setFileTree(tree)`

**초기 상태 전달** (서버 측, `sse.routes.ts`):

연결 즉시 서버가 3개의 초기 상태를 전송한다:
1. Kanban: `kanbanService.getKanbanData()`
2. Chat: `chatService.getMessagesAsync()`
3. FileTree: `projectService.getFileTree()`

**연결 상태 관리**:
- `onopen` → `connectionStatus = 'connected'`
- `onerror` (5회 이하) → EventSource 브라우저 자동 재연결 (상태 변경 없음)
- `onerror` (5회 초과) → `connectionStatus = 'error'`, 수동 exponential backoff 재연결

### 3.2 Workflow SSE

**연결 시점** (아래 경로 중 하나):
1. `jobSlice.setRunning(true, jobId)` → `sseManager.connectWorkflow(jobId)`
2. `useWorkflowSSE(jobId)` 훅 → `sseManager.connectWorkflow(jobId)` (연결 보장)
3. `sseSlice.initializeSSE()` → `state.currentJobId`가 있으면 `connectWorkflow()`

`connectWorkflow`는 **idempotent** (`workflowConnections.has(jobId)` 체크). 여러 경로에서 호출되어도 안전하다.

**핸들러 등록** (`useWorkflowSSE` 훅):
- `workflow` 메시지 → 노드 상태 큐잉, 최소 표시 시간 보장
- `end` named event → 워크플로우 완료 처리

**초기 상태 전달** (서버 측):
- `workflowStateService.getInitialState(jobId)` → Redis `ant:job:workflow:{jobId}` 조회
- 클라이언트 HTTP fallback: `fetchWorkflowState(jobId)` (핸들러 등록 전에 초기 상태가 드롭된 경우 대비)

---

## 4. 초기 상태 조회 흐름 (서버 측)

### 4.1 Kanban 초기 상태

`KanbanService.getKanbanData()`의 데이터 소스 우선순위:

```
1. 세션 파일에서 jobId 읽기
   └── 없으면 → Redis listJobsByFeature() fallback (실행 중인 job 탐색)
2. Redis에서 job 상태 확인 (status === 'running'?)
3. Redis에서 live TaskQueueSnapshot 조회
4. 결과 결정:
   ├── live snapshot 있음  → dataSource: 'live'
   ├── running이지만 snapshot 없음 → dataSource: 'estimating'
   └── 그 외 → dataSource: 'session' (세션 파일 기반)
```

**Redis fallback이 필요한 이유**: Planner 등 일부 에이전트는 세션 파일에 `state.jobId`를 기록하지 않는다. 이 경우 `listJobsByFeature()`로 Redis에서 실행 중인 job을 탐색하여 초기 상태를 live로 제공한다.

### 4.2 Workflow 초기 상태

`WorkflowStateService.getInitialState(jobId)`:
- Redis `ant:job:workflow:{jobId}` 에서 `WorkflowRealtimeState` 조회
- Job Worker의 `WorkflowBroadcaster`가 노드 진입/퇴장 시마다 이 키를 갱신 (TTL 24h)
- 키가 없으면 null 반환 (아직 노드 진입 전이거나 job이 완료된 경우)

---

## 5. 페이지 새로고침 시 복원 흐름

```
시간 →

1. 페이지 로드
   Store 초기화: currentJobId=undefined, isRunning=false

2. 세션 복원
   useSessionLoader → setSelectedProject/Feature
   → initializeSSE() → sseManager.connect() [Unified SSE]
   → currentJobId=undefined이므로 Workflow SSE 미연결

3. Unified SSE 초기 상태 수신
   서버 → kanban 초기 상태 (dataSource: 'live', jobId: X)
   → updateKanban(): isRunning=true, currentJobId=X 설정

4. Workflow SSE 연결
   useWorkflowSSE(X) 반응 → sseManager.connectWorkflow(X)
   서버 → workflow 초기 상태 (Redis에서 조회)
   + HTTP fallback으로 현재 상태 조회

5. 이중 안전장치
   useJobRestoration → fetchQueuePosition(X) → setRunning(true, X)
   → connectWorkflow(X) (idempotent, 이미 연결되어 있으면 스킵)
```

**핵심**: 칸반 초기 상태가 실행 중인 job의 `jobId`를 포함해야 전체 복원 체인이 동작한다.

---

## 6. 재연결 정책

### Unified SSE

| 단계 | 동작 | connectionStatus |
|------|------|-----------------|
| onerror 1~5회 | EventSource 브라우저 자동 재연결 | 변경 없음 (flickering 방지) |
| onerror 5회 초과 | disconnect() → exponential backoff 재연결 | `'error'` |
| 재연결 성공 | onopen | `'connected'` |
| 명시적 disconnect | eventSource.close() | `'disconnected'` |

Backoff: `min(30s, 1s * 2^(attempt - 5))`

### Workflow SSE

동일한 5회 자동 + exponential backoff 패턴. `connectionStatus`에 반영하지 않음 (Unified와 독립).

### 수동 재연결

`sseSlice.reconnectSSE(key)`:
- `key = 'kanban' | 'chat' | 'fileTree'` → Unified SSE disconnect + initializeSSE()
- `key = 'workflow'` → Workflow SSE disconnect + connectWorkflow()

---

## 7. 브라우저 로그 가이드

모든 SSE 이벤트는 `[SSE]` prefix로 로깅된다:

```
[SSE] unified: connecting ant-prediction/localtest    ← 연결 시작
[SSE] unified: open                                   ← 연결 성공
[SSE] unified: error (attempt 1/5)                    ← 일시적 에러
[SSE] unified: closed                                 ← 명시적 종료

[SSE] workflow(abc-123): connecting                   ← 워크플로우 연결 시작
[SSE] workflow(abc-123): open                         ← 워크플로우 연결 성공
[SSE] workflow(abc-123): error (attempt 1/5)          ← 일시적 에러
[SSE] workflow(abc-123): closed                       ← 명시적 종료
```

**디버깅 시 확인할 것**:
- `unified: open` 후 `workflow(...)` 로그가 없으면 → `currentJobId`가 설정되지 않은 것
- `unified: error`가 반복되면 → 서버 또는 네트워크 문제
- `workflow(...)` 로그가 아예 없으면 → 칸반 초기 상태에 jobId가 없는 것

---

## 8. 관련 코드 참조

### 클라이언트 (ant-ui)

| 파일 | 역할 |
|------|------|
| `infrastructure/sse/SSEManager.ts` | EventSource 생성/관리, 재연결, 메시지 라우팅 |
| `domain/store/slices/sseSlice.ts` | initializeSSE(), updateKanban(), 핸들러 등록 |
| `domain/store/slices/jobSlice.ts` | setRunning() → connectWorkflow() |
| `presentation/components/workflow/hooks/useWorkflowState.ts` | workflow 핸들러 + connectWorkflow 보장 |
| `application/hooks/features/useWorkflow.ts` | displayedState 제공 (큐 기반 표시) |
| `application/hooks/ui/useJobRestoration.ts` | localStorage 기반 job 복원 (이중 안전장치) |

### 서버 (ant-cli)

| 파일 | 역할 |
|------|------|
| `periphery/adapters/http/routes/sse.routes.ts` | SSE 엔드포인트, 초기 상태 전송 |
| `periphery/adapters/http/services/SSEService.ts` | 클라이언트 관리, Redis Pub/Sub 구독, 브로드캐스트 |
| `periphery/adapters/http/services/KanbanService.ts` | 칸반 초기 상태 조회 (세션 + Redis fallback) |
| `periphery/adapters/http/services/WorkflowStateService.ts` | 워크플로우 초기 상태 조회 (Redis) |
| `core/realtime/WorkflowBroadcaster.ts` | 워크플로우 상태 Redis 저장 + Pub/Sub 브로드캐스트 |
| `infrastructure/state/RedisStateStore.ts` | Redis 키-값 저장, listJobsByFeature() |
