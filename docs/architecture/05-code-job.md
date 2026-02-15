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

### installDeps

의존성 설치를 수행한다. final-verification 태스크(priority 1000)인 경우 인프라 기동 safety net을 포함한다 (후술).

### runtimeValidate

빌드, 린트, 타입체크를 프로그래밍 방식으로 검증한다. 실패 시 enforce 노드를 통해 plan으로 재진입한다.

### learn

태스크 완료 후 교훈을 추출하고 cleanup을 수행한다. 서버 프로세스 종료, 인프라 정리(stopInfrastructure) 등을 담당한다.

### revise

resume 시 새 directive(overrideDirective)가 있으면 기존 태스크 큐를 조정할지 LLM이 판단한다. `continue` 또는 `modify`(tasksToRemove + tasksToAdd) 결정.

## 인프라 기동 (Final Verification)

프로젝트가 외부 서비스(DB, Redis, MQ 등)에 의존하는 경우, final-verification 시 해당 인프라를 기동해야 빌드 및 런타임 검증이 가능하다. 이 시나리오는 언어/프레임워크에 무관하게 동일한 원칙으로 동작한다.

### Primary: LLM 자율 기동 (codeGen)

LLM이 태스크 실행 중 `run_command` 도구를 사용하여 직접 인프라를 기동하는 것이 메인 흐름이다. LLM이 `<done>true</done>`을 출력하기 **전에** 인프라 기동, 빌드, 런타임 검증을 모두 완료하는 것이 정상 경로이다.

프롬프트 가이드(`base.md` Step 2: Infrastructure)에 따라 LLM은 다음을 수행한다:

1. **Discover**: 프로젝트 설정 파일을 읽어 빌드/실행 커맨드와 인프라 정의를 파악
2. **Infrastructure**: `docker compose up -d --wait` 실행. compose 파일의 서비스 정의(포트, 자격 증명, DB명)를 읽어 앱이 필요로 하는 환경변수에 매핑
3. **Build**: 빌드/컴파일 커맨드 실행 (PRIMARY 검증 기준)
4. **Runtime**: 빌드 성공 시 dev/start 서버를 1회 실행하여 전체 스택 검증

핵심: compose 파일에서 서비스 연결 정보를 읽어 앱 환경변수를 도출하는 것까지 LLM의 책임이다.

### Safety Net: installDeps 프로그래밍 기동

LLM이 인프라 기동을 놓쳤을 경우의 보험이다. `installDeps` 노드가 `isFinalTask` 가드에 의해 final-verification 태스크(priority 1000)에서만 작동한다.

- `InfrastructureManager`를 사용하여 `docker-compose.yml`(또는 `compose.yml`) 감지
- `startInfrastructure()` 호출
- best-effort: 실패해도 워크플로우를 차단하지 않음

### Cleanup

`learn` 노드에서 태스크 완료 후 `stopInfrastructure()`를 호출하여 기동된 Docker 서비스를 정리한다. 서버 프로세스 cleanup과 동일 위치에서 수행된다.

### error task와의 관계

error task도 `installDeps -> runtimeValidate` 경로를 타지만, 프로그래밍 인프라 기동은 `isFinalTask` 가드에 의해 **스킵**된다. error task에서 인프라가 필요한 behavioral bug 검증이 발생하면, LLM이 codeGen에서 직접 `run_command`로 기동한다.

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
