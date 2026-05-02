# Chat System

## 개요

Chat 시스템은 사용자와 AI 에이전트 간의 대화를 관리한다. LLM 스트리밍 응답 처리, 콘텐츠 병합, Choice Card, Activity Indicator로 구성된다. Job Worker가 직접 Redis에 접근하여 채팅 상태를 관리한다.

## 서비스 분리

| 서비스 | 위치 | 역할 |
|--------|------|------|
| LLMResponseService | Job Worker (자식 프로세스) | LLM 스트리밍 처리, 콘텐츠 병합, Redis 저장/publish |
| ChatService | API Server | 메시지 CRUD, triage 처리, 유저 메시지 추가 |
| MessageBroadcaster | Job Worker | user-scoped Redis Pub/Sub 래퍼 |

### 데이터 흐름

```
LLM API -> LLM 스트리밍 청크
    -> LLMResponseService (자식 프로세스 내 직접 처리)
        -> ContentMerger (콘텐츠 병합)
        -> SessionStore -> Redis SET (세션 저장)
        -> MessageBroadcaster -> Redis PUBLISH (user-scoped 채널)
    -> Realtime Server (subscribe) -> SSE -> ant-ui

API Server (ChatService):
    GET  /chat/messages        (메시지 조회)
    DELETE /chat/messages      (메시지 삭제)
    POST /chat/user-message    (유저 메시지 추가)
    POST /chat/triage-choice   (사용자 선택 처리)
    GET  /chat/pending-choice  (펜딩 선택 확인)
```

Job Worker는 API Server를 거치지 않고 직접 Redis에 접근한다.

## 통합 메시지 콘텐츠 타입

`MessageContent.type`은 단일 유니온 타입으로 모든 채팅 콘텐츠를 표현한다.

| 카테고리 | 타입 |
|----------|------|
| Chat Status (진행 표시) | `placeholder`, `thinking`, `exploring`/`explored`, `retrieving`/`retrieved`, `grepping`/`grepped`, `reading`/`read`, `reading_source`/`read_source`, `indexing`/`indexed`, `analyzing`/`analyzed`, `loading`/`loaded`, `storing`/`stored`, `learning`/`learned`, `processing`/`processed`, `downloading`/`downloaded`, `figma_calling`/`figma_called` |
| 일반 콘텐츠 | `text`, `cancelled`, `triage_choice`, `choice_card`, `context_loaded`, `task_response` |
| 파일 연산 (실시간) | `file_creating`/`file_writing`/`file_create`/`file_create_failed`, `file_editing`/`file_updating`/`file_edit`/`file_edit_failed`, `file_deleting`/`file_delete`/`file_delete_failed`, `file_conflict`/`file_conflict_retry` |
| 도구 연산 | `tool_action`, `listing_files`/`listed_files`, `searching_code`/`searched_code`, `searching_reference`/`searched_reference` |
| 명령 실행 | `command_running`/`command_streaming`/`command` |
| Plan 스트리밍 | `plan_generating`/`plan` |

진행 중/완료 쌍(예: `exploring`→`explored`)은 ContentMerger의 fallback merge로 자동 매칭된다. `INFORMATIONAL_TYPES`(`context_loaded`)는 placeholder와 공존할 수 있다.

## ContentMerger

새 콘텐츠 추가 시 Universal Placeholder System에 따른 8단계 처리 파이프라인:

| 우선순위 | 케이스 | 동작 |
|----------|--------|------|
| 1 | 새 placeholder + 기존 placeholder 존재 | 기존 위치에서 in-place 교체 |
| 2 | 비-informational 콘텐츠 + placeholder 존재 | placeholder와 병합 (placeholder 소멸) |
| 3 | `_mergeIndex` 메타데이터 | 명시적 인덱스에 직접 병합 |
| 4 | 완료 상태 (`explored`, `read` 등) | 역방향 검색으로 대응하는 진행 중 상태와 병합 |
| 5 | 완료 타입 중복 | 무시 (dedup) |
| 6 | thinking 블록 전환 | duration 계산, collapse 브로드캐스트 |
| 7 | 같은 타입 스트리밍 | 내용 append (`text`, `thinking`, `plan_generating`, `task_response`, 동일 파일) |
| 8 | 파일 연산 완료 | `activeFileOperations` 또는 타입 기반 검색으로 진행 중 카드 업데이트 |

