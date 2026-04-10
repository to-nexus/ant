# Debug Logging

## 개요

ANT는 Job 실행 시 LLM 프롬프트 구조, 토큰 사용량, 실행 이벤트, 도구 호출 등의 디버그 정보를 `sessions/{agent}/debug/` 디렉토리에 기록한다. 이 정보는 프롬프트 주입 누락 진단, 토큰 폭증 감지, 장애 원인 추적에 사용된다.

### 설계 원칙

| 원칙 | 설명 |
|------|------|
| **MECE 카테고리** | 각 관심사는 정확히 하나의 로그 카테고리에만 기록된다. 중복 기록 금지. |
| **교차참조 가능** | 모든 엔트리에 `correlationKey`(`jobId:taskId:callIndex`)를 포함하여 카테고리 간 연결이 가능하다. |
| **Append-only** | 모든 로그는 append 전용이다. 기존 내용을 읽어 수정(prepend, truncate)하지 않는다. |
| **에이전트 동적 해석** | 로그 경로에 에이전트 이름을 하드코딩하지 않는다. `getAgentForJob(jobType)`으로 결정한다. |
| **Job Summary** | Job 완료 시 단일 요약 파일을 생성하여, 디렉토리 탐색 없이 전체 현황을 파악할 수 있다. |
| **Non-blocking** | 로그 기록 실패가 Job 실행을 중단시키지 않는다. |
| **JobId = 파일명** | 파일명은 `{jobId}.ext`만으로 구성한다. 디렉토리가 카테고리를 식별하므로 접두사를 붙이지 않는다. |

## 디렉토리 구조

```
sessions/{agent}/debug/
    summary/                  Job 종합 요약 (인덱스 + 핵심 지표)
        {jobId}.json
    prompts/                  LLM 프롬프트 구조 추적
        {jobId}.jsonl
    logs/                     Job/Task 라이프사이클 이벤트
        {jobId}.jsonl
    tokens/                   LLM 호출별 토큰 사용량
        {jobId}.jsonl
    plans/                    코드 태스크 생성 플랜
        {jobId}.json
    figma/                    Figma MCP 호출 디버그
        {jobId}.json
        screenshots/{nodeId}.*
```

### 파일 명명 규칙

디렉토리가 카테고리를 식별하므로 파일명에 카테고리 접두사를 붙이지 않는다. 파일명은 `{jobId}` + 확장자만으로 구성한다.

```
sessions/architect/debug/tokens/abc-123.jsonl    (O)
sessions/architect/debug/tokens/token-abc-123.json  (X — 접두사 중복, 확장자 불일치)
```

이 규칙으로 모든 카테고리에서 동일한 `jobId`로 파일을 찾을 수 있다:

```bash
ls sessions/architect/debug/*/{jobId}.*
```

경로 SSOT: `DEBUG_SUBDIRS` in `sessionPaths.ts`. 캐논 디렉토리: `CANONICAL_DIR_DEFS` in `@ant/shared/canonical.ts`.

에이전트별 디버그 하위 디렉토리:

| Agent | 하위 디렉토리 |
|-------|--------------|
| architect | summary, prompts, plans, logs, tokens, figma |
| planner | summary, prompts |
| creator | summary, prompts |

## 로그 카테고리

5개 카테고리로 관심사를 분리한다. 각 카테고리는 독립적이며, 다른 카테고리의 정보를 중복 기록하지 않는다.

### 1. Job Summary (`summary/{jobId}.json`)

Job 완료(정상/중단/실패) 시 자동 생성되는 단일 JSON 파일. "이 Job에서 무슨 일이 일어났는가"에 대한 진입점.

