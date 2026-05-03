# Design Job

## 개요

Design Job은 사용자의 directive를 받아 설계 문서를 생성하는 architect 에이전트의 LangGraph 그래프이다. Code Job과 동일한 resume 아키텍처를 공유하되, 코드 생성 대신 문서 생성(docGen)을 수행한다.

## Code Job과의 차이

| 항목 | Code Job | Design Job |
|------|----------|------------|
| 실행 노드 | plan -> execute -> tool | plan -> docGen -> tool |
| plan 역할 | LLM+tools 로 planText 생성 (5단계 entry/shortcut/RAG/llm/outcome) | LLM+tools 로 sealed `<plan>` 생성 (lean per-doc; intentGroup ∈ {design-spec, design-system-design} 만 적용. ui-design / game-art-design 은 dispatcher-only fallback) |
| 검증 루프 | enforce -> plan (violations) | 없음 |
| 태스크 타입 | setup, feature, testgen, error, verification | doc |
| 출력물 | 소스 코드 파일 | 설계 문서 (MD, JSON) |
| 고유 속성 | - | workType, documentType |
| 공유 헬퍼 | `agents/common/graph/nodes/plan/` 의 `runPlanWithTools` / `runPlanToolLoopPhase` / `extractPlanText` / `PLAN_TOOL_LOOP_MAX` 를 두 job 모두 사용. 노드 본체는 각자 별도 구현 (구조 차이가 큼 — adapter/strategy 인터페이스는 만들지 않음) | 동일 |

## workType

`detect`에서 결정되며 문서 생성 전략을 결정한다.

| workType | 조건 | 출력 파일 |
|----------|------|----------|
| `system-design` | PRD/directive만 있고 UI 입력 없음 | system-design.md, api-contract.md 등 |
| `ui-design` | `visual/ui/figma/figma.json` populated **또는** description 디렉티브 | `visual/ui/ant/{ui-tokens,ui-assets,ui-spec}.json` |
| `spec` | spec 모드로 명시적 지정 시 | spec 문서 |

## UI Design Pipeline Mode (Intent-Based)

`ui-design` workType의 파이프라인 모드는 `resolvedAction.intent`로 결정된다. `isFigmaPipeline(intent, figmaPopulated)` 헬퍼가 분기 판정을 담당한다.

| Intent | 조건 | 방법론 | 도구 세트 |
|--------|------|--------|----------|
| `gen-ui-figma` | `visual/ui/figma/figma.json` populated + MCP 가용 | Figma MCP 구조적 데이터 추출 → `visual/ui/ant/ui-*.json` 로 산출 | `TOOL_SETS.uiDesignFigma` |
| `gen-ui-desc` | 디렉티브 + PRD | 텍스트 설명을 기반으로 직접 UI 문서 작성 | `TOOL_SETS.uiDesign` |
| `rev-ui` | 기존 UI 문서 수정 | by-desc 변종 (디렉티브) — Figma 미선택 모드 공통 진입점 | `TOOL_SETS.uiDesign` |

Figma intent(`gen-ui-figma`)가 합성되면 description 변종이 무시된다. 자유 형식 시각 자료(html/css/png)가 필요하면 `visual/ui/handoff/` 로 직접 배치하여 코드 잡 멀티모달 채널이 사용한다 (handoff 는 design-job 디컴포즈 입력이 아니라 코드 잡의 추가 컨텍스트). 상세 파이프라인은 [25-design-pipeline.md](25-design-pipeline.md) 참조.

## documentType (System Design)

decompose가 프로젝트 환경 + LLM이 emit한 두 직교 필드 (`services` provider, `consumedApis` consumer)에 따라 문서 구조를 결정한다.

| environment | services | consumedApis | documentType | 출력 |
|---|---|---|---|---|
| frontend | empty | empty | `unified` | `fe-system-main.md` |
| frontend | empty | non-empty | `contract-first` | `fe-system-main.md` + `api-contract-{c}.md` per consumer |
| backend | empty | empty | `unified` | `be-system-main.md` |
| backend | non-empty | any | `contract-first` / `msa-contract-first` | `be-system-{s}.md` + `api-contract-{s}.md` per service (+ `api-contract-{c}.md` per consumer) |
| fullstack | empty | empty | `contract-first` | `api-contract-main.md` + `fe-system-main.md` + `be-system-main.md` |
| fullstack | non-empty | any | `msa-contract-first` | `fe-system-main.md` + `api-contract-{s}.md` + `be-system-{s}.md` per service (+ `api-contract-{c}.md` per consumer) |

