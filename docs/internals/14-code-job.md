# Code Job

## 개요

Code Job은 사용자의 directive를 받아 소스 코드를 생성하는 architect 에이전트의 LangGraph 그래프이다. 태스크 분해 -> 계획 -> 코드 생성 -> 검증의 흐름으로 동작하며, 태스크 단위 중단/재개를 지원한다.

## 그래프 노드 흐름

### 순차 실행 (ANT_TASK_CONCURRENCY = 1)

```
__start__ -> resolve -> [4-way router]
    +-> triage -> detect -> decompose -> plan (순차 루프)
    +-> revise -> plan
    +-> plan (직행, plain resume)
    +-> decompose (detectEnv 이후 중단 resume)

plan -> [router]
    +-> tool -> plan (plan exploring)
    +-> execute (planText ready)
    +-> checkTaskStatus (batch split 완료, done=true)

execute -> [router]
    +-> tool -> execute (도구 호출 루프)
    +-> checkTaskStatus (done=true)
    +-> execute (self-loop retry)

checkTaskStatus -> [router]
    +-> enforce -> plan (violations + retries 남음)
    +-> learn -> [router]
        +-> plan (다음 태스크)
        +-> __end__
```

### 병렬 실행 (ANT_TASK_CONCURRENCY > 1)

decompose 이후 `parallelOrchestrator` 노드로 분기한다. TaskOrchestrator가 N개의 TaskWorker를 관리하며, 각 Worker는 독립적인 Worker Subgraph를 실행한다.

Worker Subgraph는 `CodeGraphChannels`를 spread하여 메인 그래프와 채널을 동기화한다. 새 채널 추가 시 `CodeGraphChannels`(`graph.ts`)에만 추가하면 Worker에 자동 반영된다. 상세: [11-agent-architecture.md](11-agent-architecture.md) "Worker Subgraph 채널 정의" 참조.

`TaskWorker.executeTask`는 `runInWorkerScope(workerId, …)` 안에서 `runInTaskScope(task.id, …)`로 한 번 더 감싸 모든 chat 이벤트가 `worker-N#task-K` 식별자를 자동 부여받게 한다. long-lived worker가 barrier cohort 사이를 가로질러 task를 직렬 실행해도 FE 섹션이 task별로 분리되고 시간순 정렬되어 chronology가 보존된다. 식별자/정렬 규약 상세: [31-chat-system.md](31-chat-system.md) "Worker Scope · Task Scope · Section Ordering".

## 주요 노드

### resolve

초기 상태 로드 및 resume 분기를 결정한다. 세션에서 taskQueue, resolvedAction, directive 등을 복원한다.

### triage

공유 Triage 노드. 의도 분류, work status 판정, 선택지 제공.

### detect

사용자 의도를 분석하여 `resolvedAction` (RAC)을 생성한다. explicit 경로는 metadata에서 직접, infer 경로는 LLM이 `InferredAction`을 반환한 뒤 `resolveToRAC()`로 변환. 프롬프트 구성과 ModeController에서 소비.

### decompose

directive와 resolvedAction을 기반으로 태스크를 분해한다. 각 태스크에 type, priority, exclusive, parallelGroup을 지정한다.

#### TechTier 판별

decompose는 LLM에게 태스크 분해와 함께 `<techTier>` 태그로 기술 스택 정보를 출력하도록 요구한다. 프롬프트 템플릿(`code/nodes/decompose/variants/default/base.md` + `techTier-rules.md`)이 관찰 우선순위와 제약 조건을 정의한다.

**Preset vs Inferred 이중 경로:**

```
UI BasisWizard → ActionMetadata.basis → detect → RAC.basis.techTier (preset)
                                                       ↓
                                             decompose prompt에 주입
                                                       ↓
                                        LLM이 preset 필드 보존 + 빈 필드 추론
                                                       ↓
                                           mergeTechTier(preset, inferred)
                                                       ↓
                                              RAC.basis.techTier (final)
```

