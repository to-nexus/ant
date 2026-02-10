# Design Job Flow

> Design job의 실행 흐름, resume 아키텍처, task 기반 문서 생성

---

## 1. 개요

Design job은 사용자의 directive를 받아 설계 문서(system-design, ui-spec 등)를 자동 생성하는 LangGraph 기반 에이전트이다.
Code job과 동일한 resume 아키텍처를 공유하되, 코드 생성 대신 문서 생성(docGen)을 수행한다.

### Code Job과의 차이점

| 항목 | Code Job | Design Job |
|------|----------|------------|
| 실행 노드 | plan -> codeGen -> tool | plan -> docGen -> tool |
| plan 역할 | LLM으로 planText 생성 | task queue 관리만 (LLM 호출 없음) |
| 검증 루프 | validate -> enforce -> plan | 없음 (docGen 완료 시 바로 checkTaskStatus) |
| task type | setup, feature | doc |
| 출력물 | 소스 코드 파일 | 설계 문서 (MD, JSON) |
| workType | 없음 | system-design, ui-design |

---

## 2. 핵심 개념

### 2.1 workType (Design 전용)

`detectEnvironment`에서 결정되며, 문서 생성 전략을 결정한다.

| workType | 대상 | 출력 파일 |
|----------|------|----------|
| `system-design` | 아키텍처 설계 | `system-design.md`, `api-contract.md`, `fe/be-system-design.md` |
| `ui-design` | UI 명세 | `ui-tokens.json`, `ui-assets.json`, `ui-spec.json` |

### 2.2 documentType (System Design)

decompose가 프로젝트 환경(environment)에 따라 문서 구조를 결정한다.

| environment | documentType | 출력 파일 |
|-------------|-------------|----------|
| frontend / backend | unified | `system-design.md` (단일) |
| fullstack | contract-first | `api-contract.md` + `fe-system-design.md` + `be-system-design.md` |
| fullstack + MSA | msa-contract-first | `api-contract.md` + `fe-system-design.md` + `be-system-design-{service}.md` (서비스별) |

### 2.3 directive / overrideDirective

Code job과 동일한 구조. 자세한 내용은 `11-code-job-flow.md` 참조.

### 2.4 isResume

Code job과 동일한 플래그. runner.ts에서 session 상태 기반으로 설정된다.

---

## 3. Graph 라우팅

### 3.1 resolve 이후 4-way 분기

Code job과 동일한 패턴:

```
resolve
+-- !isResume                              -> triage (새 job)
+-- isResume + hasTaskQueue + hasNewDir     -> revise (task 재구성 판단)
+-- isResume + hasTaskQueue                 -> plan (plain resume)
+-- isResume + hasDetectionReport           -> decompose (detectEnv 이후 중단)
```

### 3.2 전체 노드 흐름 (순차 실행)

> **병렬 실행** (`ANT_TASK_CONCURRENCY > 1`)시에는 decompose 이후
> `parallelOrchestrator` 노드로 분기된다. 상세는 `14-parallel-task-execution.md` 참조.

```
__start__ -> resolve -> [4-way router]
                         +-> triage -> detectEnvironment -> decompose -> [concurrency router]
                         +-> revise -> plan
                         +-> plan (직행)
                         +-> decompose -> [concurrency router]

[concurrency router]
  +-> ANT_TASK_CONCURRENCY=1 -> plan (순차 루프, 아래 흐름)
  +-> ANT_TASK_CONCURRENCY>1 -> parallelOrchestrator (14-parallel-task-execution.md)

plan -> docGen -> [router]
                   +-> tool -> docGen (loop)
                   +-> checkTaskStatus (done=true)
                   +-> docGen (retry, done=false)

checkTaskStatus -> [router]
                    +-> plan (next task)
                    +-> learn -> __end__
```

### 3.3 Code Job과의 차이

- `codeGen` 대신 `docGen` (XML 스트리밍 + 즉시 파일 쓰기)
- `installDeps`, `runtimeValidate`, `enforce` 루프 없음
- `docGen`의 완료 판단: LLM이 `<done>true</done>` 출력 시
- `docGen`이 `done=false`이면 자기 자신으로 재진입 (LLM 응답 이어서)
- `detectEnvironment`에서 `designError` 발생 시 `__end__`로 직행

---

## 4. State 복원 (runner.ts)

runner.ts는 graph invoke 이전에 session을 로드하여 state를 복원한다.
Code job의 패턴과 동일하며, design 고유 필드가 추가된다.

복원 대상:
- `taskQueue`, `completedTasks`, `completedTasksDetails`
- `detectionReport` (workType 라우팅에 필수)
- `referenceRequests` (search_reference_code tool)
- `planText`, `conversationHistory`
- `files`, `filesToDelete` (생성된 설계 문서)
- `directive`, `overrideDirective`, `chatSource`
- `jobId`, `jobTiming`, `tokenUsage`
- `design`, `prd` (기존 문서 아티팩트)
- `hasUiDoc` (UI 명세 존재 플래그)