**필드 의미 (provider ⊥ consumer)**:

- `services` (provider) — 본 프로젝트가 owning하는 백엔드 서비스 경계. 각 entry당 `be-system-{s}.md` + `api-contract-{s}.md` 페어 생성. `gen-sys-fe`에서는 무시.
- `consumedApis` (consumer) — 본 프로젝트가 외부에서 소비하는 API 호스트 (CONSUMER snapshot). 각 entry당 `api-contract-{c}.md`만 생성 (be-system 동반 안 함). 모든 system-design intent에서 의미 있음.
- `services ∩ consumedApis` — 동명 충돌 시 provider 우세, consumer entry drop + 경고.
- 다운스트림 코드 잡은 `api-contract-*.md`를 와일드카드로 모두 ref에 포함하므로 provider/consumer 구분은 디컴포즈 단계의 prompt-side 의미에 한정 (`api-contract-guide.md`의 `External Contract Discovery` 가 두 케이스 모두를 다룸).

## 그래프 노드 흐름

### 순차 실행 (ANT_TASK_CONCURRENCY = 1)

```
__start__ -> resolve -> [4-way router]
    +-> triage -> detect -> [intent router]
         +-> isFigmaPipeline(intent): figmaExplore -> decompose
         +-> otherwise: decompose
    +-> revise -> plan
    +-> plan (직행)
    +-> decompose (detectEnv 이후 중단 resume)

plan -> [router]
    +-> tool (plan↔tool 도구 루프, _activePhase='plan' + tool_use 있음)
    +-> docGen (sealed <plan> 또는 dispatchOnly fallthrough)

docGen -> [router]
    +-> tool -> [router]  (도구 호출 루프, _activePhase 미설정)
    +-> checkTaskStatus (done=true)
    +-> docGen (retry, done=false)

tool -> [router]  (_activePhase 로 분기)
    +-> plan (_activePhase='plan' → plan↔tool 루프)
    +-> docGen (그 외 → docGen↔tool 루프)

checkTaskStatus -> [router]
    +-> plan (다음 태스크)
    +-> learn -> __end__
```

### figmaExplore 노드

Figma 모드 전용 노드. `detect` 이후, `decompose` 이전에 실행된다. LLM 호출 없이 프로그래밍적으로 Figma MCP 어댑터를 직접 호출하여 디자인 구조를 탐색하고 매트릭스(Variation, Component State)와 nodeSummary를 생성한다. 결과는 `state.figmaExplorationResult`에 저장되며 이후 decompose와 docGen에서 참조한다. 상세 알고리즘은 [25-design-pipeline.md](25-design-pipeline.md) 참조.

### 병렬 실행 (ANT_TASK_CONCURRENCY > 1)

decompose 이후 `parallelOrchestrator` 노드로 분기한다. Code Job과 동일한 TaskOrchestrator/TaskWorker 패턴을 사용한다.

```
decompose -> parallelOrchestrator -> learn -> __end__
```

Worker Subgraph는 `DesignGraphChannels`를 spread하여 메인 그래프와 채널을 동기화한다. 새 채널 추가 시 `DesignGraphChannels`(`graph.ts`)에만 추가하면 Worker에 자동 반영된다. 상세: [11-agent-architecture.md](11-agent-architecture.md) "Worker Subgraph 채널 정의" 참조.

## 주요 노드 특성

### plan

intentGroup 분기로 두 동작을 가진다:

- **`design-spec` / `design-system-design`**: LLM+tools 의 lean plan↔tool 루프를 실행해 `<plan>{...}</plan>` JSON 을 생성한다. plan 결과는 `state.planText` 로 sealed 되어 docGen 의 `runtimeContext` 상단 (`# Sealed Plan (from plan node)`) 에 주입된다. 도구 셋은 read-only 의 `TOOL_SETS.designPlanExplore` (Figma 활성화 시 `designPlanFigma`) — file-write / download_asset 은 노출하지 않는다 (작성·다운로드는 docGen 의 책임).
- **`design-ui` / `design-game-art`**: 기존 dispatcher-only 동작 유지. taskQueue 에서 pop, currentTask 설정, kanban / workflow / task_start 로그만 처리하고 즉시 docGen 으로 라우팅한다. 향후 `variants/{ui-design,game-art-design}/` 프롬프트가 추가되면 진입 가드만 풀고 LLM+tools 흐름에 합류 가능.

re-entry 분기: `state._activePhase === 'plan' && NODE_PLAN.length > 0` 이면 plan↔tool 루프 한 라운드를 실행한다. 라운드 ceiling 은 공유 상수 `PLAN_TOOL_LOOP_MAX = 15`; 초과 시 `finalizeFromExploration` 으로 가드 합성된 `<plan>` 을 강제로 받아낸다.