사용자가 UI에서 techTier preset을 설정한 경우(`gen-code-directive` 인텐트의 BasisWizard), decompose 프롬프트에 사전 결정 필드가 주입되어 LLM이 해당 값을 그대로 사용한다. 미설정 필드만 추론한다.

**LLM 응답 → TechTier 변환 흐름:**

```
LLM 출력 <techTier>             코드 파싱               mergeTechTier(preset, inferred)
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ stack            │───>│ parsed           │───>│ RAC.basis        │
│ language         │    │   .stack         │    │   .techTier      │
│ framework        │    │   .language      │    │     .stack       │
│ packageTiers     │    │   .framework     │    │     .language    │
└──────────────────┘    │   .packageTiers  │    │     .framework   │
                        └──────────────────┘    │     .runtime     │
                                                └──────────────────┘
```

| TechTier 필드 | 판별 소스 | 정규화 |
|---|---|---|
| `language` | LLM constrained response (enum 제시) | `resolveLanguage()`: `javascript` → `typescript`, `golang` → `go` |
| `framework` | LLM constrained response (예시 제시, null 허용) | `resolveFramework()`: `Next.js` → `nextjs` 등 |
| `stack` | LLM constrained response | `frontend` / `backend` / `fullstack` 직접 매핑 |
| `runtime` | 시스템 파생 (LLM 판단 없음) | `resolveRuntime(stack, language)`: `frontend→browser`, `backend+go→go-api` |
| `packageManager` | 현재 code decompose에서 미설정 | `CodebaseAnalyzer.analyzeAsTechTier()`에서 설정 가능 |

**LLM 관찰 우선순위** (preset이 없을 때):

1. 디자인 문서 존재 여부 — 문서명 접두어로 tier scope 결정
2. 디자인 문서 내용 — 명시된 기술 스택
3. directive/PRD — 디자인 문서 부재 시에만 참조

**TechTier 접근**: `getTechTier(state)` 헬퍼로 RAC.basis.techTier를 읽는다. 레거시 `state.techTier` 직접 접근 대신 이 헬퍼를 사용한다.

### plan

taskQueue에서 태스크를 pop하여 currentTask로 설정하고 planText를 생성한다. LLM에 키워드 검색과 RAG 결과를 제공하여 구현 계획을 수립한다.

**태스크 레벨 Resume**: `interrupted === true`이고 유효한 planText가 존재하면 plan 생성을 건너뛴다(canSkipPlan).

### execute

LLM이 도구 호출(read_file, write_file, search 등)을 통해 코드를 생성한다. `conversationHistory`가 복원되면 이전 대화 위에 이어서 작업한다.

### tool

execute/plan의 도구 호출을 배치 실행하고 결과를 대화 히스토리에 추가한다. Code job은 `RUN_COMMAND`에 `CodeCommandPolicy`(Go build 차단, verification loop guard 등)를 적용한다. 도구 카탈로그, 핸들러 아키텍처, 오케스트레이터 상세는 [19-tool-system.md](19-tool-system.md) 참조.

### checkTaskStatus

완료된 태스크에 timing과 tokenUsage를 기록하고 checkpoint를 저장한다. planText와 conversationHistory를 초기화하여 다음 태스크 오염을 방지한다.

### enforce

violations 목록과 함께 plan으로 재진입한다. `checkTaskStatus`에서 violation이 있고 retries가 남아 있을 때 활성화된다.

### learn

태스크 완료 후 cleanup을 수행한다. 서버 프로세스 종료, 인프라 정리(`stopInfrastructure`) 등을 담당한다.

### revise

resume 시 새 directive(overrideDirective)가 있으면 기존 태스크 큐를 조정할지 LLM이 판단한다. `continue` 또는 `modify`(tasksToRemove + tasksToAdd) 결정.

## 인프라 기동 (Final Verification)

