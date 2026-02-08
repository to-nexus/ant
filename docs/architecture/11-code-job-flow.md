# Code Job Flow

> Code job의 실행 흐름, resume 아키텍처, task-level 재개 설계

---

## 1. 개요

Code job은 사용자의 directive(지시사항)를 받아 코드를 자동 생성하는 LangGraph 기반 에이전트이다.
task 분해(decompose) → 개별 task별 계획(plan) → 코드 생성(codeGen) → 검증(validate)의 흐름으로 동작하며,
중단(recursion limit, 수동 중단) 시 정확한 지점에서 재개(resume)할 수 있다.

---

## 2. 핵심 개념

### 2.1 directive / overrideDirective

| 필드 | 역할 | 소스 |
|------|------|------|
| `directive` | 현재 유효한 지시사항 (job-level) | CLI input, 이전 override 승격 |
| `overrideDirective` | 채팅으로 새로 입력된 지시사항 | HTTP API (resume/continue) |

승격 흐름:
```
새 job:     directive="로그인 기능"     overrideDirective=없음
1차 중단:   directive="로그인 기능"     overrideDirective="OAuth 추가"
revise 후:  directive="OAuth 추가"     overrideDirective=없음 (소비됨)
```

### 2.2 isResume

API 레벨 플래그. graph state의 `hasTaskQueue`와 독립적으로 동작한다.

| 소스 | 설정 시점 |
|------|----------|
| `runner.ts` | session에 interruption + taskQueue 존재 시 |
| `job.routes.ts` | `/resume`, `/continue` 엔드포인트 호출 시 |
| `process.env.ANT_IS_RESUME` | cloud mode에서 환경변수로 전달 |

### 2.3 Task 중단/재개 상태

```
Task 실행 중 (currentTask)
    | 중단 발생
    v
TaskTimingHelper.pauseTask() -> interrupted=true
    |
    v
currentTask -> queue 맨 앞으로 이동, currentTask = undefined
    | checkpoint 저장 (planText + conversationHistory 포함)
    v
재개: queue에서 pop -> plan 노드 진입
    | interrupted=true 감지
    v
planText 스킵, conversationHistory 복원 -> codeGen 이어서 실행
```

---

## 3. Graph 라우팅

### 3.1 resolve 이후 4-way 분기

```
resolve
+-- !isResume                              -> triage (새 job)
+-- isResume + hasTaskQueue + hasNewDir     -> revise (task 재구성 판단)
+-- isResume + hasTaskQueue                 -> plan (plain resume)
+-- isResume + hasDetectionReport           -> decompose (detectEnv 이후 중단)
```

조건 변수:
- `isResume`: `state.isResume === true`
- `hasTaskQueue`: `state.taskQueue && !state.taskQueue.isEmpty()`
- `hasDetectionReport`: `!!state.detectionReport`
- `hasNewDir`: `!!state.overrideDirective`

### 3.2 전체 노드 흐름

```
__start__ -> resolve -> [4-way router]
                         +-> triage -> detectEnvironment -> decompose -> plan
                         +-> revise -> plan
                         +-> plan (직행)
                         +-> decompose -> plan

plan -> codeGen -> [router]
                    +-> tool -> codeGen (loop)
                    +-> checkTaskStatus (feature task done)
                    +-> installDeps -> runtimeValidate -> checkTaskStatus

checkTaskStatus -> [router]
                    +-> enforce -> plan (retry loop)
                    +-> learn -> [router]
                                  +-> plan (next task)
                                  +-> __end__
```

---

## 4. State 복원 (runner.ts)

runner.ts는 graph invoke 이전에 session을 로드하여 state를 복원한다.

복원 대상:
- `taskQueue`, `completedTasks`, `completedTasksDetails`
- `detectionReport` (tool 활성화에 필수)
- `referenceRequests` (search_reference_code tool)
- `projectCodeContext` (filePaths만, content는 디스크에서 reload)
- `planText` (task-level resume용)
- `conversationHistory` (codeGen 이어서 실행용)
- `directive`, `overrideDirective`, `chatSource`
- `jobId`, `jobTiming`, `tokenUsage`
- `recursionCount`, `recursionLimit`
- `retries`, `maxRetries`, `previousAttempts`, `enforcementHistory`

---

## 5. revise 노드

### 5.1 역할

`replanDecision` + `modifyTasks` + `clearStateForReplan` 3개 노드를 통합한 단일 노드.

진입 조건: `isResume && hasTaskQueue && overrideDirective`

### 5.2 동작

1. LLM에게 `directive`(직전) vs `overrideDirective`(신규) 비교 요청
2. 응답: `continue` 또는 `modify`
3. `modify` 시: `tasksToRemove` + `tasksToAdd` 즉시 적용

