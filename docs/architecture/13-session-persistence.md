# Session Persistence Architecture

> Session 파일의 저장/복원 시점, 필드 매핑, 그리고 resume 정합성 보장을 위한 설계 문서

---

## 1. 개요

Code job과 Design job은 실행 중 상태를 `sessions/code.json`, `sessions/design.json`에 영속화한다.
중단(user stop, recursion limit) 후 재개 시 이 파일에서 상태를 복원하여 정확한 지점에서 이어서 실행한다.

모든 저장/복원은 `session.updateArtifacts()` / `session.load()`를 통해 수행된다.

### 핵심 원칙

1. **매 저장 시 전체 덮어쓰기** (append 아님) — 파일 크기가 무한 증가하지 않음
2. **저장 시점마다 필드가 다름** — 노드별로 필요한 필드만 저장 (checkpoint.ts는 예외: 전체 저장)
3. **복원은 runner.ts에서 일괄 수행** — graph invoke 이전에 initial state에 주입

---

## 2. Session 파일 구조

```
{featurePath}/sessions/
├── code.json      ← Code job state
├── design.json    ← Design job state
└── chat.json      ← Chat history (별도 관리)
```

각 JSON 파일의 최상위 구조:

```typescript
{
  sessionId: string;
  turns: Turn[];            // 실행 이력
  state: SessionState;      // 복원 대상 상태 (아래 상세)
  keyDecisions?: string[];  // Design job만
  activeBranch?: string;    // Code job만
  errorStatistics?: any;    // Code job만
}
```

---

## 3. 저장 시점 전체 매트릭스

### 3.1 Code Job

| # | 저장 시점 | 트리거 조건 | 저장 방식 | 주요 저장 필드 |
|---|----------|------------|----------|--------------|
| W1 | **runner.ts** (early) | graph invoke 이전, directive 존재 시 | 직접 updateArtifacts | `directive`, `overrideDirective` |
| W2 | **resolve** (new job) | 새 job 시작 시 (isResume=false) | 직접 updateArtifacts | `jobId`, `jobTiming`, `taskQueue`(빈), `completedTasks`(빈), `overrideDirective`, `chatSource` |
| W3 | **detectEnvironment** | detectEnv 완료 후 항상 | 직접 updateArtifacts (merge) | `detectionReport` |
| W4 | **decompose** | task queue 생성 후 | `saveCheckpoint()` | 전체 (아래 § 3.3) |
| W5 | **revise** (modify) | action=modify 시 | `saveCheckpoint()` | 전체 |
| W6 | **plan** | planText 생성 후 | `saveCheckpoint()` | 전체 |
| W7 | **codeGen** | 코드 생성 후 | `saveCheckpoint()` | 전체 |
| W8 | **runtimeValidate** | 검증 완료 후 | `saveCheckpoint()` | 전체 |
| W9 | **checkTaskStatus** | task 완료 시 | `saveCheckpoint()` | 전체 |
| W10 | **runner.ts** (recursion limit) | recursion limit 도달 시 | `saveCheckpoint()` | 전체 + `interruption` |
| W11 | **learn** | 최종 완료 시 | 직접 updateArtifacts | `taskQueue`, `completedTasks`, `completedTasksDetails`, `retries`, `enforcementHistory`, `interruption`(보존), `jobId`, `jobTiming`, `tokenUsage`, `directives`, `overrideDirective`, `chatSource`, `referenceRequests`, `detectionReport`, `activeBranch`, `errorStatistics` |

### 3.2 Design Job

