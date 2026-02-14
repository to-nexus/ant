# Code Job

## 개요

Code Job은 사용자의 directive를 받아 소스 코드를 생성하는 architect 에이전트의 LangGraph 그래프이다. 태스크 분해 -> 계획 -> 코드 생성 -> 검증의 흐름으로 동작하며, 태스크 단위 중단/재개를 지원한다.

## 그래프 노드 흐름

### 순차 실행 (ANT_TASK_CONCURRENCY = 1)

```
__start__ -> resolve -> [4-way router]
    +-> triage -> detectEnvironment -> decompose -> plan (순차 루프)
    +-> revise -> plan
    +-> plan (직행, plain resume)
    +-> decompose (detectEnv 이후 중단 resume)

plan -> codeGen -> [router]
    +-> tool -> codeGen (도구 호출 루프)
    +-> checkTaskStatus (태스크 완료)
    +-> installDeps -> runtimeValidate -> checkTaskStatus

checkTaskStatus -> [router]
    +-> enforce -> plan (검증 실패, 재시도)
    +-> learn -> [router]
        +-> plan (다음 태스크)
        +-> __end__
```

### 병렬 실행 (ANT_TASK_CONCURRENCY > 1)

decompose 이후 `parallelOrchestrator` 노드로 분기한다. TaskOrchestrator가 N개의 TaskWorker를 관리하며, 각 Worker는 독립적인 Worker Subgraph를 실행한다.

## 주요 노드

### resolve

초기 상태 로드 및 resume 분기를 결정한다. 세션에서 taskQueue, detectionReport, directive 등을 복원한다.

### triage

공유 Triage 노드. 의도 분류, work status 판정, 선택지 제공.

### detectEnvironment

프로젝트 환경(frontend/backend/fullstack)을 감지하고 `detectionReport`를 생성한다. 도구 활성화와 프롬프트 구성에 사용된다.

### decompose

directive와 detectionReport를 기반으로 태스크를 분해한다. 각 태스크에 type, priority, exclusive, parallelGroup을 지정한다.

### plan

taskQueue에서 태스크를 pop하여 currentTask로 설정하고 planText를 생성한다. LLM에 키워드 검색과 RAG 결과를 제공하여 구현 계획을 수립한다.

**태스크 레벨 Resume**: `interrupted === true`이고 유효한 planText가 존재하면 plan 생성을 건너뛴다(canSkipPlan).

### codeGen

LLM이 도구 호출(read_file, write_file, search 등)을 통해 코드를 생성한다. `conversationHistory`가 복원되면 이전 대화 위에 이어서 작업한다.

### tool

codeGen의 도구 호출을 실행하고 결과를 반환한다.

### checkTaskStatus

완료된 태스크에 timing과 tokenUsage를 기록하고 checkpoint를 저장한다. planText와 conversationHistory를 초기화하여 다음 태스크 오염을 방지한다.

### enforce

runtimeValidate에서 검증 실패 시 violation 정보와 함께 plan으로 재진입한다.

### revise

resume 시 새 directive(overrideDirective)가 있으면 기존 태스크 큐를 조정할지 LLM이 판단한다. `continue` 또는 `modify`(tasksToRemove + tasksToAdd) 결정.

## State 복원

runner.ts는 graph invoke 이전에 세션을 로드하여 state를 복원한다:
- taskQueue, completedTasks, completedTasksDetails
- detectionReport
- referenceRequests, projectCodeContext (경로만)
- planText, conversationHistory
- directive, overrideDirective, chatSource
- jobTiming, tokenUsage, recursionCount

## Split Injection

병렬 실행 시 태스크의 `packages` 필드에 따라 필요한 설계 문서만 주입한다:
- `packages = ['fe']` -> fe-system-design + api-contract
- `packages = ['be']` -> be-system-design + api-contract
- `packages = ['fe', 'be']` -> 전체 포함

plan 노드는 RAG 결과를 파일 경로 목록만 주입한다. 실제 파일 읽기는 codeGen이 `read_file` 도구로 수행한다.

## 경계

- 에이전트 공통 패턴: [03-agent-architecture.md](03-agent-architecture.md)
- Job 실행/중단/재개: [02-job-lifecycle.md](02-job-lifecycle.md)
- Design Job: [06-design-job.md](06-design-job.md)