### Recursion Limit 핸들링

runner.ts에서 recursion limit 도달 시:
1. `currentTask`를 `interrupted=true`로 설정하고 queue 맨 앞으로 이동
2. interruption 메타데이터와 함께 checkpoint 저장
3. `learn` 노드를 실행하여 세션 정리 시도 (실패해도 계속)
4. 중단 상태 반환

---

## 5. revise 노드

### 5.1 역할

resume 시 새 directive가 있으면 기존 task queue를 조정할지 LLM이 판단.
Code job의 revise와 동일한 패턴이나, task type이 `doc`이고 `targetFile` 필드가 추가된다.

진입 조건: `isResume && hasTaskQueue && overrideDirective`

### 5.2 적용 시나리오

- 고차원적 기획 요구사항 추가 (새 설계 문서 필요)
- 특정 패키지가 이미 구현되어 설계 범위 축소
- 외부 시스템 연동으로 설계 수정

### 5.3 프롬프트 구조 (FPOP)

```
templates/design/phases/revise/
+-- base.md   <- WHAT: 완료된 task, 남은 task, directive 비교 컨텍스트
+-- rules.md  <- HOW: continue/modify 판단 기준, 제약사항, doc task 우선순위 가이드
```

---

## 6. 주요 노드 상세

### 6.1 plan

- LLM 호출 없음 (code job과 다름)
- task queue에서 pop하여 currentTask 설정
- timing 시작 + token usage 초기화
- refactor 모드 시 smart context loading (codebase 재로드)

### 6.2 docGen

- XML 스트리밍 방식으로 설계 문서 생성
- `conversationHistory` 기반 멀티턴 대화 (tool calling 포함)
- tool 호출 시 `tool` 노드로 분기 후 재진입
- 완료 판단: `llmResponse.done === true`
- 파일을 즉시 디스크에 기록 (LAST_SECTION 핸들링)

### 6.3 checkTaskStatus

- 완료된 task에 timing + tokenUsage 기록
- checkpoint 저장 (다음 task를 위해 planText/conversationHistory 초기화)
- Kanban UI 업데이트
- queue에 task 남아있으면 `plan`, 없으면 `learn`

### 6.4 decompose

- resume 로직 없음 (runner.ts로 이관 완료)
- 순수 task 분해에만 집중
- system-design: LLM 기반 task 분해 (documentType + targetFiles)
- ui-design: LLM 기반 UI 복잡도 분석 후 task 분해
- explain 모드: 단일 explain task 생성 (LLM 호출 없음)

---

## 7. Checkpoint 저장

> 상세 저장/복원 시점, 필드 매핑, gap 분석은 `13-session-persistence.md` 참조.

저장 위치: `session.updateArtifacts()` -> `{featurePath}/sessions/design.json`

Design job은 각 노드에서 직접 `updateArtifacts()`를 호출한다 (Code job과 달리 통합 함수 없음). 주요 저장 시점:

| 시점 | 트리거 |
|------|--------|
| runner.ts (early) | directive 조기 저장 (중단 대비) |
| detectEnvironment | detectionReport 저장 (resume routing용) |
| decompose | task queue + 메타데이터 |
| revise (modify) | 수정된 task queue + 상태 |
| checkTaskStatus | task 완료 상태 + planText/conversationHistory 초기화 |
| runner.ts (recursion limit) | 전체 상태 + interruption |
| learn | 최종 state 저장 |

> 주의: 노드별 직접 저장이므로 필드 일관성이 Code job보다 취약하다. 상세 gap 분석은 `13-session-persistence.md` § 7.2 참조.

---

## 8. 관련 파일

| 파일 | 역할 |
|------|------|
| `graph/design/graph.ts` | 노드 등록, 엣지, 라우팅 정의 |
| `graph/design/runner.ts` | graph 실행, resume state 복원, recursion limit 핸들링 |
| `graph/design/state.ts` | DesignGraphState 타입 정의 |
| `graph/design/nodes/resolve.ts` | 초기 state 로드, artifact reload |
| `graph/design/nodes/revise.ts` | task queue 재구성 (continue/modify) |
| `graph/design/nodes/plan.ts` | task queue 관리 + smart context loading |
| `graph/design/nodes/decompose/index.ts` | task 분해 (system-design/ui-design/explain) |
| `graph/design/nodes/docGen/index.ts` | XML 스트리밍 문서 생성 + tool calling |
| `graph/design/nodes/learn.ts` | 세션 저장, 메모리 적재, workflow 종료 |
| `templates/design/phases/revise/` | revise 프롬프트 (base.md + rules.md) |
