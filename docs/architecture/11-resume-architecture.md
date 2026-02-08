# Resume Architecture

> 중단된 작업의 재개(Resume) 흐름 설계

---

## 1. 개요

### 1.1 문제

ANT의 code job은 LangGraph 기반으로 여러 노드를 순회하며 실행된다.
실행 중 recursion limit, 수동 중단, API 에러 등으로 작업이 중단될 수 있으며,
이때 사용자가 작업을 재개(resume)하거나 새 지시(continue)를 추가할 수 있다.

기존 문제:
- Resume 시 `triage` → `detectEnvironment` → `decompose`를 불필요하게 재실행
- Task queue가 소실되거나 중복 생성
- `planText`가 항상 재생성 (비용 낭비)
- `conversationHistory`가 소실되어 codeGen이 처음부터 재시작
- `spec`과 `directive`의 중복으로 우선순위 혼란

### 1.2 솔루션

- `spec` 필드를 `directive`로 통합 (단일 진입점)
- `isResume` 플래그로 명시적 재개 감지
- `resolve` 노드에서 4-way 라우팅 (resume 상태별 최적 경로)
- `revise` 노드로 task queue 재구성 통합
- `planText` + `conversationHistory` 보존으로 task-level resume

---

## 2. 핵심 개념

### 2.1 directive / overrideDirective

| 필드 | 역할 | 소스 | 생명주기 |
|------|------|------|----------|
| `directive` | 현재 유효한 지시사항 (job-level) | CLI input / file / 이전 override 승격 | job 전체 |
| `overrideDirective` | 채팅으로 새로 입력된 지시사항 | HTTP API `req.body.overrideDirective` | revise 처리 후 directive로 승격 |

승격 흐름:
```
새 job:     directive="로그인 기능"     overrideDirective=없음
1차 중단:   directive="로그인 기능"     overrideDirective="OAuth 추가"
revise 후:  directive="OAuth 추가"     overrideDirective=없음 (승격됨)
```

### 2.2 isResume

API 레벨 플래그. graph state의 `hasTaskQueue`와 독립적.

| 소스 | 설정 시점 |
|------|----------|
| `runner.ts` | session에 interruption + taskQueue 존재 시 |
| `job.routes.ts` | `/resume`, `/continue` 엔드포인트 호출 시 |
| `process.env.ANT_IS_RESUME` | cloud mode에서 환경변수로 전달 |

### 2.3 Task 중단/재개 상태

```
Task 실행 중 (currentTask)
    ↓ 중단 발생
TaskTimingHelper.pauseTask() → interrupted=true
    ↓
currentTask → queue 맨 앞으로 이동
currentTask = undefined
    ↓ checkpoint 저장 (planText + conversationHistory 포함)
    ↓ 재개
queue에서 pop → plan 노드 진입
    ↓ interrupted=true 감지
planText 스킵, conversationHistory 복원 → codeGen 이어서 실행
```

---

## 3. Graph 라우팅

### 3.1 resolve 이후 4-way 분기

```
resolve
├── !isResume                              → triage (새 job)
├── isResume + hasTaskQueue + hasNewDir     → revise (task 재구성 판단)
├── isResume + hasTaskQueue                 → plan (plain resume)
├── isResume + hasDetectionReport           → decompose (detectEnv 이후 중단)
└── isResume (아무것도 없음)                  → triage (매우 이른 중단)
```

조건 변수:
- `isResume`: `state.isResume === true`
- `hasTaskQueue`: `state.taskQueue && !state.taskQueue.isEmpty()`
- `hasDetectionReport`: `!!state.detectionReport`
- `hasNewDir`: `!!state.overrideDirective`

### 3.2 전체 노드 흐름

```
__start__ → resolve → [4-way router]
                        ├→ triage → detectEnvironment → decompose → plan
                        ├→ revise → plan
                        ├→ plan (직행)
                        └→ decompose → plan

plan → codeGen → [router]
                   ├→ tool → codeGen (loop)
                   ├→ checkTaskStatus (feature task done)
                   └→ installDeps → runtimeValidate → checkTaskStatus

checkTaskStatus → [router]
                    ├→ enforce → plan (retry loop)
                    └→ learn → [router]
                                 ├→ plan (next task)
                                 └→ __end__
```

---

## 4. revise 노드

### 4.1 역할

`replanDecision` + `modifyTasks` + `clearStateForReplan` 3개 노드를 통합한 단일 노드.

진입 조건: `isResume && hasTaskQueue && overrideDirective`

### 4.2 동작

1. LLM에게 `directive`(직전) vs `overrideDirective`(신규) 비교 요청
2. 응답: `continue` 또는 `modify`
3. `modify` 시: `tasksToRemove` + `tasksToAdd` 즉시 적용

### 4.3 planText/conversationHistory 처리

| action | 중단된 task 영향 여부 | planText | conversationHistory |
|--------|----------------------|----------|---------------------|
| `continue` | - | 보존 | 보존 |
| `modify` | 영향 없음 | 보존 | 보존 |
| `modify` | 영향 있음 (삭제됨) | 초기화 | 초기화 |

영향 판단: 중단된 task(queue 맨 앞)의 ID가 `tasksToRemove`에 포함되는지 확인.