Placeholder는 contents[] 배열의 **어느 위치에나** 존재할 수 있다 (informational 타입이 뒤에 추가될 수 있기 때문). 모든 콘텐츠 추가는 반드시 `ContentMerger.addContent()`를 경유해야 한다.

## Chat Activity Indicator (CAI)

사용자에게 "시스템이 작업 중"임을 알려주는 시각적 피드백 시스템.

### 설계 원칙

- Zero-Gap Feedback: Job 시작부터 첫 LLM 토큰까지 빈 화면 없음
- Auto-Inject / Auto-Remove: placeholder 자동 삽입/제거
- Single Source of Truth: ContentMerger가 placeholder 수명주기 단독 관리

### Placeholder 자동 주입 시점

| 시점 | 호출 경로 |
|------|----------|
| 새 assistant 메시지 시작 | `LLMResponseService.startMessage()` -> `showChatStatus('placeholder')` |
| `<clarify>` 태그 감지 | `XMLStreamParser` -> `clarify_start` -> `showChatStatus('placeholder')` |
| 환경 감지 시작 | `detect()` -> `showChatStatus('placeholder')` |

### 프론트엔드 TypingIndicator 출현 조건

| 위치 | 조건 |
|------|------|
| ChatHistory Footer | isRunning && !hasActiveStreamingAssistant |
| MessageItem (빈 메시지) | isStreaming && contents.length === 0 |
| ShimmerCard (placeholder) | content.type === 'placeholder' && isStreaming |

isStreaming이 아닌 메시지의 잔여 placeholder는 렌더링하지 않는다 (방어적 필터링).

## SSE 재연결 시 메시지 유실 방지

SSE 연결이 끊겼다 복구되면, 스트리밍 중이던 assistant 메시지의 중간 콘텐츠가 유실될 수 있다. 이를 방지하기 위해 재연결 시 Redis에 저장된 현재 세션 스냅샷과 프론트엔드 상태를 동기화한다.

## Worker Scope · Task Scope · Section Ordering

채팅 이벤트의 `workerScope`는 **세 차원**을 합성한 식별자다. `core/parallel/workerScope.ts`의 AsyncLocalStorage가 세 dimension을 모두 들고 있으며, `TurnContext.getWorkerScopeKey()`가 단일 키 형태로 직렬화한다.

| 상황 | scope key |
|------|-----------|
| 메인 그래프 (no worker) | `_main_` |
| 병렬 worker, task 외부 | `worker-N` |
| 병렬 worker, task 실행 중 (첫 시도) | `worker-N#task-K` |
| 병렬 worker, task 실행 중 (re-entry cycle) | `worker-N#task-K#p{cycleSeq}` |
| cancelled choice card | `_cancelled_:{cardId}` |

`task-K`는 `task.id`(또는 `task.name` fallback)로 안정적이다. `TaskWorker.executeTask`가 `runInWorkerScope(workerId, …)` 안에서 `runInTaskScope(taskKey, cycleSeq, …)`로 task 별 scope를 overlay한다. 이 두 단계 wrapping 덕에 LLM emit, file ops, tool 호출 등 모든 chat 이벤트가 자동으로 정확한 식별자를 부여받는다.

### `cycleSeq` SSOT — task lifecycle entry cycle

`cycleSeq`는 **task 의 lifecycle entry index** 다. `TaskWorker.executeTask` 가 task 를 잡을 때 re-entry marker(`task.interrupted === true` 또는 `task._failedAttempts > 0`) 가 있으면 `StateStorePort.nextWorkerCycleSeq(turnId, taskKey)` 로 INCR + 받고, marker 가 없는 fresh entry 면 `getCurrentWorkerCycleSeq` 로 peek 만 한다. Redis key 는 `ant:chat:cycleSeq:{turnId}:{taskKey}` (per-(turn, task) 격리, 24h TTL).

INCR 트리거 source 3 개가 모두 `task.interrupted = true` marker 를 set 하므로 호출 site 한 곳 (TaskWorker.executeTask) 이 SSOT 가 된다:

| Source | Marker set 위치 |
|--------|----------------|
| 사용자 Stop + Resume | `handleInterruption` / checkpoint path 가 `interrupted: true` 로 task 를 큐에 보존 |
| batchSplit Path A 재큐 (verification) | [`tasks/_shared/batchSplit/process.ts`](packages/ant-cli/src/agents/architect/graph/code/tasks/_shared/batchSplit/process.ts) 의 `requeuedTask = { ...nextTask, interrupted: !!snapshot ? true : undefined, ... }` |
| TaskOrchestrator transient retry | [`parallel/TaskOrchestrator.ts`](packages/ant-cli/src/agents/architect/graph/code/parallel/TaskOrchestrator.ts) 의 `task.interrupted = true; this.taskQueue.push(task)` |