| # | 저장 시점 | 트리거 조건 | 저장 방식 | 주요 저장 필드 |
|---|----------|------------|----------|--------------|
| W1 | **runner.ts** (early) | graph invoke 이전, directive 존재 시 | 직접 updateArtifacts | `directive`, `overrideDirective` |
| W2 | **detectEnvironment** | detectEnv 완료 후 항상 | 직접 updateArtifacts (merge) | `detectionReport` |
| W3 | **decompose** (UI) | UI task queue 생성 후 | 직접 updateArtifacts | `taskQueue`, `completedTasks`, `completedTasksDetails`, `jobId`, `jobTiming`, `tokenUsage`, `overrideDirective`, `chatSource` |
| W4 | **decompose** (system) | system task queue 생성 후 | 직접 updateArtifacts | `taskQueue`, `currentTask`, `completedTasks`, `completedTasksDetails`, `jobId`, `jobTiming`, `tokenUsage`, `referenceRequests` |
| W5 | **decompose** (fallback) | LLM 실패 시 fallback task | 직접 updateArtifacts | `taskQueue`, `completedTasks`, `completedTasksDetails`, `jobId`, `jobTiming` |
| W6 | **revise** (modify) | action=modify 시 | 직접 updateArtifacts | `taskQueue`, `completedTasks`, `completedTasksDetails`, `currentTask`, `planText`, `conversationHistory`, `files`, `filesToDelete`, `jobId`, `jobTiming`, `tokenUsage`, `overrideDirective`, `chatSource`, `detectionReport`, `referenceRequests` |
| W7 | **checkTaskStatus** | task 완료 시 | 직접 updateArtifacts | `taskQueue`, `completedTasks`, `completedTasksDetails`, `currentTask`(undefined), `planText`(빈), `conversationHistory`(빈), `files`, `filesToDelete`, `jobId`, `jobTiming`, `tokenUsage`, `overrideDirective`, `chatSource`, `detectionReport`, `referenceRequests` |
| W8 | **runner.ts** (recursion limit) | recursion limit 도달 시 | 직접 updateArtifacts | `taskQueue`, `currentTask`(undefined), `completedTasks`, `completedTasksDetails`, `interruption`, `jobId`, `jobTiming`, `tokenUsage`, `overrideDirective`, `chatSource`, `files`, `filesToDelete`, `detectionReport`, `referenceRequests`, `planText`, `conversationHistory` |
| W9 | **learn** | 최종 완료 시 | 직접 updateArtifacts | `taskQueue`, `currentTask`, `completedTasks`, `completedTasksDetails`, `interruption`(보존), `jobId`, `jobTiming`, `directives`, `overrideDirective`, `chatSource`, `detectionReport`, `referenceRequests`, `keyDecisions` |

### 3.3 saveCheckpoint() 저장 필드 (Code Job 전용)

Code job의 `checkpoint.ts`는 통합 저장 함수로, W4-W10에서 동일한 필드셋을 저장한다:

| 카테고리 | 필드 |
|---------|------|
| Task 상태 | `taskQueue`, `completedTasks`, `completedTasksDetails`, `currentTask`(존재 시) |
| Retry/Enforce | `retries`, `maxRetries`, `previousAttempts`, `enforcementHistory`, `lastViolations`, `previousFileCount`, `resolvedCategories` |
| 진행 상태 | `planText`, `conversationHistory`, `recursionCount`, `recursionLimit` |
| Directive | `directive`, `directives`(배열), `overrideDirective`, `chatSource` |
| Context | `detectionReport`, `referenceRequests`, `projectCodeContext`(filePaths만) |
| Artifact | `design`, `prd` |
| 메타 | `jobId`, `jobTiming`, `tokenUsage`, `interruption`(존재 시) |

---

## 4. 복원 시점 전체 매트릭스

### 4.1 Code Job

| # | 복원 시점 | 조건 | 복원 필드 |
|---|----------|------|----------|
| R1 | **runner.ts** (full resume) | `hasInterruption && hasTaskQueue` | `taskQueue`, `completedTasks`, `completedTasksDetails`, `retries`, `maxRetries`, `previousAttempts`, `enforcementHistory`, `lastViolations`, `previousFileCount`, `resolvedCategories`, `recursionCount`, `recursionLimit`, `tokenUsage`, `detectionReport`, `referenceRequests`, `projectCodeContext`, `planText`, `conversationHistory`, `directive`, `design`, `prd`, `jobId`, `jobTiming` |
| R2 | **runner.ts** (early fallback) | `ANT_IS_RESUME=true` && full resume 조건 미충족 | `directive`, `detectionReport` |
| R3 | **runner.ts** (recursion error) | recursion limit 에러 캐치 시 | `taskQueue`, `currentTask`, `completedTasks`, `completedTasksDetails`, `retries` 등 (W10 역으로) |
| R4 | **resolve** (resume path) | `state.isResume === true` | `workspaceConfig`(config에서), `design`, `designDocs`, `prd`, `parsedUiDocs`(디스크에서 reload) |
| R5 | **resolve** (session context) | 새 job 시작 시 | `session.turns` (SessionContextBuilder용) |

