# Design Job

## 개요

Design Job은 사용자의 directive를 받아 설계 문서를 생성하는 architect 에이전트의 LangGraph 그래프이다. Code Job과 동일한 resume 아키텍처를 공유하되, 코드 생성 대신 문서 생성(docGen)을 수행한다.

## Code Job과의 차이

| 항목 | Code Job | Design Job |
|------|----------|------------|
| 실행 노드 | plan -> execute -> tool | plan -> docGen -> tool |
| plan 역할 | LLM으로 planText 생성 | taskQueue 관리만 (LLM 호출 없음) |
| 검증 루프 | enforce -> plan (violations) | 없음 |
| 태스크 타입 | setup, feature, testgen, error, verification | doc |
| 출력물 | 소스 코드 파일 | 설계 문서 (MD, JSON) |
| 고유 속성 | - | workType, documentType |

## workType

`detect`에서 결정되며 문서 생성 전략을 결정한다.

| workType | 조건 | 출력 파일 |
|----------|------|----------|
| `system-design` | PRD/directive만 있고 UI 입력 없음 | system-design.md, api-contract.md 등 |
| `ui-design` | `outputs/design/ui/figma/figma.json` populated **또는** `inputs/references/` 존재 | `outputs/design/ui/ant/{ui-tokens,ui-assets,ui-spec}.json` |
| `spec` | spec 모드로 명시적 지정 시 | spec 문서 |

## UI Design Pipeline Mode (Intent-Based)

`ui-design` workType의 파이프라인 모드는 `resolvedAction.intent`로 결정된다. `isFigmaPipeline(intent, figmaPopulated)` 헬퍼가 분기 판정을 담당한다.

| Intent | 조건 | 방법론 | 도구 세트 |
|--------|------|--------|----------|
| `gen-ui-figma` | `outputs/design/ui/figma/figma.json` populated + MCP 가용 | Figma MCP 구조적 데이터 추출 → `outputs/design/ui/ant/ui-*.json` 로 산출 | `TOOL_SETS.uiDesignFigma` |
| `gen-ui-ref` | references/ 존재 | 스크린샷 멀티모달 시각 분석 | `TOOL_SETS.uiDesign` |
| `gen-ui-desc` | 텍스트 설명만 | 텍스트 기반 UI 설계 | `TOOL_SETS.uiDesign` |
| `rev-ui` | 기존 UI 문서 수정 | figmaConfig 여부에 따라 Figma/Ref 모드 | 상황에 따라 결정 |

Figma intent(`gen-ui-figma`)가 합성되면 references는 무시된다. 상세 파이프라인은 [25-ui-design-pipeline.md](25-ui-design-pipeline.md) 참조.

## documentType (System Design)

decompose가 프로젝트 환경에 따라 문서 구조를 결정한다.

| environment | documentType | 출력 구조 |
|-------------|-------------|----------|
| frontend / backend | unified | `system-design.md` (단일) |
| fullstack | contract-first | `api-contract.md` + `fe-system-design.md` + `be-system-design.md` |
| fullstack + MSA | msa-contract-first | `api-contract.md` + `fe-system-design.md` + `be-system-design-{service}.md` (서비스별) |

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

plan -> docGen -> [router]
    +-> tool -> docGen (도구 호출 루프)
    +-> checkTaskStatus (done=true)
    +-> docGen (retry, done=false)

checkTaskStatus -> [router]
    +-> plan (다음 태스크)
    +-> learn -> __end__
```

### figmaExplore 노드

Figma 모드 전용 노드. `detect` 이후, `decompose` 이전에 실행된다. LLM 호출 없이 프로그래밍적으로 Figma MCP 어댑터를 직접 호출하여 디자인 구조를 탐색하고 매트릭스(Variation, Component State)와 nodeSummary를 생성한다. 결과는 `state.figmaExplorationResult`에 저장되며 이후 decompose와 docGen에서 참조한다. 상세 알고리즘은 [25-ui-design-pipeline.md](25-ui-design-pipeline.md) 참조.

### 병렬 실행 (ANT_TASK_CONCURRENCY > 1)

decompose 이후 `parallelOrchestrator` 노드로 분기한다. Code Job과 동일한 TaskOrchestrator/TaskWorker 패턴을 사용한다.

```
decompose -> parallelOrchestrator -> learn -> __end__
```

Worker Subgraph는 `DesignGraphChannels`를 spread하여 메인 그래프와 채널을 동기화한다. 새 채널 추가 시 `DesignGraphChannels`(`graph.ts`)에만 추가하면 Worker에 자동 반영된다. 상세: [11-agent-architecture.md](11-agent-architecture.md) "Worker Subgraph 채널 정의" 참조.

## 주요 노드 특성

### plan

LLM 호출 없이 taskQueue에서 pop하여 currentTask를 설정한다. refactor 모드 시 smart context loading(코드베이스 재로드)을 수행한다.

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

## 경계

- 에이전트 공통 패턴: [11-agent-architecture.md](11-agent-architecture.md)
- Tool 시스템 (도구 카탈로그, 레지스트리, 오케스트레이터): [19-tool-system.md](19-tool-system.md)
- Code Job: [14-code-job.md](14-code-job.md)
- 프롬프트 템플릿: [13-prompt-system.md](13-prompt-system.md)
- UI Design 파이프라인 상세: [25-ui-design-pipeline.md](25-ui-design-pipeline.md)