```json
{
  "jobId": "abc-123",
  "jobType": "code",
  "agent": "architect",
  "status": "completed",
  "startedAt": "2025-01-15T10:00:00Z",
  "completedAt": "2025-01-15T10:05:30Z",
  "elapsedMs": 330000,

  "tokens": {
    "totalInput": 125000,
    "totalOutput": 42000,
    "totalCacheRead": 98000,
    "totalCacheCreation": 27000,
    "billableInput": 62200,
    "cacheHitRatio": 0.784
  },

  "tasks": {
    "total": 5,
    "completed": 4,
    "failed": 1,
    "failedTaskIds": ["task-3"]
  },

  "issues": [
    { "type": "low_cache_hit", "taskId": "task-2", "callIndex": 3, "ratio": 0.12 },
    { "type": "high_iteration", "taskId": "task-3", "callCount": 18 },
    { "type": "contract_violation", "node": "execute", "missing": ["designTokens"] }
  ],

  "files": {
    "prompts": "prompts/abc-123.jsonl",
    "logs": "logs/abc-123.jsonl",
    "tokens": "tokens/abc-123.jsonl",
    "plans": "plans/abc-123.json"
  }
}
```

`files` 필드는 이 Job에 대해 실제로 생성된 디버그 파일의 상대 경로 목록이다. 디렉토리 탐색 없이 관련 파일을 알 수 있다.

`issues` 배열은 실행 중 감지된 이상 징후를 요약한다:

| Issue Type | 감지 조건 | 설명 |
|------------|----------|------|
| `low_cache_hit` | `cacheHitRatio < 0.5` (iterative 노드, callIndex > 0) | 프롬프트 캐시 불안정 |
| `high_iteration` | `callIndex >= 15` (iterative 노드) | 태스크 수렴 실패 가능성 |
| `contract_violation` | 템플릿 렌더링 시 누락 변수 감지 | 프롬프트 주입 누락 |
| `task_failure` | 태스크 실행 실패 | 재시도 초과, 재귀 한도 등 |
| `profile_missing` | 언어/프레임워크 프로파일 미발견 | 환경 감지 불완전 |

### 2. Prompt Trace (`prompts/{jobId}.jsonl`)

LLM에 전송되는 프롬프트의 구조적 메타데이터. 프롬프트 본문은 기록하지 않는다 — 어떤 템플릿을 조합했고, 어떤 변수를 주입했는지만 추적한다.

```jsonl
{"correlationKey":"abc-123:triage:0","node":"triage","timestamp":"...","templatePath":"triage/base","usedTemplates":["triage/rules"],"promptLength":4200,"tokenEstimate":1200,"injectedVariables":{"workspaceState":"[STRING: 2340 chars]"},"contractViolations":[]}
{"correlationKey":"abc-123:task-1:0","node":"decompose","taskId":"task-1","timestamp":"...","templatePath":"code/phases/decompose/base","promptLength":8500,"tokenEstimate":2428}
{"correlationKey":"abc-123:task-1:1","node":"execute","taskId":"task-1","callIndex":1,"timestamp":"...","templatePath":"code/phases/execute/base","promptLength":12000,"tokenEstimate":3428}
```

각 엔트리에 기록되는 필드:

| 필드 | 필수 | 설명 |
|------|------|------|
| `correlationKey` | Y | `{jobId}:{taskId}:{callIndex}` |
| `node` | Y | 그래프 노드 이름 (triage, decompose, execute, docGen 등) |
| `taskId` | N | 태스크 ID (triage는 태스크 없음) |
| `callIndex` | N | 같은 태스크 내 n번째 LLM 호출 |
| `timestamp` | Y | ISO 8601 |
| `templatePath` | N | 메인 Handlebars 템플릿 경로 |
| `usedTemplates` | N | 추가 사용된 템플릿 파일 |
| `resolvedPartials` | N | 렌더링 중 해석된 Handlebars 파셜 |
| `injectedVariables` | N | 주입된 변수 요약 (대용량 값은 `[STRING: N chars]`로 축약) |
| `contractViolations` | N | 누락 변수/파셜 목록 |
| `hardcodedContent` | N | 템플릿 외부에서 직접 주입된 콘텐츠 (2000자 제한) |
| `promptLength` | N | 총 프롬프트 문자 수 |
| `tokenEstimate` | N | 추정 토큰 수 (`chars / 3.5`) |

### 3. Execution Events (`logs/{jobId}.jsonl`)