첫 시도(no marker)에는 cycleSeq=0 이 반환되고 suffix 가 생략되어 키가 `worker-N#task-K` 로 두 차원 form 과 동형이다 — chat.jsonl 라인의 schema BC 가 보존된다.

### `pauseSeq` ↔ `cycleSeq` — 의도적 분리 (코드 스멜 아님)

두 카운터는 monotonic INCR 이라는 외형만 비슷하고 책임이 다르다 — 통합하지 않는다.

| | `pauseSeq` (`CANCELLED_PAUSE_SEQ`) | `cycleSeq` (`WORKER_CYCLE_SEQ`) |
|---|---|---|
| Redis key | `ant:chat:pauseSeq:{turnId}` | `ant:chat:cycleSeq:{turnId}:{taskKey}` |
| 책임 | cancelled cardId uniqueness | worker scope suffix → FE section + WorkerLocalState slot 격리 |
| INCR 트리거 | 사용자 Stop (`ChatService.appendChoicePresentedCancelled`) | 모든 task re-entry (`TaskWorker.executeTask`) |
| 격리 단위 | turn 전체 | (turn, task) pair |

cancelled cardId 는 한 turn 안의 모든 task 에 걸쳐 unique 해야 하므로 turn-level 카운터로 충분하지만, worker scope 격리는 task 별로 독립적이어야 하므로 (turn, task) composite key 가 필요하다. 두 책임을 한 카운터에 묶으면 (이전 설계) Stop 외의 re-entry source (batchSplit / orchestrator retry) 가 cycleSeq 를 못 올려 stale `WorkerLocalState` slot 을 carry 한다 — 이 RCA 가 verification 재진입 시 file/command/thinking 카드가 채팅 위쪽에서 update 되던 버그였다.

### `_cancelled_:{cardId}`

`_cancelled_:{cardId}` 는 AsyncLocalStorage 가 아니라 `ChatService.appendChoicePresentedCancelled` 가 직접 stamping 하는 합성 scope 다. cardId 가 pauseSeq 를 포함하므로 한 turn 안에서 여러 번 pause-resume 이 발생해도 각 cancellation 이 독립 섹션으로 분리된다. 짝이 되는 `choice_resolved` 는 `findTurnIdByCardId` 가 원본 presented 라인에서 scope 를 surfacing 해 동일 섹션에 머무른다. cardId 는 cycleSeq 와 무관 (pauseSeq 만 사용) — 두 카운터의 책임 분리가 cardId schema BC 를 자연스럽게 보존한다.

### 왜 세 차원인가

- **`workerId` (1축)**: long-lived TaskWorker 루프 식별자.
- **`taskKey` (2축)**: 한 worker가 cohort 1의 task A를 끝내고 cohort 2의 task B를 이어 잡을 때 cohort 별 섹션 분리. 누락 시 cohort 2 메시지가 이미 끝난 다른 worker의 cohort 1 메시지보다 위쪽 스크롤에 나타나는 시간 역전이 발생한다(`rigid-fanning-faith` 회귀).
- **`cycleSeq` (3축)**: 한 task가 re-entry (Stop/Resume, batchSplit Path A, orchestrator transient retry) 를 거쳐도 `task.id` 는 동일하므로 누락 시 두 가지 회귀가 동시에 발생한다 —
  1. **FE section anchoring** (`even-getting-knave`): 모든 cycle 의 events 가 한 section 에 누적되어 first ts 가 첫 시도 시점에 영구 anchor 된다. cancelled card 의 first ts (=Stop 시점) 가 항상 더 늦으므로 chronological sort 결과 cancelled section 이 worker section *아래* 로 가서 채팅 입력창 바로 위에 "고정" 된다.
  2. **WorkerLocalState slot reuse** (verification 재진입 stale-card RCA): `LLMResponseService.workerStates: Map<workerScopeKey, WorkerLocalState>` 가 같은 키로 이전 cycle 의 `fileCardByPath` / `commandCardByCommand` / `thinking` cardId cache 를 재사용한다. 다음 cycle 의 terminal `chat_status` 가 옛 cardId 로 emit 되어 FE 가 같은 cardId 를 한 카드로 fold (last-write-wins, 첫 등장 위치) → 채팅 위쪽 (스크롤 히스토리) 의 file/command/thinking 카드가 새 cycle 의 결과로 업데이트되어 보임. cycleSeq 가 새 값을 받으면 `Map.get` 이 새 슬롯을 만들어 자동으로 격리된다.