프로젝트가 외부 서비스(DB, Redis, MQ 등)에 의존하는 경우, verification 태스크 실행 중 LLM이 `run_command` 도구를 사용하여 인프라를 직접 기동하는 것이 유일한 흐름이다.

LLM은 `<done>true</done>` 출력 **전에** 다음 단계를 완료한다:

1. **Discover**: 프로젝트 설정 파일을 읽어 빌드/실행 커맨드와 인프라 정의를 파악
2. **Infrastructure**: `docker compose up -d --wait` 실행. compose 파일의 서비스 정의를 읽어 앱 환경변수에 매핑
3. **Build**: 빌드/컴파일 커맨드 실행 (PRIMARY 검증 기준)
4. **Runtime**: 빌드 성공 시 dev/start 서버를 1회 실행하여 전체 스택 검증

`learn` 노드에서 `stopInfrastructure()`를 호출하여 기동된 Docker 서비스를 정리한다.

## Error Diagnostics System

`diagnostics/` 디렉토리의 멀티언어 에러 파서가 빌드/테스트 실패 출력을 파싱하여 파일 단위로 분리한다.

- `verification` 태스크 = **진단 + fan-out 전담**. plan tool-loop 가 build/test 를 직접 실행해 root cause 를 분리하고, 1+ 수정 항목이 발견되면 무조건 per-target error sub-task 로 fan-out 한다. verification 자체는 fix 를 시도하지 않는다(execute phase 가 사실상 호출되지 않음 — fan-out 후 즉시 `done:true`).
- `error` 태스크 = **fix 전담**. fan-out 으로 spawn 된 1-entry sub-task 는 `prePlanText` fast-path 를 타고 plan 단계를 건너뛴 채 execute 로 진입해 단일 파일을 고친다.
- `test-code` 태스크: 모든 feature 태스크 완료 후 테스트 코드 생성

`processDiagnosticBatchSplit` 의 **always-fan-out 정책**: top-level `implementation.{modify,create,delete}` 는 자동으로 per-target batches[] 로 변환. 기존 `batches[]` 가 있으면 그대로 존중. 분할 임계 환경변수(`ANT_VERIFICATION_SPLIT_ERRORS` / `ANT_VERIFICATION_SPLIT_FILES`) 와 `forceByRepeat` 분기는 폐지(verification 책임이 fix 가 아니라 fan-out 으로 양극화되면서 임계 게이팅 자체가 의미 없음). 분할 cycle 의 하드 캡은 `MAX_BATCH_SPLIT_CYCLES = 10` 으로 보장.

> **Verification task 의 책임/불변식/안티패턴 전체**는 [17-code-verification-task.md](./17-code-verification-task.md) 참조 (SSOT — Session, gates, commandGuard, snapshot, terminal 등 12 책임 매트릭스).

## Deep-think Fan-out (feature / ui)

Decompose 가 솔루션을 모르는 directive (Tier 2 / 3 — 디자인 ref 부재) 에서는 deep-think 책임을 plan node 로 위임한다. plan 의 tool-loop 가 사고를 마친 후 작업이 N 개의 물리적으로 분리된 자식으로 갈라져야 한다고 판단하면 `<plan>` 본문에 `batches[]` 를 출력한다. `processDiagnosticBatchSplit` 가 동일 인프라로 fan-out 한다.

