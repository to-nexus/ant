# Job Lifecycle

## 개요

Job은 사용자의 작업 요청 단위이다. HTTP 요청으로 시작되어 BullMQ 큐를 통해 Worker에 전달되고, 자식 프로세스에서 에이전트 그래프가 실행된다. 중단과 재개를 지원한다.

## Job 타입

| JobType | Agent | 산출물 |
|---------|-------|--------|
| `code` | architect | 소스 코드 |
| `design` | architect | 설계 문서 (MD, JSON) |
| `learn` | architect | 벡터 DB 인덱스 |
| `plan` | planner | PRD |
| `ask` | architect | 채팅 응답 |
| `inline-ask` | architect | 채팅 응답 (Job 컨텍스트 내) |

## 실행 흐름

### 1. Enqueue

API Server가 HTTP 요청을 받아 BullMQ에 Job을 enqueue한다.

```
POST /api/projects/:id/features/:feature/execute
    -> createExecuteJob()
    -> BullMQJobQueue.enqueue(JobPayload)
    -> Redis ant-jobs 큐에 저장
```

Feature당 동시 실행 가능한 Job은 1개이다. 이미 실행 중인 Job이 있으면 409를 반환한다.

### 2. Dequeue & Spawn

Job Worker(BullMQ Worker)가 큐에서 Job을 dequeue하고 자식 프로세스를 스폰한다.

```
JobWorker.processJob(bullmqJob)
    -> job-runner.ts를 자식 프로세스로 스폰
    -> JobPayload를 환경변수로 전달 (화이트리스트 방식)
    -> stdout/stderr 파이프로 로그 수집
```

환경변수는 화이트리스트 방식으로 격리된다. `...process.env` spread를 사용하지 않는다.

### 3. Orchestrate

자식 프로세스 내에서 Orchestrator가 agent + jobType 조합에 따라 적절한 에이전트 그래프를 실행한다.

```
job-runner.ts
    -> orchestrator({ agent, jobType, ... })
    -> agent/jobType 매핑:
        architect + code   -> runCodeGraph()
        architect + design -> runDesignGraph()
        architect + learn  -> runLearnGraph()
        architect + ask    -> runInlineAsk()
        planner + plan     -> runPlanGraph()
```

### 4. Execute

에이전트 그래프가 LangGraph StateGraph로 실행된다. 각 노드는 LLM 호출, 도구 실행, 파일 I/O 등을 수행한다. 실행 중 상태는 Redis에 실시간으로 반영되며 Pub/Sub로 브로드캐스트된다.

### 5. Complete

Job 완료 시 `job:status:updates` 채널로 API Server에 알린다. API Server는 내부 상태를 갱신하고 프론트엔드에 반영한다.

## 중단 (Interruption)

### 중단 사유

| 사유 | 트리거 |
|------|--------|
| `user_stopped` | 사용자가 중지 버튼 클릭 |
| `recursion_limit` | LangGraph recursion limit 도달 |
| `api_error` | LLM API 오류 |
| `process_crash` | 자식 프로세스 비정상 종료 |
| `timeout` | 실행 시간 초과 |
| `tasks_failed` | 병렬 실행 중 태스크 실패 |
| `awaiting_choice` | 사용자 선택 대기 (Triage) |

### 중단 처리 흐름

1. 중단 발생 시 현재 상태를 세션 파일에 checkpoint로 저장
2. `interruption` 메타데이터(reason, canResume, timestamp) 기록
3. Job 상태를 `interrupted`로 갱신
4. API Server에 알림
5. 프론트엔드에 중단 ChoiceCard 표시

### SIGTERM 처리

Job Worker가 `job:stop` 채널을 구독한다. 사용자 중지 요청 시 API Server가 이 채널에 publish하고, Worker가 자식 프로세스에 SIGTERM을 전달한다. 자식 프로세스 내 `gracefulShutdown.ts`가 등록된 orchestrator의 `handleInterruption()`을 호출하여 상태를 저장한 후 종료한다.

## 재개 (Resume)

### Resume 판정

`isResume` 플래그는 다음 조건에서 설정된다:
- 세션에 interruption이 존재하고 taskQueue가 있는 경우
- `/resume` 또는 `/continue` 엔드포인트 호출 시
- Cloud 모드에서 `ANT_IS_RESUME` 환경변수로 전달

### Resume 라우팅 (Code/Design Job)

resolve 노드에서 4-way 분기:

| 조건 | 라우팅 대상 |
|------|-----------|
| `!isResume` | triage (신규 Job) |
| `isResume + hasTaskQueue + overrideDirective` | revise (태스크 재구성 판단) |
| `isResume + hasTaskQueue` | plan (중단 지점부터 재개) |
| `isResume + hasDetectionReport` | decompose (환경 감지 후 중단) |

### Resume 라우팅 (Plan Job)

세션에서 conversation이 존재하면 triage를 건너뛰고 generate 노드로 직행한다.

### directive / overrideDirective

| 필드 | 역할 |
|------|------|
| `directive` | 현재 유효한 지시사항 |
| `overrideDirective` | 채팅으로 새로 입력된 지시사항 |

Resume 시 overrideDirective가 있으면 revise 노드에서 기존 태스크 큐를 조정할지 LLM이 판단한다. 처리 후 overrideDirective는 소비되어 directive로 승격된다.

## Checkpoint

### 저장 위치

`{featurePath}/sessions/{agent}/{jobType}.json`

### 저장 시점 (Code/Design Job)

| 시점 | 저장 내용 |
|------|----------|
| runner.ts (초기) | directive 조기 저장 |
| detectEnvironment | detectionReport |
| decompose ~ runtimeValidate | 전체 state (saveCheckpoint) |
| runner.ts (recursion limit) | 전체 state + interruption |
| learn | 최종 state |

### 저장 시점 (Plan Job)

| 시점 | 저장 내용 |
|------|----------|
| generate 완료 | conversation + conversationHistory + directive + tokenUsage |
| tool 완료 | conversationHistory + tokenUsage |
| SIGTERM | stateSnapshot의 최신 상태 + interruption |

### 세션 파일 동시 쓰기 보호

`FileSessionAdapter`는 두 가지 보호 메커니즘을 제공한다:
- **Per-job FileMutex**: read-modify-write 작업을 job 타입별로 직렬화
- **Atomic write**: temp 파일에 먼저 쓴 후 `fs.rename()`으로 원본 교체

## 경계

- BullMQ/Redis 인프라 규약: [01-infrastructure.md](01-infrastructure.md)
- 에이전트 그래프 구조: [03-agent-architecture.md](03-agent-architecture.md)
- Code Job 상세: [05-code-job.md](05-code-job.md)
- Design Job 상세: [06-design-job.md](06-design-job.md)
- Planner Job 상세: [07-planner-job.md](07-planner-job.md)