### FE 섹션 정렬

`selectTurns`는 turn 안에서 `workerScope` 단위로 섹션을 만들고 다음 규칙으로 정렬한다:

1. `_main_`은 항상 첫 위치(turn-level orchestration narrative).
2. 그 외 섹션은 첫 이벤트 timestamp 오름차순.
3. 동률은 `workerScope.localeCompare`로 결정.
4. cancelled choice card는 BE에서 합성 `_cancelled_:{cardId}` scope를 받는다. 이 scope의 첫 이벤트 ts는 곧 사용자가 Stop을 누른 시점이므로 규칙 2에 의해 그 이전 worker 출력 **아래**에 자연 배치된다. 재개(`Resume`) 직후 worker가 다음 task 시도를 시작하면 `cycleSeq` 가 1 증가하여 worker scope가 `worker-N#task-K#p1` 로 바뀌고, 그 새 scope 의 첫 ts 는 cancelled scope 보다 더 늦으므로 추가 출력이 들어올수록 cancelled 카드는 위로 밀려난다. 즉 cycleSeq 가 없으면 이 규칙이 성립하지 않는다 — `even-getting-knave` 회귀의 본질이 이 의존성이었다.

`TurnItem.parseScope`는 `_main_`과 `_cancelled_:` 프리픽스 두 합성 scope의 worker label 헤더를 억제한다. cancelled 카드 자체가 시각적으로 self-contained ChoiceCard이므로 scope 라벨 노출은 노이즈일 뿐이다. cycleSeq suffix(`#p{n}`)는 worker label 의 일부로 그대로 통과시켜 디버그 시 어느 cycle 의 출력인지 판별 가능하다.

## Choice Card

### Variant

| Variant | 용도 |
|---------|------|
| `triage_choice` | 작업 라우팅 선택 |
| `cancelled` | 작업 취소 후 재개/무시 |
| `eval_save` | 평가 리포트 저장 |
| `spec_complete` | 스펙 완료 확인 |
| `clarifying` | PRD 생성 시 다수 질문 (Compound Card) |

### Compound Clarifying Card

N개 질문을 하나의 카드에 묶어 표시한다. 질문별 옵션 버튼과 인라인 직접입력을 지원한다. 1개 이상 응답 시 제출 가능(partial 허용). 모든 선택은 Zustand `pendingClarifyAnswers`에 저장되며 ChatInput과 공유된다.

### Cancelled Card NX semantics — release-on-failure

`ChatService.appendChoicePresentedCancelled` 의 `ant:chat:cancelled-emitted:job:{jobId}` NX guard 는 **"한 번 SUCCESSFULLY emit 됐으면 두 번째 시도 skip"** 의 의미다 — 단순히 "한 번 시도했으면 skip" 이 아니다. acquire 후 emission 이 throw 하면 (Redis blip / chat.jsonl write race / `autoResolveStaleCancelledCards` 실패 등) try/finally 에서 lock 을 즉시 release 해 다음 pause source 가 재시도 가능. 성공 path 에서는 24h NX 가 그대로 유지되어 multi-source idempotency contract (StaleJobRecovery / BullMQ stalled handler / ServerLifecycleManager 동시 fire 시 중복 카드 방지) 가 보존된다.

Release 누락 시 회귀: 이전 버그 (cleanupJobState 의 단일 outer try/catch 가 emit throw 를 swallow 했던 시점) 가 NX 만 set 하고 line emit 못 한 케이스를 만들면, 24h TTL 동안 같은 jobId 의 모든 cancelled card 시도가 silent skip 됨 (`cancelled-card-stale-NX` RCA — `vast-curling-perch` 에서 관측됨, fixed in commit `8ea931b8` + ChatService release-on-failure). 회귀 가드: [`tests/http/chatService.test.ts`](packages/ant-cli/tests/http/chatService.test.ts) 의 `release-on-failure (a~d)` 4 cases.

## 경계

- Redis Pub/Sub 채널: [02-infrastructure.md](02-infrastructure.md)
- SSE 연결과 브로드캐스팅: [21-realtime-system.md](21-realtime-system.md)
- Triage Choice: [12-triage-routing.md](12-triage-routing.md)
- Planner Clarify: [16-planner-job.md](16-planner-job.md)