Job과 Task의 라이프사이클 이벤트를 기록한다. "무엇이 언제 시작/완료/실패했는가"에 집중한다.

```jsonl
{"correlationKey":"abc-123::0","type":"job_start","timestamp":"...","data":{"jobType":"code","taskCount":5}}
{"correlationKey":"abc-123:task-1:0","type":"task_start","timestamp":"...","taskId":"task-1","data":{"taskName":"Create UserService","priority":1}}
{"correlationKey":"abc-123:task-1:0","type":"task_complete","timestamp":"...","taskId":"task-1","data":{"elapsedMs":45000,"llmCallCount":3}}
{"correlationKey":"abc-123::0","type":"job_complete","timestamp":"...","data":{"totalTasks":5,"elapsedMs":330000}}
```

이벤트 타입:

| 타입 | 스코프 | 설명 |
|------|--------|------|
| `job_start` | Job | Job 시작, 환경 정보 |
| `job_complete` | Job | 정상 완료, 집계 지표 |
| `job_interrupted` | Job | 사용자 중단 |
| `job_resumed` | Job | 중단된 Job 재개 |
| `task_start` | Task | 태스크 실행 시작 |
| `task_complete` | Task | 태스크 정상 완료 |
| `task_fail` | Task | 태스크 실패 (재시도 초과, 재귀 한도) |
| `task_retry` | Task | 검증 실패 후 재시도 |
| `parallel_start` | Batch | 병렬 배치 시작 |
| `parallel_complete` | Batch | 병렬 배치 완료 |
| `violation_detected` | Task | 출력 검증 위반 감지 |
| `tool_call` | Task | 도구 호출 (이름, 인자 요약, 결과 크기) |
| `phase_complete` | Job | 그래프 페이즈 완료 (decompose, execute 등) |
| `execute_interrupted` | Task | 태스크 내 실행 중단 (예산 소진) |

### 4. Token Ledger (`tokens/{jobId}.jsonl`)

LLM 호출 단위의 토큰 사용량. 비용 분석과 캐시 효율 모니터링에 사용된다.

```jsonl
{"correlationKey":"abc-123:task-1:0","type":"call","taskId":"task-1","node":"execute","callIndex":0,"timestamp":"...","inputTokens":8500,"outputTokens":2100,"cacheReadTokens":6200,"cacheCreationTokens":2300,"billableInputTokens":3470,"cacheHitRatio":0.729,"taskCumulativeInput":8500,"taskCumulativeOutput":2100}
{"correlationKey":"abc-123:task-1:1","type":"call","taskId":"task-1","node":"execute","callIndex":1,"timestamp":"...","inputTokens":9200,"outputTokens":1800,"cacheReadTokens":8700,"cacheCreationTokens":500,"billableInputTokens":1795,"cacheHitRatio":0.946,"taskCumulativeInput":17700,"taskCumulativeOutput":3900}
```

엔트리 타입:

| 타입 | 설명 |
|------|------|
| `call` | LLM 호출 1건의 토큰 상세 |
| `resume_marker` | Job 재개 시점 구분자 (Run 경계 표시) |

`call` 엔트리의 필드:

| 필드 | 설명 |
|------|------|
| `inputTokens` | 실제 전송된 입력 토큰 |
| `outputTokens` | LLM 응답 토큰 |
| `cacheReadTokens` | 캐시에서 읽은 토큰 |
| `cacheCreationTokens` | 캐시 생성에 사용된 토큰 |
| `billableInputTokens` | 비용 가중치 적용 (`input*1.0 + creation*1.25 + cacheRead*0.1`) |
| `cacheHitRatio` | `cacheRead / (cacheRead + input)`, 0-1 |
| `taskCumulativeInput` | 이 태스크의 누적 입력 토큰 |
| `taskCumulativeOutput` | 이 태스크의 누적 출력 토큰 |
| `taskCumulativeBillableInput` | 이 태스크의 누적 billable 입력 |

### 5. Plan Dump (`plans/{jobId}.json`)