### 4.2 Design Job

| # | 복원 시점 | 조건 | 복원 필드 |
|---|----------|------|----------|
| R1 | **runner.ts** (full resume) | `hasInterruption && hasTaskQueue` | `taskQueue`, `completedTasks`, `completedTasksDetails`, `tokenUsage`, `detectionReport`, `referenceRequests`, `planText`, `conversationHistory`, `files`, `filesToDelete`, `directive`, `overrideDirective`, `chatSource`, `design`, `prd`, `jobId`, `jobTiming`, `hasUiDoc` |
| R2 | **runner.ts** (early fallback) | `ANT_IS_RESUME=true` && full resume 조건 미충족 | `directive`, `detectionReport` |
| R3 | **runner.ts** (recursion error) | recursion limit 에러 캐치 시 | `taskQueue`, `currentTask`, `completedTasks`, `completedTasksDetails` |
| R4 | **resolve** (resume path) | `state.isResume === true` | `design`, `designDocs`, `prd`, `parsedUiDocs`(디스크에서 reload) |
| R5 | **decompose** (preload) | decompose 진입 시 항상 | `completedTasksDetails` (UI 표시용) |

---

## 5. 저장-복원 대응표

아래는 주요 필드가 **어디서 저장되고 어디서 복원되는지**를 한눈에 보여준다.

### 5.1 Code Job

| 필드 | 최초 저장 시점 | 이후 갱신 | 복원 시점 |
|------|-------------|----------|----------|
| `directive` | W1 (runner early) | W4+ (checkpoint) | R1 또는 R2 |
| `overrideDirective` | W1 (runner early) | W4+ (checkpoint) | R1 |
| `detectionReport` | W3 (detectEnv) | W4+ (checkpoint) | R1 또는 R2 |
| `taskQueue` | W4 (decompose) | W5+ (매 checkpoint) | R1 |
| `completedTasks` | W4 (decompose, 빈값) | W9 (checkTaskStatus) | R1 |
| `planText` | W6 (plan) | W7+ (checkpoint) | R1 |
| `conversationHistory` | W7 (codeGen) | W7+ (checkpoint) | R1 |
| `projectCodeContext` | W6 (plan) | W7+ (checkpoint) | R1 (filePaths만) |
| `jobId` / `jobTiming` | W2 (resolve) | W4+ (checkpoint) | R1 |
| `interruption` | W10 (recursion limit) | - | R1 (조건 판별용) |
| `design` / `prd` | W4+ (checkpoint) | - | R1 + R4 (디스크 reload) |

### 5.2 Design Job

| 필드 | 최초 저장 시점 | 이후 갱신 | 복원 시점 |
|------|-------------|----------|----------|
| `directive` | W1 (runner early) | W3+ (decompose) | R1 또는 R2 |
| `overrideDirective` | W1 (runner early) | W3+ (decompose) | R1 |
| `detectionReport` | W2 (detectEnv) | W6+ (checkTaskStatus) | R1 또는 R2 |
| `taskQueue` | W3/W4 (decompose) | W6+ (checkTaskStatus) | R1 |
| `completedTasks` | W3/W4 (decompose, 빈값) | W7 (checkTaskStatus) | R1 |
| `planText` | W7 (checkTaskStatus, 빈값) | - | R1 |
| `conversationHistory` | W7 (checkTaskStatus, 빈값) | - | R1 |
| `files` / `filesToDelete` | W6 (revise) | W7 (checkTaskStatus) | R1 |
| `jobId` / `jobTiming` | W3/W4 (decompose) | W6+ (checkTaskStatus) | R1 |
| `interruption` | W8 (recursion limit) | - | R1 (조건 판별용) |

---

## 6. 저장 시점과 중단 시나리오 매핑

그래프의 어느 지점에서 중단되었을 때, session에 어떤 데이터가 존재하는가:

### 6.1 Code Job

