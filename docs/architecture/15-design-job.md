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
| `system-design` | PRD/directive만 있고 참조 이미지 없음 | system-design.md, api-contract.md 등 |
| `ui-design` | `inputs/references/` 또는 `inputs/assets/`에 파일 존재 | ui-tokens.json, ui-assets.json, ui-spec.json |
| `spec` | spec 모드로 명시적 지정 시 | spec 문서 |

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
    +-> triage -> detectEnvironment -> decompose -> plan (순차 루프)
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