코드 Job의 `planGeneration` 노드에서 태스크별로 생성한 실행 플랜. JSON 배열 형식으로 태스크가 누적된다.

```json
[
  {
    "taskId": "task-1",
    "taskName": "Create UserService",
    "taskType": "implementation",
    "priority": 1,
    "plan": { "steps": ["..."], "targetFiles": ["..."] }
  }
]
```

이 파일은 병렬 오케스트레이션 종료 후 패키지 커버리지 검사의 입력으로도 사용된다.

### 6. Figma MCP (`figma/`)

Figma MCP 호출의 캐시 히트, 중복 제거, rate limit, 에러 요약.

| 파일 | 형식 | 설명 |
|------|------|------|
| `{jobId}.json` | Single JSON | 호출 요약 + 이벤트 배열 |
| `screenshots/{nodeId}.*` | 바이너리 | Figma 노드 스크린샷 |

## 파일 포맷 규약

| 카테고리 | 포맷 | 확장자 | 이유 |
|----------|------|--------|------|
| Summary | JSON | `.json` | 단일 객체, 완전한 JSON으로 파싱 가능 |
| Prompts | JSONL | `.jsonl` | Append-only, 행 단위 파싱 |
| Logs | JSONL | `.jsonl` | Append-only, 행 단위 파싱 |
| Tokens | JSONL | `.jsonl` | Append-only, 행 단위 파싱 |
| Plans | JSON Array | `.json` | 태스크 누적 (read-modify-write 패턴) |
| Figma MCP | JSON | `.json` | Job 종료 시 일괄 기록 |

JSONL 규칙:

- 한 줄 = 하나의 완전한 JSON 객체 (compact, 줄 바꿈 없음)
- 파일에 대한 유일한 쓰기 연산은 `appendFile(line + '\n')`
- JSON Array를 유지하기 위한 truncate/rewrite 로직 없음
- 확장자는 `.jsonl`로 통일하여 포맷과 확장자 불일치 방지

## 교차참조 체계

모든 JSONL 엔트리에는 `correlationKey` 필드가 포함된다.

```
{jobId}:{taskId}:{callIndex}
```

| 상황 | correlationKey 예시 |
|------|-------------------|
| Job-level 이벤트 (job_start 등) | `abc-123::0` |
| Triage (태스크 없음) | `abc-123:triage:0` |
| Task-level, 첫 번째 LLM 호출 | `abc-123:task-1:0` |
| Task-level, 세 번째 LLM 호출 | `abc-123:task-1:2` |

동일한 `correlationKey`를 가진 엔트리를 카테고리 간에 조인하면, 하나의 LLM 호출에 대해 "어떤 프롬프트를 보냈고(`prompts/`), 토큰을 얼마 썼고(`tokens/`), 어떤 이벤트가 발생했는가(`logs/`)"를 연결할 수 있다.

```
prompts/{jobId}.jsonl  ──┐
tokens/{jobId}.jsonl   ──┼── correlationKey로 JOIN
logs/{jobId}.jsonl     ──┘
```

## 로거 수명주기

### 인스턴스 관리

각 로거(`PromptLogger`, `ExecutionLogger`, `TokenLogger`)는 `jobId` 기준의 싱글턴 Map으로 관리된다.

```
getXxxLogger(options)  →  Map<jobId, Logger>에서 조회/생성
  ↓
log(entry)             →  appendFile (JSONL 한 줄)
  ↓
clearXxxLogger(jobId)  →  Map에서 제거 (finalize 후)
```

수명주기 보장 규칙:

1. **생성**: `get*Logger()` 호출 시 lazy 생성. 동일 `jobId`에 대해 하나만 존재.
2. **사용**: `log()` 호출은 non-blocking. 실패 시 `console.warn` 후 계속 진행.
3. **정리**: Job 완료/실패/중단 시 반드시 `clear*Logger(jobId)` 호출. `learn` 노드 또는 `job_complete` 핸들러에서 일괄 정리.
4. **누수 방지**: Job Worker 프로세스는 Job당 자식 프로세스를 스폰하므로, 프로세스 종료 시 Map도 자동 해제된다. 그럼에도 명시적 `clear` 호출이 필수 — API 서버 프로세스에서 직접 실행되는 경우를 대비.