공유 헬퍼 (`agents/common/graph/nodes/plan/`) 를 사용한다. code 와 동일한 stream / `<plan>` 추출 / over-limit 합성 로직을 함수형 utilities 로만 공유 — adapter/strategy 인터페이스는 의도적으로 두지 않음 (구조 차이가 큼; 자세한 정책은 해당 디렉토리 README 와 [NODE_GRAPH_LAYOUT.md](./NODE_GRAPH_LAYOUT.md) §2).

### docGen

XML 스트리밍 방식으로 설계 문서를 생성한다. `conversationHistory` 기반 멀티턴 대화로 tool calling을 포함한다. 완료 판단은 LLM이 `<done>true</done>`을 출력하는 시점이다. `done=false`면 자기 자신으로 재진입하여 LLM 응답을 이어간다. 파일은 즉시 디스크에 기록한다.

### decompose

system-design은 LLM 기반 태스크 분해(documentType + targetFiles + profiles)를 수행한다. ui-design은 LLM 기반 UI 복잡도 분석 후 태스크를 분해한다. explain 모드는 단일 explain 태스크를 생성한다(LLM 호출 없음).

#### TechTier 설정

Design Job의 3개 decompose 함수 모두 RAC.basis.techTier를 설정한다 (`getTechTier(state)` 경유). Code Job과 달리 Design Job은 graph-level TechTier와 per-task TechTier를 분리한다.

| workType | graph-level TechTier | per-task TechTier |
|---|---|---|
| system-design | `profiles` 맵의 대표 프로필 + intent에서 파생한 stack | `resolveTaskTechTier()`: targetFile → profiles 맵 lookup → `buildTechTier()` |
| ui-design | `state.profile` + stack=`frontend` (항상) | 없음 (단일 tier) |
| spec | `state.profile` + intent에서 파생한 stack | 없음 |

**system-design의 profiles 맵**: LLM이 decompose 응답에서 `profiles` 필드를 JSON으로 출력한다. 키는 `{tier}-{name}` 형식(`be-main`, `fe-main`, `be-auth` 등)이며 값은 `{ language, framework }`. 이 맵은 `resolveTaskTechTier()`에서 각 DesignTask의 `targetFile` → 태그 → profiles 2단계 lookup으로 per-task `techTier`를 빌드한다.

**per-task TechTier 소비**: `ModeController.detectFrameworkAugmentation()`과 `systemDesignPrompt.detectUsedTemplates()`가 `currentTask.techTier`를 참조하여 프레임워크 augmentation(nextjs, go-api)을 결정론적으로 주입한다.

## UI Design 문서 의존 체인

UI 문서는 챕터 기반으로 생성된다. tokens와 assets는 병렬 실행되며, spec만 양쪽에 의존한다.

```
ui-tokens.json (의존 없음)
ui-assets.json (의존 없음, tokens와 병렬)
    -> ui-spec.json (ui-tokens + ui-assets 참조)
```

각 챕터 태스크는 자신의 범위만 생성한다. `lastSectionNumber`로 이전 섹션 번호를 추적하고, JSON `_meta.lastSection`으로 마지막 섹션을 기록한다. 이어쓰기 시 전체 파일을 프롬프트에 넣지 않고 `previousChaptersSummary`(키 이름 목록)만 주입하며, LLM이 필요하면 `read_file`로 드릴링한다.

## State 복원

runner.ts는 graph invoke 이전에 세션을 로드하여 state를 복원한다:
- taskQueue, completedTasks, completedTasksDetails
- resolvedAction (basis.techTier 포함)
- figmaConfig, figmaExplorationResult, figmaAvailable, figmaFileKey, figmaStartNodeId
- planText, conversationHistory
- directive, overrideDirective, chatSource
- jobTiming, tokenUsage

## Plan Observability

### planText 라이프사이클

| 단계 | 위치 | state.planText |
|---|---|---|
| 진입 | `plan/index.ts` (fresh entry) | 빈 문자열 또는 이전 task 잔존값 (다음 단계에서 reset) |
| `<plan>` emit | `plan/finalizeOutcome.ts:finalizePlanOutcome` | `outcome.planText` 로 set |
| docGen 주입 | `docGen/intent/spec.ts:75-79` / `docGen/intent/system.ts:375-379` | runtimeContext 상단에 `# Sealed Plan (from plan node)` 으로 prepend |
| task 완료 | `graph.ts:checkTaskStatus` (sequential) / `parallel/workerGraph.ts:189-193` (parallel) | `''` 로 reset (다음 task 의 fresh planning 보장) |
| session resume | `runner.ts:113-115` | 세션 파일에서 복원 (task 진행 중 재개 시 docGen으로 직행) |

