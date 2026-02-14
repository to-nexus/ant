# Planner Job

## 개요

Planner Job은 사용자의 directive를 받아 PRD를 생성하거나 수정하는 planner 에이전트의 LangGraph 그래프이다. Code/Design Job과 달리 태스크 분해가 없고, 단일 ReAct 루프(generate <-> tool)로 동작한다. 멀티턴 대화와 clarifying question을 지원한다.

## Architect Job과의 차이

| 항목 | Architect (Code/Design) | Planner |
|------|------------------------|---------|
| 태스크 분해 | 있음 | 없음 |
| 병렬 실행 | 있음 | 없음 |
| 산출물 | 복수 파일 | 단일 파일 (PRD) |
| 멀티턴 대화 | 미지원 | 지원 (session 기반) |
| Clarifying questions | 미지원 | 지원 (`<clarify>` 태그) |
| Resume 전략 | 태스크 단위 | Job 단위 (전체 재실행) |
| 그래프 노드 수 | 10+ | 4 |

## 모드

| Mode | 조건 | 행동 |
|------|------|------|
| `generate` | PRD가 없거나 template-only | `<file>` 태그로 전체 PRD 출력 |
| `refine` | 기존 PRD 존재 | `edit_file` 도구로 targeted editing |

resolve 노드가 `inputs/sources/prd.md`의 존재 여부와 실질 콘텐츠를 확인하여 mode를 자동 결정한다.

## 그래프 노드 흐름

```
__start__ -> resolve -> [router]
    +-> conversation 존재 -> generate (triage 건너뜀)
    +-> conversation 없음 -> triage -> [router]
        +-> ask -> __end__
        +-> redirect -> __end__
        +-> blocked -> __end__
        +-> proceed -> generate

generate -> [router]
    +-> tool_use -> tool -> generate (ReAct 루프)
    +-> <clarify> 감지 -> ChoiceCard 발행 -> __end__
    +-> <file> 감지 -> PRD 저장 + PRD Apply ChoiceCard -> __end__
    +-> text only -> 대화 저장 -> __end__
```

## PRD-as-State 패턴

PRD 파일 자체가 누적 상태이다. Job 간 대화 맥락 전달이 불필요하다.

- 생성 중 (staging): `outputs/plan/prd-refine.md`
- 적용 후 (canonical): `inputs/sources/prd.md`
- PRD Apply ChoiceCard를 통해 사용자가 적용 여부를 결정한다

## Clarifying Questions

PRD 생성/수정 시 정보가 부족하면 LLM이 `<clarify>` 태그로 질문을 출력한다.

### 처리 흐름

1. LLM 스트리밍 중 `XMLStreamParser`가 `<clarify>` 태그를 suppress (채팅에 raw XML 미노출)
2. generate 노드에서 `parseClarifyBlocks()`로 질문 추출
3. Compound Clarifying ChoiceCard 발행 (N개 질문을 하나의 카드에 묶음)
4. 대화를 세션에 저장 후 종료

### 사용자 응답 경로

| 경로 | 설명 |
|------|------|
| 카드에서 전부 답변 | 구조적 응답만으로 Job 재실행 |
| 카드 일부 + 자유 입력 | 구조적 + 자유 텍스트 합산 |
| 카드 무시, 자유 입력만 | 일반 conversation continuation |

카드 선택은 Zustand `pendingClarifyAnswers`에 저장되며, ChatInput과 공유된다.

## Conversation Continuation

세션 파일에 대화 이력이 저장되고 다음 실행 시 로드된다. conversation이 존재하면 triage를 건너뛰고 generate로 직행한다. LLM은 축적된 대화 컨텍스트 위에서 작업을 이어간다.

## 도구

| 도구 | Generate | Refine |
|------|----------|--------|
| `read_workspace_file` | O | O |
| `list_workspace_files` | O | O |
| `search_web` (Tavily) | O | O |
| `edit_file` | X | O |

## State Persistence

Plan Job은 ReAct 루프 단위로 상태를 저장한다.

| 시점 | 저장 내용 |
|------|----------|
| generate 완료 | conversation, conversationHistory, directive, mode, tokenUsage |
| tool 완료 | conversationHistory, tokenUsage |
| SIGTERM | stateSnapshot의 최신 상태 + interruption |

SIGTERM 처리는 `stateSnapshot` 패턴을 사용한다. mutable 공유 참조 객체를 모든 노드에 deps로 주입하고, 노드가 상태 변경 시 직접 업데이트한다. SIGTERM 핸들러는 이 객체를 읽어 세션에 저장한다.

## 평가와의 관계

PRD 생성과 평가는 별도 시스템이다. 생성은 planner agent (plan job), 평가는 ask agent (architect)가 PRD-RUBRIC.md 기반으로 수행한다. 생성 시점에 루브릭을 주입하지 않는다(할루시네이션 방지, 관심사 분리).

## 경계

- 에이전트 공통 패턴: [03-agent-architecture.md](03-agent-architecture.md)
- Triage 분류: [04-triage-routing.md](04-triage-routing.md)
- Chat/ChoiceCard UI: [12-chat-system.md](12-chat-system.md)