### 쓰기 직렬화

동일 파일에 대한 동시 쓰기는 Promise 큐(`writeQueue`)로 직렬화한다.

```typescript
private enqueue(fn: () => Promise<void>): Promise<void> {
  this.writeQueue = this.writeQueue.then(fn, fn);
  return this.writeQueue;
}
```

## Triage 로그 기록 규칙

Triage 노드는 그래프에서 가장 먼저 실행되지만, 다른 노드와 동일한 `appendFile` 패턴을 사용한다.

- Triage 로그는 `prompts/{jobId}.jsonl`에 append한다 (prepend 금지).
- Triage가 가장 먼저 실행되므로 자연스럽게 파일의 첫 엔트리가 된다.
- Job 재개 시에도 append 방식을 유지한다. `resume_marker`가 Run 경계를 표시한다.
- 동기 I/O(`readFileSync`, `writeFileSync`) 대신 비동기 I/O를 사용한다.

## Summary 생성

### 생성 시점

`JobSummaryWriter`는 다음 시점에 `summary/{jobId}.json`을 기록한다:

| 시점 | 트리거 |
|------|--------|
| Job 정상 완료 | `learn` 노드 실행 후 |
| Job 중단 | `job_interrupted` 이벤트 발생 후 |
| Job 실패 | Worker의 `failed` 핸들러에서 |

### 집계 로직

Summary는 다른 로그 파일을 읽지 않는다. 실행 중 인메모리로 누적된 지표를 사용한다:

- 토큰 합계: `TokenLogger`의 `taskBillableCumulative` Map
- 이슈 목록: `TokenLogger`의 모니터링 경고 + `PromptLogger`의 `contractViolations`
- 태스크 현황: `ExecutionLogger`의 `task_complete`/`task_fail` 카운트
- 파일 목록: 각 로거의 `getLogFilePath()`로 실제 경로 확인

## 소비 인터페이스

### API

| Endpoint | Method | 설명 |
|----------|--------|------|
| `/api/features/{featureId}/debug/summary/{jobId}` | GET | Job Summary JSON 반환 |
| `/api/features/{featureId}/debug/{category}/{jobId}` | GET | 카테고리별 로그 파일 내용 반환 |
| `/api/features/{featureId}/debug/summary/{jobId}/issues` | GET | Issues 배열만 반환 |

### CLI

```bash
ant debug summary <jobId>          # Summary 요약 출력
ant debug tokens <jobId>           # 토큰 사용량 테이블
ant debug issues <jobId>           # 감지된 이슈 목록
ant debug prompts <jobId>          # 프롬프트 구조 목록
```

### UI

Job 완료 후 디버그 패널에서 Summary의 `issues` 배열을 기반으로 경고를 표시한다.

- 캐시 히트율 저하 경고
- 높은 반복 횟수 경고
- 프롬프트 계약 위반 경고
- 태스크 실패 상세

## 에이전트 경로 해석

모든 로거는 생성 시 `getAgentForJob(jobType)`으로 에이전트를 결정한다.

```typescript
constructor(options: { featurePath: string; jobId: string; jobType: string }) {
  const agent = getAgentForJob(options.jobType);
  this.logDirPath = getSessionDebugDir(options.featurePath, agent, 'logs');
}
```

| jobType | Agent | 디버그 경로 |
|---------|-------|------------|
| code | architect | `sessions/architect/debug/` |
| design | architect | `sessions/architect/debug/` |
| learn | architect | `sessions/architect/debug/` |
| ask | architect | `sessions/architect/debug/` |
| plan | planner | `sessions/planner/debug/` |
| visual | creator | `sessions/creator/debug/` |

## Job 검증 프로토콜

Job 실행 후 디버그 로그를 검증하는 표준 절차. 에이전트 또는 사람이 동일하게 따른다.

### 입력