session 파일(`sessions/architect/design.json`)의 final state 에서 `planText: ""` 이 보이는 것은 **마지막 task 가 완료되어 reset 된 후 직렬화된 정상 상태**다. 진행 중 snapshot(checkpoint)에는 sealed plan 이 들어있다.

### 로그 파일 매핑

`{featurePath}/sessions/debug/` 하위 파일별 책임:

| 파일 | 작성자 | 내용 |
|---|---|---|
| `plans/plan-{jobId}.json` | `plan/finalizeOutcome.ts:savePlanForDebug` | task 별 sealed `<plan>` JSON 본문 (배열로 누적) |
| `prompts/prompt-{jobId}.json` | `core/utils/promptLogger.ts:logPrompt` | docGen 프롬프트 빌드 시점 메타데이터 — `injectedVariables.planText` 가 sealed plan 주입 여부를 길이로 표시 |
| `logs/log-{jobId}.json` | `core/utils/executionLogger.ts:logPhaseComplete` | 구조화 phase 이벤트 (아래 표) |
| `chat.jsonl` (workspace 루트) | `core/streaming/strategies/CommonRenderStrategy.ts` | 사용자 가시 SSE 이벤트 — `statusType: "plan"` 카드가 `<plan>` JSON 본문을 그대로 운반 |

### Phase 이벤트 (`log-{jobId}.json`)

`logPhaseComplete({ phase, elapsedMs, details })` 로 emit. design plan 단계에서 발생하는 3종:

| `phase` | 발생 조건 | `details` 주요 필드 |
|---|---|---|
| `design-plan-sealed` | `intentGroup ∈ {design-spec, design-system-design}` 에서 `<plan>` 추출 성공 | `taskId`, `intentGroup`, `origin` (`tool-loop` / `over-limit`), `planTextLen`, `planParsed`, `candidatesCount`, `decisionSelected`, `outlineSectionCount` |
| `design-plan-fallthrough` | plan 루프가 ceiling 도달 + `finalizeFromExploration` 도 빈 응답 → docGen 으로 빈 planText 진입 | `taskId`, `intentGroup`, `reason`, `nodePlanHistoryLen`, `recursionCount` |
| `design-plan-dispatch-only` | `intentGroup ∈ {design-ui, design-game-art}` 에서 plan-LLM 건너뜀 (`dispatchOnly` 경로) | `taskId`, `intentGroup`, `reason: 'intent-group-not-plan-llm-enabled'` |

### 진단 워크플로우

새로운 design job 트레이스를 분석할 때 권장 순서:

1. **`logs/log-{jobId}.json` grep `design-plan-`** — plan 단계의 결과(sealed / fallthrough / dispatch-only)와 candidate 수를 한 줄로 확인.
2. **`plans/plan-{jobId}.json`** — sealed 된 경우 실제 JSON 내용으로 candidate 비교 / decision rationale 확인.
3. **`prompts/prompt-{jobId}.json` 의 `docGen-spec` 또는 `docGen-systemDesign` 항목** — `injectedVariables.planText` 가 1번에서 본 길이와 일치하는지 검증 (plan→docGen 핸드오프 무결성).
4. **`chat.jsonl`** — 사용자 관점에서 thinking → `statusType: "plan"` → file_create 의 시간 분배 확인.

`plan→docGen` 핸드오프가 깨졌다는 가설이 있으면 1·3을 우선 비교한다 (1의 `planTextLen` 과 3의 `planText` 길이 표시가 동일해야 함).

## Codebase mutation gate

Design 잡의 산출물은 `architecture/`, `plan/`, `assets/`, `visual/`, `meta/`, `sessions/` 등 **아티팩트 경로**의 문서다. `codebase/` 산하 소스 코드 mutation 은 **architect/code 잡 `execute` phase 만**의 책임이다.

