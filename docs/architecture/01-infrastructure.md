# Infrastructure

## 개요

ANT의 모든 프로세스 간 통신과 상태 관리는 Redis를 통해 이루어진다. BullMQ는 Job 큐, Redis Pub/Sub는 실시간 이벤트 전파, Redis Key-Value는 상태 저장에 사용된다.

## Redis Key 구조

중앙 정의: `src/infrastructure/state/redisConstants.ts` (REDIS_KEYS)

모든 키는 `ant:` prefix를 공유하며, 도메인별로 계층화된다.

### Job 도메인 (`ant:job:*`)

| 키 | 타입 | 용도 |
|----|------|------|
| `ant:job:status:{jobId}` | String (JSON) | Job 상태 (running/completed/failed) |
| `ant:job:logs:{jobId}` | List | Job 실행 로그 |
| `ant:job:taskQueue:{jobId}` | String (JSON) | Kanban 태스크 큐 스냅샷 |
| `ant:job:mapping:{jobId}` | String (JSON) | projectId, featureName 매핑 |
| `ant:job:userStopped:{jobId}` | String | 사용자 중지 플래그 |
| `ant:job:workflow:{jobId}` | String (JSON) | 워크플로우 노드 상태 |

### Chat 도메인 (`ant:chat:*`)

| 키 | 타입 | 용도 |
|----|------|------|
| `ant:chat:session:{sessionKey}` | String (JSON) | 세션 + 메시지 목록 |
| `ant:chat:currentMessage:{sessionKey}` | String (JSON) | 스트리밍 중인 메시지 |

### Choice 도메인 (`ant:choice:*`)

| 키 | 타입 | 용도 |
|----|------|------|
| `ant:choice:pending:{choiceKey}` | String (JSON) | Triage 선택 대기 |

### Infrastructure 도메인 (`ant:infra:*`)

| 키 | 타입 | 용도 |
|----|------|------|
| `ant:infra:preview:{portKey}` | String (JSON) | PreviewState (런타임 — stop 시 삭제) |
| `ant:infra:preview:config:{portKey}` | String (JSON) | Preview 설정 (영속 — connections, structureType, projectProfile) |
| `ant:infra:preview:list` | Set | Preview 목록 |
| `ant:infra:preview:byPod:{podId}` | Set | Pod별 Preview 인덱스 |
| `ant:infra:ide:{portKey}` | String (JSON) | IDEState |
| `ant:infra:ide:list` | Set | IDE 목록 |
| `ant:infra:ide:instance:{instanceKey}` | String (JSON) | IDE 인스턴스 (K8s) |
| `ant:infra:ide:lastAccess:{instanceKey}` | String | IDE 마지막 접근 시간 |

### Index 도메인 (`ant:index:*`)

| 키 | 타입 | 용도 |
|----|------|------|
| `ant:index:jobsByFeature:{projectId}:{featureName}` | Set | Feature별 Job 인덱스 |

### 키 형식 규약

| 키 종류 | 형식 | 구성 요소 수 |
|---------|------|-------------|
| IDE portKey | `{tenantId}:{userId}:{projectId}` | 3 (프로젝트 단위) |
| Preview portKey | `{tenantId}:{userId}:{projectId}:{feature}` | 4 (피처 단위) |
| sessionKey | `{orgId}:{userId}:{projectId}/{featureName}` | 복합 |

## Pub/Sub 채널

중앙 정의: `src/infrastructure/state/redisConstants.ts` (REDIS_CHANNELS)

### 채널 목록

| 채널 | Publisher | Subscriber | 용도 |
|------|-----------|------------|------|
| `realtime:broadcast:{orgId}:{userId}` | Job Worker | Realtime Server | Chat, Kanban, FileTree 등 범용 |
| `realtime:workflow:{orgId}:{userId}` | Job Worker | Realtime Server | 워크플로우 노드 상태 |
| `job:stop` | API Server | Job Worker | Job 중지 신호 |
| `job:status:updates` | Job Worker | API Server | Job 완료/실패 알림 |

### 멀티테넌트 격리