| 중단 시점 | session에 존재하는 데이터 | resume 라우팅 |
|----------|------------------------|-------------|
| triage 도중/직후 | `directive` (W1) | → triage |
| detectEnv 도중 | `directive` (W1) | → triage |
| detectEnv 직후, decompose 이전 | `directive` (W1) + `detectionReport` (W3) | → decompose |
| decompose 도중 | `directive` + `detectionReport` (W3까지) | → decompose |
| decompose 직후 | 전체 checkpoint (W4) | → plan |
| plan/codeGen/tool 도중 | 전체 checkpoint + `planText` + `conversationHistory` | → plan (skip → codeGen) |
| checkTaskStatus 직후 | 전체 checkpoint, `planText`/`conversationHistory` 초기화됨 | → plan (다음 task) |

### 6.2 Design Job

| 중단 시점 | session에 존재하는 데이터 | resume 라우팅 |
|----------|------------------------|-------------|
| triage 도중/직후 | `directive` (W1) | → triage |
| detectEnv 도중 | `directive` (W1) | → triage |
| detectEnv 직후, decompose 이전 | `directive` (W1) + `detectionReport` (W2) | → decompose |
| decompose 도중 | `directive` + `detectionReport` (W2까지) | → decompose |
| decompose 직후 | task queue + 메타데이터 (W3/W4) | → plan |
| docGen/tool 도중 | 전체 상태 (recursion limit 시 W8) | → plan (skip → docGen) |
| checkTaskStatus 직후 | 전체 상태, `planText`/`conversationHistory` 초기화됨 (W7) | → plan (다음 task) |

---

## 7. 알려진 제약사항

### 7.1 비저장 필드 (의도적)

| 필드 | 이유 | 대안 |
|------|------|------|
| `parsedUiDocs` | Map 타입, 용량 큼 | resolve에서 디스크 reload (R4) |
| `projectCodeContext.files` | 파일 content 용량 (~500KB) | filePaths만 저장, LLM이 read_file로 접근 |
| `designDocs` | 배열, 디스크에 원본 존재 | resolve에서 디스크 reload (R4) |

### 7.2 직접 저장 vs checkpoint의 차이 (Design Job)

Design job은 `saveCheckpoint()` 통합 함수가 없고, 각 노드에서 직접 `updateArtifacts()`를 호출한다.
이로 인해 **저장 필드가 노드마다 다를 수 있다**:

| 문제 | 영향 |
|------|------|
| decompose(system)에서 `overrideDirective` 누락 | revise 이후 decompose 재실행 시 directive 유실 가능 |
| decompose(fallback)에서 `detectionReport` 누락 | fallback 후 중단 시 resume routing 실패 가능 |

> 향후 개선: Design job도 Code job처럼 `saveCheckpoint()` 통합 함수를 도입하여 필드 일관성을 보장하는 것을 권장한다.

### 7.3 merge vs overwrite

| 저장 방식 | 사용 노드 | 동작 |
|----------|---------|------|
| merge (`...session.state, newField`) | detectEnv (W3), runner early (W1) | 기존 state 보존 + 새 필드 추가 |
| overwrite (`state: { ... }`) | checkpoint, learn, decompose | 전체 state를 새 객체로 교체 |

merge 방식은 기존 데이터를 보존하지만, overwrite 방식은 **명시적으로 포함하지 않은 필드가 유실된다**.
`saveCheckpoint()`는 포괄적 필드를 포함하므로 안전하지만, 직접 updateArtifacts를 하는 경우 누락 위험이 있다.

---

## 8. 관련 파일

| 파일 | 역할 |
|------|------|
| `graph/code/nodes/checkpoint.ts` | Code job 통합 checkpoint 함수 |
| `graph/code/runner.ts` | Code job state 복원 + early save + recursion limit save |
| `graph/design/runner.ts` | Design job state 복원 + early save + recursion limit save |
| `graph/code/nodes/detectEnvironment/index.ts` | detectionReport 저장 |
| `graph/design/nodes/detectEnvironment.ts` | detectionReport 저장 |
| `graph/code/nodes/resolve.ts` | 새 job 초기 state 저장 + resume artifact reload |
| `graph/code/nodes/learn.ts` | Code job 최종 저장 |
| `graph/design/nodes/learn.ts` | Design job 최종 저장 |
| `core/types/session.ts` | SessionState 타입 정의 |