- `featurePath`: 피처 디렉토리 절대 경로
- `jobId`: 검증 대상 Job ID
- `agent`: 에이전트 이름 (architect / planner / creator)

디버그 루트: `{featurePath}/sessions/{agent}/debug/`

### Step 1: Summary 확인 (진입점)

`summary/{jobId}.json`을 읽는다.

| 확인 항목 | 판정 기준 | 심각도 |
|-----------|----------|--------|
| `status` | `completed`가 아니면 즉시 보고 | CRITICAL |
| `issues` 배열 | 비어있지 않으면 Step 2로 | WARNING ~ CRITICAL |
| `tasks.failed` | 1 이상이면 `failedTaskIds`로 Step 4 진행 | CRITICAL |
| `tokens.cacheHitRatio` | 0.5 미만이면 토큰 효율 이상 | WARNING |
| `tokens.billableInput` | job 유형 대비 비정상적 크기 확인 | WARNING |
| `files` | 기대하는 카테고리 파일이 모두 존재하는지 | WARNING |

Summary가 없으면 Job이 비정상 종료된 것이다. Step 3부터 시작한다.

### Step 2: Issues 분류

`issues` 배열의 각 항목을 유형별로 분류하고, 해당 카테고리 로그로 이동한다.

| Issue Type | 다음 행동 | 로그 카테고리 |
|------------|----------|--------------|
| `contract_violation` | Step 3 (프롬프트 추적) | `prompts/` |
| `low_cache_hit` | Step 4 (토큰 상세) | `tokens/` |
| `high_iteration` | Step 4 (토큰 상세) + Step 5 (실행 이벤트) | `tokens/` + `logs/` |
| `task_failure` | Step 5 (실행 이벤트) | `logs/` |
| `profile_missing` | Step 5 (실행 이벤트) | `logs/` |

### Step 3: 프롬프트 추적 (`prompts/{jobId}.jsonl`)

JSONL을 행 단위로 파싱한다. 각 행이 하나의 LLM 호출에 대한 프롬프트 메타데이터이다.

**확인 항목:**

| 항목 | 무엇을 보는가 | 이상 징후 |
|------|-------------|----------|
| `contractViolations` | 비어있지 않은 행 | 템플릿에 필요한 변수가 주입되지 않음 — 출력 품질 직접 영향 |
| `templatePath` | null 또는 누락 | 하드코딩 프롬프트 사용 (템플릿 시스템 우회) |
| `hardcodedContent` | 존재하는 행 | 템플릿 외부 직접 주입 — 유지보수 위험 |
| `injectedVariables` | `[STRING: 0 chars]` 또는 기대 변수 키 누락 | 빈 컨텍스트 주입 — LLM이 정보 부족 상태로 실행 |
| `tokenEstimate` | 극단적 값 (< 100 또는 > 100,000) | 프롬프트 구성 이상 |
| 전체 행 수 | 기대 노드 수와 비교 | 누락된 노드가 있으면 그래프 실행 경로 이상 |

**검증 규칙:**

```
FAIL  contractViolations가 1건이라도 있으면
WARN  hardcodedContent가 있으면
WARN  injectedVariables에서 기대 키가 빠져있으면
PASS  위 조건 모두 해당 없으면
```

### Step 4: 토큰 상세 (`tokens/{jobId}.jsonl`)

JSONL을 행 단위로 파싱한다. `type: "call"` 행만 분석 대상이다 (`resume_marker`는 건너뛴다).

**확인 항목:**

| 항목 | 무엇을 보는가 | 이상 징후 |
|------|-------------|----------|
| `cacheHitRatio` | callIndex > 0인데 0.5 미만 | 프롬프트 prefix가 매 호출 변경됨 — 캐시 불안정 |
| `callIndex` | 15 이상 | 태스크가 수렴하지 않음 — 무한 반복 가능성 |
| `taskCumulativeBillableInput` | 마지막 행의 값 | 태스크당 누적 비용 — 예산 대비 확인 |
| 같은 `taskId`의 `outputTokens` 추이 | 점점 줄어드는지 | 줄어들면 수렴 중, 변동 없으면 정체 |
| `cacheCreationTokens` | callIndex > 0인데 높은 값 | prefix 변경으로 매번 캐시 재생성 — 비용 낭비 |