| Parent type | Policy `kind` | Sub `subType` | Children plan-loop | parentReasoning |
|---|---|---|---|---|
| `verification` | `requeue-parent` | `error` | **skip** (`acceptsPrePlanText:true` — identity-shortcut) | n/a (diagnostics) |
| `error` | `drop-and-replace` | `error` | **skip** (`acceptsPrePlanText:true` — identity-shortcut) | n/a (diagnostics) |
| `test-code` | `drop-and-replace` | `test-code` | **maintained** — `prePlanText` 가 plan-tool-loop INPUT 으로 surface (`nodes/plan/injections/parent-pre-plan.md`), LLM 이 sibling export 와 대조 후 `planText` emit | n/a |
| `feature` | `drop-and-replace` | `feature` | **maintained** — 동일 INPUT 컨트랙트. parent 가 emit 한 `parentReasoning` 의 예측 export 가 실제 sibling 산출과 어긋났는지 plan layer 가 drift 검출 | 부모의 cross-batch decisions (이름/시그니처/계약) — 모든 batch 에 동일 복제 |
| `ui` | `drop-and-replace` | `ui` | **maintained** — 동일 INPUT 컨트랙트 | 동일 — ui 자식은 plan-tool-loop 로 정밀화 후 execute |

**Tier 2 escalate**: `selfVerifyOnDone:true` 가 박힌 Tier 2 단일 task 가 plan 에서 `batches[]` 를 내면 `process.ts` 의 `isTier2EscalateCandidate` 분기가 자동 활성화돼 동일 fan-out 경로 (`drop-and-replace` + Final Verification 보충) 를 탄다. 자식들에는 `selfVerifyOnDone` 을 박지 않는다 — 게이트 책임은 새로 추가된 FV 가 가져간다.

**Lineage cycle 방어**: `process.ts` 가 자식 sub-task 에 `batchSplitCount = parent + 1` 을 carry 한다. 자식이 다시 fan-out 하면 누적 카운트가 부모 lineage 에 따라 증가하므로 `MAX_BATCH_SPLIT_CYCLES` 가 grand-child 차원까지 보장된다. 특히 `error` 외 모든 자식 (plan-tool-loop 유지: feature / ui / test-code) 에서 무한 확장을 차단하는 핵심 안전망 — identity-shortcut 을 타지 않으므로 자식이 다시 `batches[]` 를 emit 할 가능성이 열려 있다.

**parallelGroup 정합성**: 자식 `parallelGroup` 은 부모 group 을 base 로 상속한다 (없으면 `{type}-batch-{ts}` 새로 생성). 부모와 같은 큐의 형제 task 들과 file overlap 이 있을 수 있는 시나리오를 보수적으로 직렬화한다. 자식 batches 간 file overlap 은 `computeBatchFileOverlap` 가 별도로 검사해 overlap 있으면 그룹을 비우고 `exclusive:true` 로 강등한다.

**parentReasoning 의미**: feature / ui fan-out 에서만 사용. plan 이 결정한 "이 batch 묶음을 관통하는 큰 그림" — 공유 API 이름, 계약, 타입, 통합 지점. 모든 batch 의 `prePlanText` JSON 안에 동일하게 직렬화돼 형제 자식 간 시그니처 drift (한 자식이 `connect()`, 다른 자식이 `connectWallet()` 식) 를 방지한다. 명칭은 코드상 `featureBatchShape` 이 emit 하는 JSON 의 `parentReasoning` 필드.

## Cache Invalidation Scope

편집된 파일의 영향 범위에 따라 `VerificationSession._passed` 를 선택적으로 무효화한다. `decideInvalidationScope()` (`agents/common/tool/handlers/invalidationScope.ts`)가 경로와 diff를 관찰해 scope를 결정하고, `tool` 노드의 `verificationInvalidated` side effect 처리기가 해당 scope를 `Session.onFileChanged` 로 전달해 해당 gate 만 떨어뜨린다.