### 4.4 프롬프트 구조 (FPOP)

```
templates/code/phases/revise/
├── base.md   ← WHAT: 완료된 task, 남은 task, directive 비교 컨텍스트
└── rules.md  ← HOW: continue/modify 판단 기준, 제약사항, 응답 형식
```

---

## 5. Task-Level Resume

### 5.1 Checkpoint 저장 내용

`checkpoint.ts` → `session.updateArtifacts()` → `code.json`

주요 필드:
- `taskQueue`: 남은 task 배열
- `completedTasksDetails`: 완료된 task (timing, tokenUsage 포함)
- `planText`: 현재 task의 실행 계획 (LLM 생성)
- `conversationHistory`: codeGen↔tool 멀티턴 대화 이력
- `detectionReport`: 환경 감지 결과 (tool 활성화용)
- `projectCodeContext`: 파일 경로만 (내용은 디스크에서 reload)

### 5.2 Plan 노드 스킵 로직

```
plan 노드 진입
  → task pop + currentTask 설정 + timing
  → canSkipPlan 체크:
      !isRetry                          (enforce retry가 아님)
      && nextTask.interrupted === true   (이전에 중단된 task)
      && state.planText.length > 50     (유효한 planText 존재)
  → true:  keywords/RAG/LLM 호출 전부 스킵, 기존 planText 유지
  → false: 정상 planText 생성
```

### 5.3 codeGen 이어서 실행

`conversationHistory`가 복원되면 codeGen의 promptBuilder가 자동 감지:

```typescript
const isAfterToolCall = state.conversationHistory && state.conversationHistory.length > 0;
```

이전 assistant 응답 + tool_result가 메시지에 포함되어 LLM이 자연스럽게 이어서 작업.

### 5.4 planText 초기화 시점

| 시점 | 트리거 | 이유 |
|------|--------|------|
| task 완료 | `checkTaskStatus` | 다음 task로 오염 방지 (reducer 특성상 빈값 명시 필요) |
| revise modify (영향 있음) | `revise` 노드 | task 자체가 변경/삭제되어 기존 plan 무효 |
| enforce → plan | `isRetry=true` | violation 반영한 새 plan 필요 |

### 5.5 Edge Case 정리

| 시나리오 | planText | conversationHistory | plan 동작 |
|----------|----------|---------------------|-----------|
| Plain resume (directive 없음) | 복원 | 복원 | 스킵 → codeGen 이어서 |
| Resume + revise continue | 보존 | 보존 | 스킵 → codeGen 이어서 |
| Resume + revise modify (다른 task 변경) | 보존 | 보존 | 스킵 → codeGen 이어서 |
| Resume + revise modify (현재 task 삭제) | 초기화 | 초기화 | 새로 생성 |
| enforce → plan (retry) | stale | 존재 | 새로 생성 (isRetry) |
| learn → plan (다음 task) | 초기화됨 | 초기화됨 | 새로 생성 |
| plan 중 중단 (planText 미완성) | 빈값 | 빈값 | 새로 생성 |

---

## 6. 데이터 저장 구조

### 6.1 Session 파일

```
{featurePath}/sessions/
├── code.json     ← code job 세션 (state, turns, artifacts)
├── design.json   ← design job 세션
├── chat.json     ← chat 이력
└── debug/
    └── plans/    ← planText 디버그 로그
```

### 6.2 code.json 내 state 필드 생명주기

```
job 시작 → state 초기화
  ↓ checkpoint 저장 (plan/codeGen/validate 후)
  ↓ state 덮어씌움 (누적 아님)
  ↓ 중단 시: state에 interruption + conversationHistory 포함
  ↓ 재개 시: state에서 복원 → 소비
  ↓ task 완료 시: conversationHistory/planText 초기화
  ↓ job 완료 시: state 정리
```

`state`는 매 checkpoint마다 **덮어씌움**이라 파일이 무한히 커지지 않음.
`conversationHistory`는 일시적(transient) — 중단 시에만 존재, 재개 후 task 완료 시 소멸.

---

## 7. 관련 파일

| 파일 | 역할 |
|------|------|
| `graph/code/graph.ts` | 노드 등록, 엣지, 라우팅 정의 |
| `graph/code/runner.ts` | graph 실행, resume state 복원 |
| `graph/code/state.ts` | ArchitectGraphState 타입 정의 |
| `graph/code/nodes/resolve.ts` | 초기 state 로드, artifact reload |
| `graph/code/nodes/revise.ts` | task queue 재구성 (continue/modify) |
| `graph/code/nodes/plan/index.ts` | planText 생성 + skip 로직 |
| `graph/code/nodes/checkpoint.ts` | state → code.json 저장 |
| `graph/code/nodes/codeGen/index.ts` | LLM 코드 생성 + tool calling |
| `graph/code/nodes/codeGen/promptBuilder.ts` | conversationHistory 기반 메시지 구성 |
| `core/types/session.ts` | SessionState 타입 |
| `periphery/adapters/http/routes/job.routes.ts` | resume/continue API 엔드포인트 |
| `templates/code/phases/revise/base.md` | revise WHAT 템플릿 |
| `templates/code/phases/revise/rules.md` | revise HOW 템플릿 |
