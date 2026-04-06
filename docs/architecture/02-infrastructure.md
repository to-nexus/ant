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
| `ant:job:killReason:{jobId}` | String (JSON) | SIGTERM 전 종료 사유 (TTL 60s). Worker가 SET, job-runner가 GET |

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
| `ant:infra:preview-config:{portKey}` | String (JSON) | Preview 설정 (영속 — connections, structureType, projectProfile) |
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

| 항목 | 값 | 근거 |
|------|---|------|
| 큐 이름 | `ant-jobs` | |
| 기본 동시성 | 2 | |
| lockDuration | 5분 (300 000ms) | 가장 긴 LLM 호출(thinking=true, ~2분)에 마진을 둠 |
| lock extension interval | 2.5분 (150 000ms) | BullMQ 관례: lockDuration / 2 |
| stalledInterval | 1분 (60 000ms) | 실제 dead worker를 ~3분 내에 감지 |
| maxStalledCount | 0 | stalled job 재큐잉 금지 (Mac sleep/wake 시 double-child 방지) |

### Lock Extension과 Stalled Detection

BullMQ의 lock은 Worker가 Job을 처리하는 동안 다른 Worker가 같은 Job을 가져가지 못하게 보호한다. lock이 만료되면 BullMQ는 해당 Job을 "stalled"로 판정한다.

lock/timer 상수는 `infrastructure/queue/constants.ts`에 중앙 정의되어 JobWorker와 BullMQJobQueue에서 import한다.

**skipLockRenewal: true** — BullMQ 내장 auto-extension을 비활성화하고 수동 extension만 사용한다. 이유: 내장 auto-extension(75s 간격)이 수동 extension과 이중 실행되면, 수동 실패 카운터가 무의미해지고 Mac sleep 후 lock 만료 감지를 마스킹한다.

**정상 시퀀스:**

```
T=0       Worker가 Job dequeue → lock 획득 (TTL=5min)
T=2.5min  Extension 성공 → lock TTL 5min으로 갱신
T=5.0min  Extension 성공 → lock TTL 5min으로 갱신
  ...     (child 실행 중 반복)
T=end     Child 정상 종료 → moveToFinished → lock 해제
```

**Lock extension 실패 시퀀스 (Redis timeout 등):**

```
T=0       Lock 획득 (TTL=5min)
T=2.5min  Extension 실패 (1/2) → warn 로그, 카운터 증가
T=5.0min  Extension 실패 (2/2) → 연속 실패 임계 도달
          → 모든 타이머 정리 (lock extension + cancellation polling)
          → child에 SIGTERM → graceful shutdown → 체크포인트 저장
          → child 종료 후 3s grace period 내 미종료 시 SIGKILL
```

연속 실패 임계(MAX_CONSECUTIVE_LOCK_FAILURES=2)의 근거: extension interval=2.5min이므로, 2회 연속 실패 = 5분 경과 = lock 만료 직전. 이 시점에서 child를 종료하면 moveToFinished의 "Missing lock" 에러를 방지할 수 있다.

**Mac sleep 즉시 감지 (wall-clock gap detection):**

```
T=0       Lock 획득, lastExtensionTime = now
T=2.5min  Extension 성공, lastExtensionTime 갱신
          ... Mac sleep 시작 (setInterval 정지, Redis TTL만 감소) ...
T=7min+   Mac wake → 첫 interval tick 발생
          elapsed = now - lastExtensionTime > LOCK_DURATION
          → lock은 이미 만료 — extend 시도 없이 즉시 cleanup + child kill
```

원리: `setInterval`은 sleep 중 멈추지만 `Date.now()`는 wall-clock을 반환. wake 후 첫 tick에서 경과 시간이 lockDuration을 초과하면 즉시 감지. 기존 5분(2회 연속 실패 대기)을 0초로 단축.

**Stalled detection 시퀀스 (child/worker 크래시):**

```
T=0       Lock 획득 (TTL=5min)
T=2.5min  Extension 시도 못 함 (프로세스 크래시)
T=5.0min  Lock 만료
T=6.0min  stalledInterval 주기에 BullMQ가 stalled 감지
          → stalled 이벤트 발생
          → child kill (SIGTERM → 2.5s → SIGKILL)
          → 상태를 paused로 갱신, server_crash interruption publish
```

maxStalledCount=0이므로 stalled job은 재큐잉되지 않고, interruption으로 기록되어 사용자가 수동 resume할 수 있다.

**상태 경합 방어 (stalled handler vs processJob):**

Mac wake 시 stalled handler가 `paused`로 전환한 뒤, processJob이 `completed`/`failed`로 덮어쓸 수 있다. 이를 방지하기 위해 processJob에서 updateJobStatus 전에 현재 상태를 확인하고, 이미 `paused`이면 덮어쓰지 않는다.