| 편집 대상 | scope | 근거 |
|---|---|---|
| 테스트 파일 (`*.test.*`, `tests/**` 등) | `test` | 타입/빌드 캐시와 무관 |
| 정적 자산 (`.css`, `.md`, 이미지, 폰트 등) | `build` | 번들링에만 영향 |
| 소스 코드 (`.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`) | `all` | 타입·빌드·테스트 모두 재검증 필요 |
| 매니페스트 `package.json` — devDependencies 단독 변경 | `test` + install | 테스트 도구 체인만 교체 |
| 매니페스트 `package.json` — dependencies / peerDependencies 변경 | `all` + install | 런타임 import 그래프 변동 |
| 매니페스트 `package.json` — scripts / engines / exports / packageManager 등 | `all` + install | 빌드 파이프라인 / 타입 해석 변동 가능 |
| 매니페스트 `package.json` — 필드 변화 없음 | `test` | formatting 등 무해 변경 |
| lockfile (`pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` / `cargo.lock` / …) | `build` + install | 의존성 버전 고정 — 타입 캐시는 보존, 빌드·테스트만 재검증 |
| 타 매니페스트 (`pyproject.toml` / `Cargo.toml` / `go.mod` 등) | `all` + install | diff 파서 없음 → conservative fallback |
| 알 수 없는 확장자 / 경로 | `all` | conservative fallback |

**보수성 원칙**: diff 부재 / 판별 실패 시 항상 `scope:'all'`로 안전 쪽으로 폴백한다. Narrowing은 캐시 최적화이지 정확성의 전제가 아니다.

런타임 측면에서 `commandGuard`는 `Session.passed()` 를 독립 조건으로 먼저 관찰하기 때문에, invalidation이 실제로 `Session.onFileChanged` 로 `_passed` 비트를 떨어뜨리지 않는 한 retry/reverify 경계를 넘어서도 이미 통과한 gate의 재실행을 `[Policy] ALREADY PASSED`로 결정론적으로 차단한다. 이는 프롬프트의 stochastic hint(`cachedPassedSteps`)에 의존하지 않고 관찰 가능한 Session 상태를 SSOT로 삼는 FPOP Constraints-over-Instructions 원칙의 적용이다.

## State 복원

runner.ts는 graph invoke 이전에 세션을 로드하여 state를 복원한다:
- taskQueue, completedTasks, completedTasksDetails
- resolvedAction (basis.techTier 포함)
- referenceRequests
- planText, conversationHistory
- directive, overrideDirective, chatSource
- jobTiming, tokenUsage, recursionCount

Plan 단계의 RAG 결과(`PlanCodeContext` — files / filePaths / directoryTree / gitDiff)는 task 진입 시 1회 생성되는 plan-local 값으로 state에 저장되지 않는다. 재개 시 다음 plan 노드가 새로 RAG를 수행한다. Execute 는 plan.json 의 modify/create 경로만 `read_file` 툴로 on-demand 조회한다.

## Split Injection

병렬 실행 시 태스크의 `packages` 필드에 따라 필요한 설계 문서만 주입한다:
- `packages = ['fe']` -> fe-system-design + api-contract
- `packages = ['be']` -> be-system-design + api-contract
- `packages = ['fe', 'be']` -> 전체 포함

plan 노드는 RAG 결과를 파일 경로 목록만 주입한다. 실제 파일 읽기는 execute `read_file` 도구로 수행한다.

## UI Design Document Consumption

Design Job이 생성한 UI 문서(ui-tokens.json, ui-assets.json, ui-spec.json)를 Code Job이 소비하는 메커니즘이다.

### 로딩

`resolve` 노드에서 `ArtifactService.loadParsedUiContext()`를 호출한다. `visual/ui/ant/` 디렉터리에서 세 파일을 읽어 `ParsedUiDocs` 구조로 파싱한다:

```typescript
interface ParsedUiDocs {
  tokens?: string;              // ui-tokens.json 전체 (문자열)
  tokensTokenEstimate?: number;
  assets?: string;              // ui-assets.json 전체 (문자열)
  assetsTokenEstimate?: number;
  specSections: Map<string, UiSpecSection>;  // ui-spec.json 논리 분할
  specToc: UiSpecTocEntry[];                 // 섹션 목차
  specTotalTokens: number;
}
```

### 섹션 분할

단일 `ui-spec.json` 파일을 `UiDocParser.parseJsonSections()`가 **메모리상에서** 논리적 섹션으로 분할한다. 디스크에 별도 파일을 만들지 않는다.

