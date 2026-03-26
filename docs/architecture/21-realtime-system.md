# Realtime System

## 개요

ANT의 실시간 통신은 Redis Pub/Sub와 Server-Sent Events(SSE)로 구성된다. Job Worker가 Redis에 publish하고, Realtime Server가 subscribe하여 SSE로 프론트엔드에 전달한다.

## SSE 연결 구조

두 개의 독립된 SSE 연결을 사용한다.

| 연결 | 엔드포인트 | 키 단위 | 데이터 |
|------|-----------|---------|--------|
| Unified SSE | `/realtime/projects/:id/features/:feature/stream` | project + feature | kanban, chat, fileTree, preview, gitChange |
| Workflow SSE | `/realtime/jobs/:jobId/workflow/stream` | jobId | 워크플로우 노드 상태 |

분리 이유: Unified SSE는 project/feature 단위로 항상 연결되지만, Workflow SSE는 실행 중인 Job이 있을 때만 해당 jobId로 연결된다.

## 이벤트 전파 흐름

```
Job Worker (자식 프로세스)
    -> KanbanBroadcaster / WorkflowBroadcaster / MessageBroadcaster
    -> Redis PUBLISH (user-scoped 채널)
    -> Realtime Server (subscribe)
    -> SSE (클라이언트별 전송)
    -> ant-ui (메시지 라우팅 -> 핸들러)
```

Job Worker는 API Server를 거치지 않고 직접 Redis에 접근한다.

## 초기 상태 전달

SSE 연결 직후 서버가 초기 상태를 전송한다.

### Unified SSE 초기 상태

| 데이터 | 조회 소스 |
|--------|----------|
| Kanban | 세션 파일 + Redis (live TaskQueueSnapshot) |
| Chat | 세션 파일 / Redis |
| FileTree | 파일시스템 |

Kanban 초기 상태의 `dataSource` 우선순위:
1. Redis에 live TaskQueueSnapshot -> `live`
2. Job running이지만 snapshot 없음 -> `estimating`
3. 그 외 -> `session` (세션 파일 기반)

### Workflow SSE 초기 상태

Redis `ant:job:workflow:{jobId}`에서 `WorkflowRealtimeState` 조회. Job Worker의 WorkflowBroadcaster가 노드 진입/퇴장 시마다 이 키를 갱신한다 (TTL 24h).

## 연결 Lifecycle

### Unified SSE

1. `projectSlice.setSelectedFeature()` -> `sseSlice.initializeSSE()` -> `sseManager.connect()`
2. 핸들러 등록: kanban -> `updateKanban()`, chat -> `addChatMessage()`, fileTree -> `setFileTree()`
3. 서버가 초기 상태 3건 전송

### Workflow SSE

1. `jobSlice.setRunning(true, jobId)` -> `sseManager.connectWorkflow(jobId)`
2. 또는 `useWorkflowSSE(jobId)` 훅에서 연결 보장
3. `connectWorkflow`는 idempotent (이미 연결되어 있으면 skip)

## 재연결 정책

| 단계 | 동작 |
|------|------|
| onerror 1~5회 | EventSource 브라우저 자동 재연결 (상태 변경 없음) |
| onerror 5회 초과 | disconnect -> exponential backoff 재연결 |
| 재연결 성공 | connectionStatus = connected |

Backoff 공식: `min(30s, 1s * 2^(attempt - 5))`

Multi-Pod 환경에서 재연결 시 다른 Pod에 연결되어도 동일한 user-scoped 채널을 구독하므로 이벤트 수신에 문제가 없다.

## 페이지 새로고침 복원

1. Store 초기화 (currentJobId = undefined)
2. 세션 복원 -> initializeSSE() -> Unified SSE 연결
3. Unified SSE 초기 상태에서 Kanban의 jobId 수신 -> isRunning, currentJobId 설정
4. useWorkflowSSE 반응 -> Workflow SSE 연결
5. useJobRestoration (이중 안전장치) -> fetchQueuePosition -> setRunning

칸반 초기 상태가 실행 중인 Job의 jobId를 포함해야 전체 복원 체인이 동작한다.

## 경계

- Redis Pub/Sub 채널 규약: [02-infrastructure.md](02-infrastructure.md)
- 채팅 메시지 처리: [31-chat-system.md](31-chat-system.md)
- 프론트엔드 SSE 통합: [30-frontend-architecture.md](30-frontend-architecture.md)
- Bridge WebSocket (Ant Desktop 연결·감지·인증): [26-figma-integration-infra.md](26-figma-integration-infra.md)
