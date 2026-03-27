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

`detectEnvironment`에서 결정되며 문서 생성 전략을 결정한다.

| workType | 조건 | 출력 파일 |
|----------|------|----------|
| `system-design` | PRD/directive만 있고 UI 입력 없음 | system-design.md, api-contract.md 등 |
| `ui-design` | `inputs/figma.json` populated **또는** `inputs/references/` 존재 | ui-tokens.json, ui-assets.json, ui-spec.json |
| `spec` | spec 모드로 명시적 지정 시 | spec 문서 |

## UI Design Source Mode (SSOT)

`ui-design` workType은 두 가지 상호배타적 소스 모드를 갖는다. `detectEnvironment`에서 `state.uiDesignSource`를 결정한다.

| 모드 | 조건 | 방법론 | 도구 세트 |
|------|------|--------|----------|
| `figma` | `inputs/figma.json`에 files가 populated | Figma MCP 구조적 데이터 추출 | `TOOL_SETS.uiDesignFigma` |
| `references` | figma.json 비어있고 references/ 존재 | 스크린샷 멀티모달 시각 분석 | `TOOL_SETS.uiDesign` |

Figma 모드가 우선한다. 양쪽 모두 입력이 있으면 Figma를 사용하고 references는 무시된다. 상세 파이프라인은 [25-ui-design-pipeline.md](25-ui-design-pipeline.md) 참조.

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
    +-> triage -> detectEnvironment -> [source router]
         +-> uiDesignSource === 'figma': figmaExplore -> decompose
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

Figma 모드 전용 노드. `detectEnvironment` 이후, `decompose` 이전에 실행된다. 프로그래밍적으로 Figma MCP 도구를 호출하여 디자인 구조를 탐색하고 매트릭스(Variation, Component State, Interaction State)와 nodeSummary를 생성한다. 결과는 `state.figmaExplorationResult`에 저장되며 이후 decompose와 docGen에서 참조한다.

### 병렬 실행 (ANT_TASK_CONCURRENCY > 1)

decompose 이후 `parallelOrchestrator` 노드로 분기한다. Code Job과 동일한 TaskOrchestrator/TaskWorker 패턴을 사용한다.

```
decompose -> parallelOrchestrator -> learn -> __end__
```

## 주요 노드 특성

### plan

LLM 호출 없이 taskQueue에서 pop하여 currentTask를 설정한다. refactor 모드 시 smart context loading(코드베이스 재로드)을 수행한다.

### docGen

XML 스트리밍 방식으로 설계 문서를 생성한다. `conversationHistory` 기반 멀티턴 대화로 tool calling을 포함한다. 완료 판단은 LLM이 `<done>true</done>`을 출력하는 시점이다. `done=false`면 자기 자신으로 재진입하여 LLM 응답을 이어간다. 파일은 즉시 디스크에 기록한다.

### decompose

system-design은 LLM 기반 태스크 분해(documentType + targetFiles)를 수행한다. ui-design은 LLM 기반 UI 복잡도 분석 후 태스크를 분해한다. explain 모드는 단일 explain 태스크를 생성한다(LLM 호출 없음).

## UI Design 문서 의존 체인

UI 문서는 챕터 기반으로 순차 생성된다.

```
ui-tokens.json (의존 없음)
    -> ui-assets.json (ui-tokens 참조)
    -> ui-spec.json (ui-tokens + ui-assets 참조)
```

각 챕터 태스크는 자신의 범위만 생성한다. `lastSectionNumber`로 이전 섹션 번호를 추적하고, `<!-- LAST_SECTION: N -->` 메타데이터로 마지막 섹션을 기록한다.

## 경계

- 에이전트 공통 패턴: [11-agent-architecture.md](11-agent-architecture.md)
- Code Job: [14-code-job.md](14-code-job.md)
- 프롬프트 템플릿: [13-prompt-system.md](13-prompt-system.md)
- UI Design 파이프라인 상세: [25-ui-design-pipeline.md](25-ui-design-pipeline.md)