분할 규칙:
- `_meta` 키 제외
- 최상위 키의 값이 "컨테이너"(모든 자식이 비배열 객체)이면: 각 자식에 대해 `{parentKey}-{childKey}` 섹션 생성 (예: `pages-events`, `modals-connectModal`)
- 그 외 리프 객체는 키를 그대로 섹션 ID로 사용 (예: `layout`, `meta`)

### 태스크별 주입

`ArtifactPipeline`이 태스크별 문서 선택 + 컴팩션을 처리한다:

1. `buildCodeArtifactPool(state)` — 레거시 state 변수(`designDocs`, `specDocs`, `parsedUiDocs`, `sourceDocuments`, `prd`)를 `ResolvedArtifact[]` 풀로 변환
2. `resolveArtifacts(pool, { taskType, include }, { threshold })` — `task.include` 패턴 또는 taskType 기본 규칙으로 필터링 + 컴팩션

| task.type | 기본 선택 규칙 |
|-----------|---------------|
| `ui`, `design-system` | `visual/ui/ant/*` (ant UiSource 기준; figma/handoff 는 per-task `artifactPolicy` 가 직접 지정) |
| `feature`, `setup`, `test-code`, `doc` | `architecture/system/*` + `architecture/spec/*` + `visual/ui/*` + `plan` 전체 |
| `error` | spec + api-contract (spec 존재 시) |
| `verification` | 빈 배열 |

`task.include`가 지정되면 기본 규칙 대신 정확한 path-prefix 매칭이 적용된다. `include`는 decompose LLM이 출력하거나, `packages`/`uiSections` + RAC의 활성 spec ref(`ArtifactPoolView.activeSpecRefFilename()`)에서 자동 유도된다.

### Document Authority

- **ui-tokens.json**: SSOT — 시각적 값의 유일한 원천
- **ui-assets.json**: SSOT — 에셋 경로의 유일한 원천
- **ui-spec.json**: Primary — 레이아웃의 1차 참조. spec이 침묵하는 세부사항은 프레임워크 best practices 적용

### Post-RAC template flags (Gate / Contract / Background)

post-RAC 페이즈(decompose/plan/execute)의 템플릿은 **3-카테고리 flag**로 분기한다. 어떤 category를 쓸지는 "해당 블록의 copy가 무엇을 강제하는가?"로 판단한다 — artifact가 오늘 가진 role이 아니라.

| Category | Naming | 판단 기준 | 대표 use-site |
|---|---|---|---|
| **Gate** | `hasUi`, `hasSystemDesign`, `hasSpec`, `hasSources` | 블록이 ref/context 여부와 무관하게 동일하게 발동해야 함 | decompose의 `design-system` 태스크 생성 분기, plan의 TOKEN/ASSET/LAYOUT 인벤토리, execute의 visual-source hint |
| **Contract** | `hasUiRef`, `hasSystemDesignRef`, `hasSpecRef`, `hasSourcesRef` | 블록 copy가 "IMMUTABLE / MUST conform" 을 명시 | plan base의 "API Contract IMMUTABLE" (`hasSystemDesignRef`) |
| **Background** | `hasUiContext`, `hasSystemDesignContext`, … | 블록이 "참고 자료"로 명시 | 현재 use-site 없음 (헬퍼만 보존) |

**Gate-first 원칙**: 모호하면 Gate가 기본. Contract는 블록 copy가 명시적으로 "IMMUTABLE/MUST"를 쓸 때만.

왜 이렇게 해야 하는가? Intent matrix([`@ant/shared/action-config-matrix.ts`](../../packages/ant-shared/src/action-config-matrix.ts))는 같은 artifact kind에 intent별로 다른 role을 배정한다:

- `gen-code-sys`: UI=ref / SYS=ref
- `gen-code-spec`: UI=**context** / SYS=context (SPEC이 ref)
- `rev-code`: UI=**context** / SYS=context
- `rev-ui`: UI=ref