### 5.3 planText/conversationHistory 처리

| action | 중단된 task 영향 여부 | planText | conversationHistory |
|--------|----------------------|----------|---------------------|
| `continue` | - | 보존 | 보존 |
| `modify` | 영향 없음 | 보존 | 보존 |
| `modify` | 영향 있음 (삭제됨) | 초기화 | 초기화 |

영향 판단: 중단된 task(queue 맨 앞)의 ID가 `tasksToRemove`에 포함되는지 확인.

### 5.4 프롬프트 구조 (FPOP)

```
templates/code/phases/revise/
+-- base.md   <- WHAT: 완료된 task, 남은 task, directive 비교 컨텍스트
+-- rules.md  <- HOW: continue/modify 판단 기준, 제약사항, 응답 형식
```

---

## 6. Task-Level Resume

### 6.1 Plan 노드 스킵 로직

```
plan 노드 진입
  -> task pop + currentTask 설정 + timing
  -> canSkipPlan 체크:
      !isRetry                          (enforce retry가 아님)
      && nextTask.interrupted === true   (이전에 중단된 task)
      && state.planText.length > 50     (유효한 planText 존재)
  -> true:  keywords/RAG/LLM 호출 전부 스킵, 기존 planText 유지
  -> false: 정상 planText 생성
```

### 6.2 codeGen 이어서 실행

`conversationHistory`가 복원되면 codeGen의 promptBuilder가 자동 감지:

```typescript
const isAfterToolCall = state.conversationHistory && state.conversationHistory.length > 0;
```

이전 assistant 응답 + tool_result가 메시지에 포함되어 LLM이 자연스럽게 이어서 작업.

### 6.3 planText 초기화 시점

| 시점 | 트리거 | 이유 |
|------|--------|------|
| task 완료 | `checkTaskStatus` | 다음 task로 오염 방지 |
| revise modify (영향 있음) | `revise` 노드 | task 자체가 변경되어 기존 plan 무효 |
| enforce -> plan | `isRetry=true` | violation 반영한 새 plan 필요 |

### 6.4 Edge Case 정리

| 시나리오 | planText | conversationHistory | plan 동작 |
|----------|----------|---------------------|-----------|
| Plain resume (directive 없음) | 복원 | 복원 | 스킵 -> codeGen 이어서 |
| Resume + revise continue | 보존 | 보존 | 스킵 -> codeGen 이어서 |
| Resume + revise modify (다른 task 변경) | 보존 | 보존 | 스킵 -> codeGen 이어서 |
| Resume + revise modify (현재 task 삭제) | 초기화 | 초기화 | 새로 생성 |
| enforce -> plan (retry) | stale | 존재 | 새로 생성 (isRetry) |
| checkTaskStatus -> plan (다음 task) | 초기화됨 | 초기화됨 | 새로 생성 |
| plan 중 중단 (planText 미완성) | 빈값 | 빈값 | 새로 생성 |

---

## 7. Checkpoint 저장

> 상세 저장/복원 시점, 필드 매핑, gap 분석은 `13-session-persistence.md` 참조.

저장 위치: `checkpoint.ts` -> `session.updateArtifacts()` -> `{featurePath}/sessions/code.json`

Code job은 `saveCheckpoint()` 통합 함수를 통해 일관된 필드셋을 저장한다. 주요 저장 시점:

| 시점 | 트리거 |
|------|--------|
| runner.ts (early) | directive 조기 저장 (중단 대비) |
| detectEnvironment | detectionReport 저장 (resume routing용) |
| decompose ~ runtimeValidate | saveCheckpoint() (전체 state) |
| runner.ts (recursion limit) | saveCheckpoint() + interruption |
| learn | 최종 state 저장 |

---

## 8. 관련 파일

| 파일 | 역할 |
|------|------|
| `graph/code/graph.ts` | 노드 등록, 엣지, 라우팅 정의 |
| `graph/code/runner.ts` | graph 실행, resume state 복원 |
| `graph/code/state.ts` | ArchitectGraphState 타입 정의 |
| `graph/code/nodes/resolve.ts` | 초기 state 로드, artifact reload |
| `graph/code/nodes/revise.ts` | task queue 재구성 (continue/modify) |
| `graph/code/nodes/plan/index.ts` | planText 생성 + skip 로직 |
| `graph/code/nodes/checkpoint.ts` | state -> code.json 저장 |
| `graph/code/nodes/codeGen/index.ts` | LLM 코드 생성 + tool calling |
| `templates/code/phases/revise/` | revise 프롬프트 (base.md + rules.md) |