| 잡 / phase | `codebase/` mutate | 아티팩트 mutate | 강제 위치 |
|---|---|---|---|
| architect/design — plan / docGen | 차단 | 허용 | `ToolExecutionContext.allowMutateInCodebase = false` ([tool/index.ts](../../packages/ant-cli/src/agents/architect/graph/design/nodes/tool/index.ts) buildContext) + FileRenderer XML 가드 (`jobType: 'design'`) |
| architect/code — plan | 차단 | 허용 | `allowMutateInCodebase = false` (`_activePhase === 'plan'` 분기) + FileRenderer (`codePhase: 'plan'`) |
| architect/code — execute | 허용 | 허용 | `allowMutateInCodebase = true` (`_activePhase === 'execute'`) + FileRenderer 기존 가드 |
| planner — plan (PRD/계획) | 차단 | 허용 | planner 도구 ([planner/graph/plan/nodes/tools.ts](../../packages/ant-cli/src/agents/planner/graph/plan/nodes/tools.ts) `isCodebasePathArg` 가드) + FileRenderer (`jobType: 'planner'`) |

차단 매커니즘은 두 축으로 동시 작동한다:

1. **도구 핸들러** ([codebaseGate.ts](../../packages/ant-cli/src/agents/common/tool/handlers/codebaseGate.ts)) — `edit_file` / `delete_file` / `mkdir` / `create_file` 가 resolve 된 path 가 `codebase/` 산하면 거부. `run_command` 는 path 추론이 어려워 도구 자체를 거부.
2. **FileRenderer XML 태그** ([FileRenderer.ts](../../packages/ant-cli/src/core/streaming/strategies/common/FileRenderer.ts) processFile) — `<file>` / `<append>` / `<edit>` / `<delete>` artifact 태그가 `codebase/` 를 가리키면 거부. design / planner / code-plan 모두 동일 정책.

거부 메시지는 LLM 에게 회복 경로를 안내한다 — 아티팩트 경로 사용 또는 spec/plan 문서에 변경 내용을 기술하라는 형태로, "You MUST" 훈계 없는 FPOP 친화적 톤. 차단된 시도는 다음 turn 에서 R5 self-check 와 결합되어 자연스럽게 task 완료(`<done>true</done>`)로 수렴한다.

## R5 — artifact-mutation-then-no-done self-check

docGen 종료 트리거 (`<done>true</done>`) 는 LLM 출력에 의존한다. sealed plan 의 `decision` 이 처방형(예: "rename X to Y")이면 모델이 task 완료 조건을 "decision 실행" 으로 오해할 수 있고, 그 결과 done 을 미출력한 채 codebase 변경을 시도하다 R1/R6 가드에 차단되는 무한 루프 위험이 있다.

이를 자율적으로 끊기 위해 docGen 노드는 turn 종료부에서:

1. **artifact-mutation-intent 검출**: 이번 turn 에 (a) `<file>`/`<append>`/`<edit>`/`<delete>` 가 아티팩트 경로에서 성공했거나, (b) `edit_file`/`delete_file`/`create_file`/`mkdir` pending tool call 이 아티팩트 경로를 가리키면 mutation 의도로 판정. 자세한 truth table 은 [docgen-mutation-intent-detector.test.ts](../../packages/ant-cli/tests/design/docgen-mutation-intent-detector.test.ts) 가 SSOT.
2. **`<done>` 미출력 시 플래그 세팅**: `state._pendingDoneCheck = true`, `_doneCheckEscalation` 카운트 증가. 둘은 [graph.ts](../../packages/ant-cli/src/agents/architect/graph/design/graph.ts) `DesignGraphChannels` 의 정식 채널.
3. **다음 turn trailing message 변경**: [selfCheck.ts](../../packages/ant-cli/src/agents/architect/graph/design/nodes/docGen/intent/selfCheck.ts) 의 `buildSelfCheckTrailingMessage` 가 escalation 단계별로 자가 점검 문구 (1차: 부드러운 결정 요청 / 2차: 동일 의미의 firmer 톤) 를 반환. spec / system-design 두 변형이 공유.

자가 점검 메시지는 **task scope 결정만** 묻고, codebase 차단 안내는 R1/R6 거부 메시지가 별도로 제공한다 (MECE). FPOP 준수 — 도구명 나열 / "You MUST" / 시스템 동작 설명 없음.

## 경계

- 에이전트 공통 패턴: [11-agent-architecture.md](11-agent-architecture.md)
- Tool 시스템 (도구 카탈로그, 레지스트리, 오케스트레이터): [19-tool-system.md](19-tool-system.md)
- Code Job: [14-code-job.md](14-code-job.md)
- 프롬프트 템플릿: [13-prompt-system.md](13-prompt-system.md)
- Design 파이프라인 상세 (UI + Game-Art): [25-design-pipeline.md](25-design-pipeline.md)
- 문서 제약 맵(시스템설계/스펙/PRD): [36-prompt-document-constraint-map.md](36-prompt-document-constraint-map.md)