`hasUiRef`만으로 gating하면 `gen-code-spec`/`rev-code`에서 UI 가이드가 **침묵하는 회귀**가 발생한다. 토큰 인벤토리·design-system 태스크 사다리는 intent와 무관하게 "UI 문서가 있으면 활성" 이 옳은 semantics이므로 Gate(`hasUi`)로 갈라야 한다. 이 invariant은 [`tests/role-flag-intent-matrix.test.ts`](../../packages/ant-cli/tests/role-flag-intent-matrix.test.ts)가 런타임으로 보호한다.

규약·금지 사항 전체는 `.cursorrules`의 **Post-RAC Template Condition SSOT** 섹션 참조.

## Visual Source Authority

Code Job의 모든 시각 소스(UI Design Documents, Figma MCP)에 대한 우선순위와 충돌 해결 규칙은 `visual-source-authority.md` 단일 문서에 정의된다. 이 문서는 `ModeController`가 프론트엔드 프로젝트(`detectedEnv !== 'backend'`)에 대해 항상 주입한다(uiDoc 유무 무관).

## Figma MCP Supplementation

Code Job은 Figma Desktop MCP에 직접 연결하여 디자인 정보를 보충할 수 있다. Design Job의 MCP 연동과 동일한 인프라(`MCPTransport`, `FigmaMCPAdapter`)를 공유하지만, 사용 목적과 범위가 다르다.

### 가용성 감지 (resolve 노드)

2단계 감지:

1. **figma.json 검증**: `visual/ui/figma/figma.json` (canonical) 을 로드하고 `detectFigmaSource` 헬퍼가 `migrateFigmaConfig` → `isFigmaDataPopulated` → MCP 가용성까지 단일 경로로 판정
2. **MCP 연결 확인**: local은 `checkLocalMCPAvailability()`, cloud는 `BridgeMCPTransport.isAvailable()`

감지 결과는 `ArchitectGraphState`에 저장:
- `figmaAvailable: boolean` — MCP 연결 가능 여부
- `figmaFileKey: string` — Figma URL에서 추출한 file key
- `figmaStartNodeId?: string` — URL의 `node-id` 파라미터에서 추출한 시작 노드

`fileKey` 추출 실패 시 `figmaAvailable = false`로 설정하여 도구 호출 시 런타임 오류를 방지한다.

### 사용 가능 도구

| 도구 | 조건 |
|------|------|
| `figma_get_design_context` | 항상 (프론트엔드 태스크 + figmaAvailable) |
| `figma_get_screenshot` | 항상 (프론트엔드 태스크 + figmaAvailable) |
| `figma_get_variable_defs` | UI 문서 없을 때만 (Scenario C) |
| `figma_get_metadata` | `figmaStartNodeId` 없을 때만 (노드 탐색용) |

### fileKey 자동 주입

도구 스키마에서 `fileKey`를 제거(`removeFigmaFileKeyFromSchema`)하여 LLM이 제공하지 않도록 한다. tool handler가 `state.figmaFileKey`를 런타임에 자동 주입한다.

### 시나리오 매트릭스

| Scenario | UI Docs | Figma MCP | 전략 |
|----------|---------|-----------|------|
| A | O | O | UI docs primary, Figma supplements gaps |
| B | O | X | UI docs only |
| C | X | O | Figma primary — tokens, layout, screenshot 직접 조회 |
| D | X | X | Plan hints + framework best practices |

### On-demand 접근 (feature 태스크)

`feature` 태스크에서는 UI 문서를 eager injection하지 않고, LLM이 `read_file`로 필요한 시점에 조회한다. 프롬프트에 artifact 경로(`visual/ui/ant/ui-tokens.json` 등)를 안내한다.

### Redis 의존성 (Cloud mode)