**검증 규칙:**

```
FAIL  callIndex >= 20인 태스크 존재
FAIL  cacheHitRatio < 0.3인 행이 전체의 30% 초과
WARN  callIndex >= 15인 태스크 존재
WARN  cacheHitRatio < 0.5인 행이 연속 3회 이상
PASS  위 조건 모두 해당 없으면
```

### Step 5: 실행 이벤트 (`logs/{jobId}.jsonl`)

JSONL을 행 단위로 파싱한다. `type` 필드로 필터링한다.

**확인 항목:**

| 필터 | 무엇을 보는가 | 이상 징후 |
|------|-------------|----------|
| `type: "task_fail"` | `data.reason`, `data.errorMessage` | 실패 원인 — `recursion_limit`이면 Step 4와 교차 확인 |
| `type: "violation_detected"` | `data.violationType`, `data.retryCount` | 반복 위반 — 동일 violationType이 3회 이상이면 구조적 문제 |
| `type: "tool_call"` | `data.error` 존재 여부, `data.wasTruncated` | 도구 실패, 결과 잘림 |
| `type: "execute_interrupted"` | `data.reason` | 예산 소진으로 미완료 — 출력물 불완전 가능성 |
| `type: "job_start"` ~ `type: "job_complete"` | `elapsedMs` 차이 | 비정상적 소요 시간 |
| `type: "profile_missing"` | `data.profileType`, `data.profileName` | 환경 감지 불완전 — 부적절한 코드 생성 가능 |

**검증 규칙:**

```
FAIL  task_fail이 1건이라도 있으면
FAIL  execute_interrupted이 있으면
WARN  violation_detected이 동일 taskId에서 3회 이상
WARN  tool_call에 error가 있으면
WARN  profile_missing이 있으면
PASS  위 조건 모두 해당 없으면
```

### Step 6: 교차 검증

`correlationKey`를 이용해 카테고리 간 연결한다.

| 교차 확인 | 방법 | 의미 |
|-----------|------|------|
| 실패 태스크의 프롬프트 | `task_fail`의 `taskId` → `prompts/`에서 같은 `taskId` 행 | 실패 원인이 프롬프트 주입 누락인지 확인 |
| 실패 태스크의 토큰 추이 | `task_fail`의 `taskId` → `tokens/`에서 같은 `taskId` 행 | 캐시 불안정이 실패를 유발했는지 확인 |
| 높은 반복의 프롬프트 | `callIndex >= 15`인 `tokens/` 행의 `correlationKey` → `prompts/` | 반복되는 호출에서 프롬프트가 달라지는지 확인 |

### 최종 판정

| 등급 | 조건 |
|------|------|
| **PASS** | 모든 Step에서 FAIL/WARN 없음 |
| **WARN** | FAIL 없음, WARN 1건 이상 |
| **FAIL** | FAIL 1건 이상 |

판정 결과와 함께 발견된 항목을 다음 형식으로 보고한다:

```
[FAIL] Step 3: contractViolation in node "execute" — missing: ["designTokens", "projectStructure"]
[FAIL] Step 5: task_fail task-3 — reason: recursion_limit, callIndex: 22
[WARN] Step 4: low cacheHitRatio (0.18) for task-2, callIndex 3-7
[PASS] Step 1, 2, 6: no issues
```

## 경계

- Feature 디렉토리 구조 SSOT: [01-shared-contracts.md](01-shared-contracts.md) (`canonical.ts`)
- 워크스페이스 격리와 sessions 구조: [20-workspace-isolation.md](20-workspace-isolation.md)
- Job 라이프사이클과 로거 호출 지점: [10-job-lifecycle.md](10-job-lifecycle.md)
- 프롬프트 시스템 (템플릿 구조): [13-prompt-system.md](13-prompt-system.md)
- Realtime 시스템 (SSE 이벤트): [21-realtime-system.md](21-realtime-system.md)
