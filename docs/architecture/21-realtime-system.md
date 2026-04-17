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
Publisher (Job Worker child / HTTP Server / Realtime Server)
    -> Broadcaster 클래스
    -> Redis PUBLISH (user-scoped 채널)
    -> Realtime Server (subscribe)
    -> SSE (클라이언트별 전송)
    -> ant-ui (메시지 타입별 핸들러 라우팅)
```

Job Worker는 API Server를 거치지 않고 직접 Redis에 접근한다.

## Broadcaster

모든 Pub/Sub 발행은 브로드캐스터 클래스를 통해서만 일어난다. raw `stateStore.publish`나 raw `redis.publish`를 SSE 목적으로 직접 호출하는 코드는 없다.

| 클래스 | 파일 | 발행 타입 | 실행 컨텍스트 |
|--------|------|-----------|---------------|
| `KanbanBroadcaster` | `core/realtime/KanbanBroadcaster.ts` | `kanban` | Job Worker 자식 |
| `WorkflowBroadcaster` | `core/realtime/WorkflowBroadcaster.ts` | `workflow` | Job Worker 자식 |
| `FileTreeBroadcaster` | `core/realtime/FileTreeBroadcaster.ts` | `fileTree`, `unseenArtifacts` | Job Worker 자식 |
| `PreviewBroadcaster` | `core/realtime/PreviewBroadcaster.ts` | `preview` | Job Worker 자식 / Preview Server |
| `GitChangeBroadcaster` | `core/realtime/GitChangeBroadcaster.ts` | `gitChange` | Job Worker 자식 · HTTP Server · Realtime Server |
| `MessageBroadcaster` | `core/chat/MessageBroadcaster.ts` | `chat` | Job Worker 자식 |

`GitChangeBroadcaster`는 `publisher: (channel, payload) => Promise<unknown>` 콜백을 생성자에서 받는 transport-agnostic 설계이다. Job Worker는 자체 ioredis 연결을 생성하고, HTTP/Realtime Server는 기존 `stateStore.publish`를 재사용한다.

### gitChange 이중 발행 경로

- `FileTreeBroadcaster.notifyFileTreeUpdate`가 항상 `GitChangeBroadcaster.notifyGitChange`를 co-emit. Job 중 워킹트리 파일 생성·수정 커버.
- `GitWatcherService`가 `.git/index` mtime을 1초 간격으로 폴링하여 `notifyGitChange` 호출. 외부 터미널 Git 조작 커버.

두 경로 모두 동일한 `GitChangeBroadcaster` 인스턴스 또는 동등한 publisher를 사용해 단일 의미의 이벤트를 발행한다. 상세는 [24-git-operations.md](24-git-operations.md#realtime-gitchange-이벤트).

## Job Worker 환경변수 검증

브로드캐스터 초기화(`getBroadcasterOptionsFromEnv`)는 필수 env 7개 중 하나라도 누락되면 `logger.error`로 실패를 기록하고 `null`을 반환한다. 이 경우 Job은 실행되지만 실시간 업데이트는 전달되지 않으며, 누락된 키는 로그의 `missing` 배열에서 확인할 수 있다.

필수 env: `ANT_REDIS_URL`, `ANT_JOB_ID`, `ANT_PROJECT_ID`, `ANT_FEATURE_NAME`, `ANT_FEATURE_PATH`(또는 `ANT_PROJECT_PATH`), `ANT_USER_ID`, `ANT_ORG_ID`. Whitelist는 `JobWorker.spawnJobProcess`에서 관리한다.

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

### 재연결 시 스트리밍 메시지 유실 방지

SSE 연결이 끊겼다 복구되면, 스트리밍 중이던 assistant 메시지의 중간 콘텐츠가 유실될 수 있다. 재연결 시 서버가 Redis에 저장된 현재 세션 스냅샷을 전송하고, 프론트엔드는 기존 메시지 상태와 병합하여 끊김 없이 복원한다.

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