Cloud mode에서 `BridgeMCPTransport`는 Redis Pub/Sub을 사용한다. `orchestrator.ts`에서 Code Job 전용 Redis 클라이언트를 생성하여 `deps.redis`로 전달하고, Job 완료 시 `quit()`한다.

## Verification 사이클 상세

Code job 의 verification 사이클(필드·리셋 규칙·gate·정책·snapshot·terminal·composeBundle 합성·불변식·안티패턴) 은 [17-code-verification-task.md](./17-code-verification-task.md) 가 SSOT. 본 문서에는 다음 high-level 만 남긴다:

- **책임 양극화**: verification = 진단 + fan-out, error = fix (위 `Error Diagnostics System` 섹션 참조).
- **Session SSOT**: 진단 상태는 `state.verification: VerificationSession` ([`tasks/_shared/verify/Session.ts`](../../packages/ant-cli/src/agents/architect/graph/code/tasks/_shared/verify/Session.ts)) 에 인캡슐.
- **gate 통과는 LLM `verifies` 선언 + exit 0** 이 SSOT (regex 명령 추론 폐지).
- **terminal 종료**는 `VerificationTerminalError` typed kind 4종 + `MAX_BATCH_SPLIT_CYCLES = 10` 하드캡 + orchestrator `_failedAttempts >= 2` + `recursionLimit` 로 보장.

> 새 verification 필드 추가, gate 추가, commandGuard 정책 변경, snapshot 필드 변경, terminal kind 추가 시 — 17-code-verification-task.md 의 책임 매트릭스 / 불변식 / 안티패턴 섹션을 먼저 갱신하고, 본 문서에는 cross-link 만 둔다.

## Codebase mutation gate

Code job 은 두 직교 권한을 phase 별로 다르게 갖는다:

- **`codebase/` 쓰기** (`allowMutateInCodebase`) — `execute` phase 만 정당. `plan` phase 는 sealed `<plan>` JSON 산출이 책임이며 source mutation 은 차단된다 (도구 핸들러 `allowMutateInCodebase = (state._activePhase === 'execute')`, FileRenderer `codePhase: 'plan' | 'execute'` 분기).
- **`run_command` shell 실행** (`allowShellExecution`) — `plan` 과 `execute` **양쪽 모두 허용**. plan tool-loop 는 verification 게이트 (build/typecheck/test), 테스트 러너 설치 (test-code), 에러 진단 (error), design-prescribed dep 설치 후 API discovery (default plan) 등 정상 사용처가 있다. wiring 은 `allowShellExecution: true` (always) — 이 플래그는 `allowMutateInCodebase` 와 직교 책임이며, plan 의 sealed-plan-only 산출 책임은 `allowMutateInCodebase = false` 만으로 충분히 강제된다.

정책 SSOT 와 다른 잡과의 매트릭스는 [15-design-job.md "Codebase mutation gate"](15-design-job.md#codebase-mutation-gate) 참고. 두 권한을 단일 플래그로 묶었던 이전 설계는 코드잡 verification plan 이 typecheck 게이트조차 못 돌리고 silent false-pass 하는 회귀 (`agile-nodding-pouch`) 를 만들었으며, 그 분리가 현 SSOT 다.

## 경계

- Verification task 책임/불변식/안티패턴 (SSOT): [17-code-verification-task.md](17-code-verification-task.md)
- 에이전트 공통 패턴: [11-agent-architecture.md](11-agent-architecture.md)
- Job 실행/중단/재개: [10-job-lifecycle.md](10-job-lifecycle.md)
- Tool 시스템 (도구 카탈로그, 레지스트리, CodeCommandPolicy): [19-tool-system.md](19-tool-system.md)
- Design Job: [15-design-job.md](15-design-job.md)
- Design 파이프라인 상세 (UI + Game-Art): [25-design-pipeline.md](25-design-pipeline.md)
- 문서 제약 맵(시스템설계/스펙/PRD): [36-prompt-document-constraint-map.md](36-prompt-document-constraint-map.md)