실시간 채널은 `{orgId}:{userId}` 스코프로 구성된다. 다른 사용자의 이벤트가 누출되지 않는다. Realtime Server는 SSE 연결 시 `userContext`에서 구독할 채널명을 결정한다.

### 채널 헬퍼 함수

| 함수 | 반환 |
|------|------|
| `getRealtimeBroadcastChannel(orgId, userId)` | `realtime:broadcast:{orgId}:{userId}` |
| `getRealtimeWorkflowChannel(orgId, userId)` | `realtime:workflow:{orgId}:{userId}` |
| `parseChannelUserContext(channel)` | `{ orgId, userId } \| null` |

## BullMQ

### 큐 구성

| 항목 | 값 |
|------|---|
| 큐 이름 | `ant-jobs` |
| 기본 동시성 | 2 |
| Lock duration | 10분 |
| Lock extend interval | 5분 |

### Job Payload

BullMQ에 enqueue되는 payload에는 agent, jobType, projectId, featureName, directive, userContext 등이 포함된다. Worker가 dequeue 후 자식 프로세스를 스폰하며, payload를 환경변수로 전달한다.

## StateStore 인터페이스

`RedisStateStore`는 `StateStorePort` 인터페이스를 구현한다. 모든 프로세스에서 동일한 인터페이스로 Redis에 접근한다. In-memory fallback은 존재하지 않는다.

주요 메서드 그룹:

| 그룹 | 메서드 |
|------|--------|
| Job 상태 | `setJobStatus`, `getJobStatus`, `setJobMapping` |
| Kanban | `setTaskQueueSnapshot`, `getTaskQueueSnapshot` |
| Workflow | `setWorkflowState`, `getWorkflowState` |
| Chat | `setChatSession`, `getChatSession` |
| Choice | `setPendingChoice`, `getPendingChoice`, `deletePendingChoice` |
| Preview | `setPreviewState`, `getPreviewState`, `listPreviews` |
| IDE | `setIDEState`, `getIDEState`, `listIDEs` |
| Index | `addJobToFeatureIndex`, `listJobsByFeature` |

## 환경변수

### 인프라 (DevOps 관리)

| 변수 | 필수 | 용도 |
|------|------|------|
| `ANT_REDIS_URL` | Y | Redis 연결 URL |
| `ANT_WORKSPACE_BASE_PATH` | Y | 워크스페이스 루트 경로 |
| `ANT_SERVER_MODE` | Y | `local` 또는 `cloud` |
| `ANT_ENCRYPTION_KEY` | Y | 암호화 키 |
| `ANTHROPIC_API_KEY` | Y | Claude API 키 |
| `OPENAI_API_KEY` | N | OpenAI API 키 |

### 런타임 (자식 프로세스 주입)

중앙 정의: `src/core/types/processEnv.ts` (CHILD_PROCESS_ENV)

| 변수 | 용도 |
|------|------|
| `ANT_JOB_ID` | Job 식별자 |
| `ANT_PROJECT_ID` | 프로젝트 ID |
| `ANT_FEATURE` | Feature 이름 |
| `ANT_JOB_TYPE` | Job 타입 |
| `ANT_AGENT` | 에이전트 타입 |
| `ANT_USER_ID` | 사용자 ID (인증 세션 기반) |
| `ANT_ORG_ID` | 조직 ID (인증 세션 기반) |
| `ANT_PROJECT_PATH` | 프로젝트 절대 경로 |
| `ANT_FEATURE_PATH` | Feature 절대 경로 |
| `ANT_REDIS_URL` | Redis URL |
| `ANT_API_URL` | API Server URL |

`ANT_USER_ID`와 `ANT_ORG_ID`는 `.env`에 설정하지 않는다. 인증 세션에서 동적으로 결정된다.

## 경계

- 프로세스 토폴로지와 배포 모델: [00-system-overview.md](00-system-overview.md)
- Job 큐의 실행 흐름: [02-job-lifecycle.md](02-job-lifecycle.md)
- SSE 연결과 브로드캐스팅: [09-realtime-system.md](09-realtime-system.md)
