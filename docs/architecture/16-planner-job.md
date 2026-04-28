# Planner Job

## 개요

Planner Job은 사용자의 directive를 받아 문서(PRD 등)를 생성하거나 수정하는 planner 에이전트의 LangGraph 그래프이다. Code/Design Job과 달리 태스크 분해가 없고, 단일 ReAct 루프(generate ↔ tool)로 동작한다. 멀티턴 대화와 clarifying question을 지원한다.

## Architect Job과의 차이

| 항목 | Architect (Code/Design) | Planner |
|------|------------------------|---------|
| 태스크 분해 | 있음 | 없음 |
| 병렬 실행 | 있음 | 없음 |
| 산출물 | 복수 파일 | 단일 파일 |
| 멀티턴 대화 | 미지원 | 지원 (session 기반) |
| Clarifying questions | 미지원 | 지원 (`<clarify>` 태그) |
| Resume 전략 | 태스크 단위 | Job 단위 (전체 재실행) |

## Target 결정

Planner Job의 산출물 대상(target)은 `resolvedAction.target`으로 결정된다. 하드코딩된 `prd.md` 경로는 없다.

### Explicit (Actions 패널)

UI가 `actionMetadata.target`을 세팅한다. resolve에서 추론하지 않는다.

| 패턴 | target 세팅 시점 | 예시 |
|------|-----------------|------|
| `mirrorRefs` (rev-plan) | refs 선택 시 | `['plan/api-spec.md']` |
| `dir + expectedFiles` (gen-plan) | intent 선택 시 | `['plan/prd.md']` |

rev-plan은 `refsSingleSelect: true`로 단일 선택만 허용.

Explicit에서 target이 없으면 (codebase/emptyHint 제외) 시스템 오류로 처리한다. 추론 폴백 없음.

### Infer (채팅)

resolve가 `workspaceState.sourceFileNames`를 활용하여 추론한다.

| 조건 | targets |
|------|---------|
| `prd.md` 있음 | `['plan/prd.md']` |
| `prd.md` 없고 다른 파일 있음 | 전체 source 파일 (LLM clarify) |
| 파일 없음 | `['plan/prd.md']` (gen-plan 기본값) |

## 모드

| Mode | 조건 | 행동 |
|------|------|------|
| `generate` | 기존 target 문서 없음, 또는 explicit gen-plan | `<file path="{targetPath}">` 태그로 전체 문서를 `plan/`에 직접 출력 |
| `refine` | 기존 target 문서 존재 + LLM이 수정 의도 감지 | `edit_file(path="{targetPath}")` 도구로 targeted editing |
| `explain` | 기존 문서 존재 + LLM이 분석/질의 의도 감지 | 읽기 전용 채팅 응답 |

## 문서 내용 주입

`existingDocument` state 필드는 없다. 문서 내용은 architect와 동일한 패턴으로 `resolvedAction.documents`에 로드되고, `action-context.md` partial이 렌더링한다.

| 역할 | 출처 | 렌더링 위치 | 의미 (3축 모델) |
|------|------|-------------|----------------|
| `ref` | `actionMetadata.refs` | `action-context.md` — `## Provided Documents` / `### [ref] ...` | 원본 (source of truth), 충돌 시 승자 |
| `context` | `actionMetadata.context` | `action-context.md` — `## Provided Documents` / `### [context] ...` | 동등 권위의 추가 입력, `ref` 와 충돌 시에만 subordinate |

role 의 3축 의미는 [jobs/shared/injections/role-guide.md](../../packages/ant-cli/src/core/prompt/templates/jobs/shared/injections/role-guide.md) SSOT 참조 — Authority (어느 입력을 따를지), Edit-scope (어느 파일을 write 할지), Task-scope (계획을 얼마나 넓게 가져갈지).

## 그래프 노드 흐름

```
__start__ -> resolve -> triage -> [router]
    +-> ask -> __end__
    +-> redirect -> __end__
    +-> blocked -> __end__
    +-> proceed -> generate

generate -> [router]
    +-> tool_use -> tool -> generate (ReAct 루프)
    +-> <clarify> 감지 -> ChoiceCard 발행 -> __end__
    +-> <file> 감지 -> plan/에 직접 저장 -> __end__
    +-> text only -> 대화 저장 -> __end__
```

## Clarifying Questions

PRD 생성/수정 시 정보가 부족하면 LLM이 `<clarify>` 태그로 질문을 출력한다.

### 처리 흐름

1. LLM 스트리밍 중 `XMLStreamParser`가 `<clarify>` 태그를 suppress
2. generate 노드에서 `parseClarifyBlocks()`로 질문 추출
3. Compound Clarifying ChoiceCard 발행
4. 대화를 세션에 저장 후 종료

## 도구

| 도구 | Generate | Refine | Explain |
|------|----------|--------|---------|
| `read_workspace_file` | O | O | O |
| `list_workspace_files` | O | O | O |
| `search_web` (Tavily) | O | O | O |
| `edit_file` | X | O | X |

## 파일 구조

```
agents/planner/
    index.ts
    graph/
        tools.ts
        plan/
            graph.ts            (buildPlanGraph)
            runner.ts           (runPlanGraph)
            state.ts            (PlanGraphState — existingDocument 없음)
            nodes/
                resolve.ts      (target 결정, documents 로드)
                generate.ts     (ReAct 루프, target path로 직접 저장)
                tool.ts         (도구 실행)
```

## State Persistence

| 시점 | 저장 내용 |
|------|----------|
| generate 완료 | conversation, conversationHistory, directive, mode, tokenUsage |
| tool 완료 | conversationHistory, tokenUsage |
| SIGTERM | stateSnapshot의 최신 상태 + interruption |

## 프롬프트 구조

`planner/plan/base.md` + `planner/plan/rules.md`. PromptEngine 6단계 파이프라인을 타지 않고 `generate.ts`에서 직접 Handlebars 렌더링한다.

- `base.md`: directive, mode, staging path, eval report, conversation context, `{{> common/injections/action-context}}`
- `rules.md`: 출력 프로토콜 (target path 직접 참조), clarify 규칙, mode별 행동

## 경계

- 에이전트 공통 패턴: [11-agent-architecture.md](11-agent-architecture.md)
- Tool 시스템 (도구 카탈로그, 레지스트리, 오케스트레이터): [19-tool-system.md](19-tool-system.md)
- Triage 분류: [12-triage-routing.md](12-triage-routing.md)
- Chat/ChoiceCard UI: [31-chat-system.md](31-chat-system.md)
- Action Config Matrix: [01-shared-contracts.md](01-shared-contracts.md)