### Child Process Kill — 통합 패턴

Child process를 종료해야 하는 시나리오가 5가지 있다. 1-4는 `killChildGracefully(child, jobId, gracePeriodMs)` 메서드를 사용하며, 5는 K8s가 직접 종료한다.

모든 Worker-initiated kill 경로는 SIGTERM 전에 `setKillReason(jobId, reason)`으로 Redis에 종료 사유를 기록한다. child의 SIGTERM handler가 이 값을 읽어 정확한 `InterruptionReason`을 결정한다.

| 시나리오 | 트리거 | Grace Period | Kill Reason |
|---------|--------|-------------|-------------|
| Stalled 감지 | BullMQ stalled 이벤트 | 2.5s | `server_crash` |
| 사용자 중지 | Redis `job:stop` 채널 | 3s | `user_stopped` |
| Lock 만료 임박 | Extension 연속 실패 | 3s | `server_crash` |
| Job 재처리 | 동일 jobId 중복 spawn | 3s | — |
| 인프라 종료 | K8s SIGTERM / KEDA scale-down | 300s (terminationGracePeriod) | `server_shutdown` |

Kill 시퀀스: `setKillReason → SIGTERM → 대기(gracePeriodMs, early exit 감지) → pid 생존 확인 → SIGKILL`

Child는 SIGTERM을 받으면 `resolveKillReason(jobId)`으로 100ms 이내에 Redis에서 종료 사유를 읽고, `gracefulShutdown.ts`의 핸들러를 통해 체크포인트를 저장하고 종료한다. Redis 키가 없으면 인프라 직접 kill로 판단하여 `server_crash`를 사용한다. SIGKILL은 grace period 내 미종료 시에만 발동되는 최후 수단이다.

### Timer 관리

`spawnJobProcess` 내의 두 타이머(lock extension, cancellation polling)는 `timers[]` 배열로 통합 관리된다. child가 어떤 경로로 종료되든 `cleanup()`이 양쪽 타이머를 모두 정리한다:

| 종료 경로 | cleanup 호출 위치 |
|----------|-----------------|
| 정상 종료 / 비정상 종료 | child `close` 이벤트 |
| spawn 실패 | child `error` 이벤트 |
| Lock 만료 감지 | extension 실패 핸들러 |
| 사용자 중지 감지 | cancellation 폴링 핸들러 |

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
| `GEMINI_API_KEY` | Y | Gemini API 키 |

### 런타임 (자식 프로세스 주입)

중앙 정의: `src/core/types/processEnv.ts` (CHILD_PROCESS_ENV)

| 변수 | 용도 |
|------|------|
| `ANT_JOB_ID` | Job 식별자 |
| `ANT_PROJECT_ID` | 프로젝트 ID |
| `ANT_FEATURE` | Feature 경로 식별자 |
| `ANT_FEATURE_NAME` | Feature 이름 별칭 |
| `ANT_JOB_TYPE` | Job 타입 |
| `ANT_AGENT` | 에이전트 타입 (`architect \| planner \| reviewer \| doc`) |
| `ANT_MODE` | 실행 모드 (`generate \| refactor \| explain`) |
| `ANT_USER_ID` | 사용자 ID (인증 세션 기반) |
| `ANT_ORG_ID` | 조직 ID (인증 세션 기반) |
| `ANT_USER_EMAIL` | 사용자 이메일 |
| `ANT_PROJECT_PATH` | 프로젝트 절대 경로 |
| `ANT_FEATURE_PATH` | Feature 절대 경로 |
| `ANT_REDIS_URL` | Redis URL |
| `ANT_API_URL` | API Server URL |
| `ANT_OVERRIDE_DIRECTIVE` | 재개 시 새 지시사항 |
| `ANT_INPUT_FILE` | 입력 파일 경로 |
| `ANT_IS_RESUME` | 재개 여부 |
| `ANT_ORIGINAL_JOB_ID` | 원본 Job ID (재개용) |
| `ANT_CHAT_SOURCE` | 채팅 소스 여부 |
| `ANT_SERVER_MODE` | 서버 모드 (`local \| cloud`) |
| `ANT_WORKSPACE_BASE_PATH` | 워크스페이스 기본 경로 |
| `ANT_CLI_ROOT` | CLI 루트 경로 |

`ANT_USER_ID`, `ANT_ORG_ID`, `ANT_USER_EMAIL`은 `.env`에 설정하지 않는다. 인증 세션에서 동적으로 결정된다.

## 경계

- 프로세스 토폴로지와 배포 모델: [00-system-overview.md](00-system-overview.md)
- Job 큐의 실행 흐름: [10-job-lifecycle.md](10-job-lifecycle.md)
- SSE 연결과 브로드캐스팅: [21-realtime-system.md](21-realtime-system.md)
