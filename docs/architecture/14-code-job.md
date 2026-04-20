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
UI BasisSelector → ActionMetadata.basis → detect → RAC.basis.techTier (preset)
                                                       ↓
                                             decompose prompt에 주입
                                                       ↓
                                        LLM이 preset 필드 보존 + 빈 필드 추론
                                                       ↓
                                           mergeTechTier(preset, inferred)
                                                       ↓
                                              RAC.basis.techTier (final)
```

사용자가 UI에서 techTier preset을 설정한 경우(`gen-code-directive` 인텐트의 BasisSelector), decompose 프롬프트에 사전 결정 필드가 주입되어 LLM이 해당 값을 그대로 사용한다. 미설정 필드만 추론한다.

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

- `error` 태스크: 검증 실패 시 오류를 파일별로 분리하여 독립 태스크로 재분해 (batch split)
- `verification` 태스크: `VerificationTracker`가 build/test objective 완료를 추적. 모든 목표가 충족될 때까지 `checkTaskStatus -> enforce -> plan` 루프를 반복한다
- `test-code` 태스크: 모든 feature 태스크 완료 후 테스트 코드 생성

batch split은 단일 검증 실패를 여러 독립 error 태스크로 쪼개어 병렬 처리를 가능하게 한다. 분할된 태스크는 taskQueue에 삽입되고 `plan` 노드로 재진입한다.

## Cache Invalidation Scope

편집된 파일의 영향 범위에 따라 `VerificationTracker`를 선택적으로 무효화한다. `decideInvalidationScope()` (`agents/common/tool/handlers/invalidationScope.ts`)가 경로와 diff를 관찰해 scope를 결정하고, `tool` 노드의 `verificationInvalidated` side effect 처리기가 해당 scope만 tracker에서 떨어뜨린다.

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

런타임 측면에서 `codeCommandPolicy`는 tracker의 `*Passed`를 독립 조건으로 먼저 관찰하기 때문에, invalidation이 실제로 `*Passed=false`로 떨어뜨리지 않는 한 retry/reverify 경계를 넘어서도 이미 통과한 gate의 재실행을 `ALREADY PASSED`로 결정론적으로 차단한다. 이는 프롬프트의 stochastic hint(`cachedPassedSteps`)에 의존하지 않고 관찰 가능한 tracker 상태를 SSOT로 삼는 FPOP Constraints-over-Instructions 원칙의 적용이다.

## State 복원

runner.ts는 graph invoke 이전에 세션을 로드하여 state를 복원한다:
- taskQueue, completedTasks, completedTasksDetails
- resolvedAction (basis.techTier 포함)
- referenceRequests, projectCodeContext (경로만)
- planText, conversationHistory
- directive, overrideDirective, chatSource
- jobTiming, tokenUsage, recursionCount

## Split Injection

병렬 실행 시 태스크의 `packages` 필드에 따라 필요한 설계 문서만 주입한다:
- `packages = ['fe']` -> fe-system-design + api-contract
- `packages = ['be']` -> be-system-design + api-contract
- `packages = ['fe', 'be']` -> 전체 포함

plan 노드는 RAG 결과를 파일 경로 목록만 주입한다. 실제 파일 읽기는 execute `read_file` 도구로 수행한다.

## UI Design Document Consumption

Design Job이 생성한 UI 문서(ui-tokens.json, ui-assets.json, ui-spec.json)를 Code Job이 소비하는 메커니즘이다.

### 로딩

`resolve` 노드에서 `ArtifactService.loadParsedUiContext()`를 호출한다. `outputs/design/` 디렉터리에서 세 파일을 읽어 `ParsedUiDocs` 구조로 파싱한다:

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
| `ui`, `design-system` | `outputs/design/ui/*` |
| `feature`, `setup`, `test-code`, `doc` | `outputs/design/*` + `inputs/sources` 전체 |
| `error` | spec + api-contract (spec 존재 시) |
| `verification` | 빈 배열 |

`task.include`가 지정되면 기본 규칙 대신 정확한 path-prefix 매칭이 적용된다. `include`는 decompose LLM이 출력하거나, `packages`/`uiSections`/`selectedSpec`에서 자동 유도된다.

### Document Authority

- **ui-tokens.json**: SSOT — 시각적 값의 유일한 원천
- **ui-assets.json**: SSOT — 에셋 경로의 유일한 원천
- **ui-spec.json**: Primary — 레이아웃의 1차 참조. spec이 침묵하는 세부사항은 프레임워크 best practices 적용

### hasUiDoc 플래그

`parsedUiDocs`가 존재하면 `hasUiDoc = true`가 `buildMessages.ts`에서 artifacts에 설정되어, execute 프롬프트에서 `{{#if hasUiDoc}}` 분기로 UI 관련 가이드를 조건부 주입한다.

## Visual Source Authority

Code Job의 모든 시각 소스(UI Design Documents, Figma MCP)에 대한 우선순위와 충돌 해결 규칙은 `visual-source-authority.md` 단일 문서에 정의된다. 이 문서는 `ModeController`가 프론트엔드 프로젝트(`detectedEnv !== 'backend'`)에 대해 항상 주입한다(uiDoc 유무 무관).

## Figma MCP Supplementation

Code Job은 Figma Desktop MCP에 직접 연결하여 디자인 정보를 보충할 수 있다. Design Job의 MCP 연동과 동일한 인프라(`MCPTransport`, `FigmaMCPAdapter`)를 공유하지만, 사용 목적과 범위가 다르다.

### 가용성 감지 (resolve 노드)

2단계 감지:

1. **figma.json 검증**: `inputs/figma.json`을 로드하고 `isFigmaDataPopulated()`로 유효성 확인
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

`feature` 태스크에서는 UI 문서를 eager injection하지 않고, LLM이 `read_file`로 필요한 시점에 조회한다. 프롬프트에 artifact 경로(`outputs/design/ui-tokens.json` 등)를 안내한다.

### Redis 의존성 (Cloud mode)

Cloud mode에서 `BridgeMCPTransport`는 Redis Pub/Sub을 사용한다. `orchestrator.ts`에서 Code Job 전용 Redis 클라이언트를 생성하여 `deps.redis`로 전달하고, Job 완료 시 `quit()`한다.

## Axis A~G: 필드·리셋 규칙·테스트 커버리지

Code job의 verification 사이클은 7개 축(Axis A–G)으로 분해된다. 각 축은 **상태 필드**(state 저장), **리셋 규칙**(언제 초기화되는가), **테스트 커버리지**(어느 L1/L2 시나리오가 불변식을 묶는가)로 정의된다. 새 필드 추가·기존 필드 의미 변경 시 반드시 이 표를 갱신한다.

### 요약 매트릭스

| Axis | 책임 | 필드 | 리셋 시점 | L1/L2 커버리지 |
|------|------|------|----------|----------------|
| **A** — Install invalidation | dep-hash 기반 install skip/force 판정 | `_installNeeded`, `_depFileHash` | verification plan 진입, retry/reverify | S10 (dep-manifest-surgical), `invalidationScope.test.ts` |
| **B** — Verification completion SSOT | `<done>` + tracker 동시 체크 | `_verificationTracker.{buildPassed,testPassed,typecheckPassed, *Required, *Attempted}` | reverify 시 `*Attempted`만 리셋 · 수정 범위 invalidation 시 `*Passed` flip | S01, S03, S06, S08, `isVerificationComplete.test.ts` |
| **C** — Cached-passed step hint | 이미 통과한 gate는 프롬프트에 명시 | `formatCachedPassedSteps(tracker)` | tracker `*Passed` 변동에 파생 | (Phase 3-16 파생화 후) golden snapshot |
| **D** — Retry summary & plan history | 직전 attempt 요약 → violationsText 경유 주입 | `_appliedPlanHistory`, `retrySummaryText` (런타임) | retry/reverify 진입마다 `retrySummaryText` 새로 렌더 · history는 reverify 시 append | `summarizeForRetry.test.ts`, F3c 로그 검증 |
| **E** — Verification budget | retry·reverify 누적 한도 | `_verificationBudget`, `_diagnosticAttempts`, `_deepDiagnosticBudgetGranted`, `_lastPlanHash` | retry/reverify 진입 시 `consumeVerificationBudget` 1 감소 · fresh task 시 env 기반 시드 | S05 (budget-exhausted), `processDiagnosticBatchSplit.test.ts` |
| **F** — Batch split / force escalation | LLM 단일 plan 고집 시 safety valve | `_batchSplitCount`, `_lastPlanHash` | 각 plan 진입마다 재계산 | S02, S04, `batch-split-fix.test.ts` |
| **G** — Deep-diagnostic escalation | 2회 이상 재진입 시 config 주입 | `_diagnosticAttempts`, `_deepDiagnosticBudgetGranted` | fresh task 시드 · retry/reverify에서 `maybeGrantDeepDiagnosticBudget` | `deepDiagnosticConfig.test.ts` |

### STEP 0 entry 분기별 리셋 필드 (Phase 2-9)

`resolvePlanEntry`는 4개의 핸들러로 분기한다. 각 분기가 건드리는 필드를 아래 표로 고정한다.

| 필드 | inToolLoop | retry | reverify | fresh |
|------|:---:|:---:|:---:|:---:|
| `state.retries` | 보존 | 보존 (maxRetries 검사) | 미조작 | 0 (scenario env 시 보존) |
| `_executeCallIndex` | 보존 | 0 | 0 | 0 |
| `_finalTaskLoopCount` | 보존 | 0 (비verification) / 보존 (verification) | 보존 | 0 (신규 task) |
| `_verificationTracker` | 보존 | `*Attempted` 3개만 false, 그 외 보존 | `*Attempted` false · `*Passed`/`*Required`는 prev 보존 | 신규 task 시 fresh seed (verification만) |
| `state.conversations[NODE_PLAN/EXECUTE]` | 보존 | 클리어 | 클리어 | 미조작 |
| `state.violations` | 보존 | 클리어 (summary로 흡수) | 클리어 | 미조작 |
| `_installNeeded` | 보존 | `recomputeInstallNeeded` | `recomputeInstallNeeded({detectPmIfMissing:true})` | verification task 시 `recomputeInstallNeeded({detectPmIfMissing:true})` |
| `_appliedPlanHistory` | 보존 | 보존 | `planText` push | 신규 task 시 `[]` 초기화 |
| `_verificationBudget` | 보존 | `consumeVerificationBudget` (verification 한정) | `consumeVerificationBudget` | fresh task 시 env 시드 · resume 시 보존 |
| `_diagnosticAttempts` | 보존 | `maybeGrantDeepDiagnosticBudget` | 동일 | fresh task 시 0 |
| `_lastPlanHash` | 보존 | 미조작 (STEP 2의 batch split이 갱신) | 동일 | fresh task 시 보존 (resume) |
| `retrySummaryText` (반환값) | `undefined` | `renderRetrySummary(...)` | `undefined` | `undefined` |
| `skipKeywordAndRAG` (반환값) | `false` | `false` | `true` | `false` |

### 불변식 (Phase 2-9 이후)

1. `preservedRetries`는 `inToolLoop ∨ isRetry ∨ ANT_SCENARIO_PRESERVE_RETRIES=1`일 때만 `state.retries` 유지 — 그 외엔 0.
2. retry/reverify 진입에서 `state.violations`를 클리어하기 **전에** `retrySummaryText` 렌더가 완료되어야 함 (STEP 3 `composeViolationsText` 단일 경로).
3. `recomputeInstallNeeded` 호출 조건은 분기별로 다르다 (retry 한정 ≠ reverify의 `detectPmIfMissing` ≠ fresh의 verification 전용) — 네 분기를 하나로 합치면 회귀.
4. `_verificationTracker.testsRequired`, `typecheckRequired`는 fresh task 시점에 한 번 결정되어 이후 상태 변화로 변경되지 않는다.

## 경계

- 에이전트 공통 패턴: [11-agent-architecture.md](11-agent-architecture.md)
- Job 실행/중단/재개: [10-job-lifecycle.md](10-job-lifecycle.md)
- Tool 시스템 (도구 카탈로그, 레지스트리, CodeCommandPolicy): [19-tool-system.md](19-tool-system.md)
- Design Job: [15-design-job.md](15-design-job.md)
- UI Design 파이프라인 상세: [25-ui-design-pipeline.md](25-ui-design-pipeline.md)
