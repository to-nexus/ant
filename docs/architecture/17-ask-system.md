# Ask System

## 개요

Ask 시스템은 사용자의 Ant 관련 질문에 정적 지식과 동적 코드 탐색을 결합하여 답변한다. Agentic Ask(독립 그래프)와 Inline Ask(Job 컨텍스트 내)로 구분된다.

## Agentic Ask

Triage에서 `intent: ask, inScope: true`로 판정되면 Ask 그래프가 실행된다.

### LangGraph 워크플로우

```
agent (LLM + 정적 지식) -> [router]
    +-> tool (코드 탐색) -> agent (루프)
    +-> respond (최종 답변, 채팅 스트리밍)
```

### 노드 역할

| 노드 | 역할 |
|------|------|
| agent | base.md + rules.md 로드, LLM 판단, tool call 결정 |
| tool | 도구 실행, 보안 검증, 결과 반환 |
| respond | 최종 응답을 Chat UI로 스트리밍 |

### 응답 패턴

| 패턴 | 조건 | tool call |
|------|------|-----------|
| 정적 지식만 | 개념 설명, 비교, 워크플로우 원칙 | 0회 |
| 동적 탐색 | 구체적 파라미터, 최신 구현 세부사항 | 1회 이상 |
| 복합 | 개념 + 구체적 값 | 1회 이상 |

### 도구

| 도구 | 설명 |
|------|------|
| `read_ant_source` | 파일 읽기 (path, source: cli/ui) |
| `list_ant_files` | 디렉토리 목록 |
| `search_ant_code` | 코드 검색 (query, source, filePattern) |

### 접근 제어

**화이트리스트 (접근 가능)**
- ant-cli: `core/data/triage/jobs/*.yaml`, `core/prompt/templates/**/*.md`, `agents/**/types.ts`, `agents/**/state.ts`
- ant-ui: `src/presentation/components/**/*.tsx`, `src/domain/store/**/*.ts`, `src/application/hooks/**/*.ts`

**블랙리스트 (접근 금지)**
- `.env`, `secret`, `key.`, `token`, `password`, `credential`
- `infrastructure/`, `/auth/`, `node_modules/`, `.git/`

### 보안 계층

| 계층 | 위치 | 기능 |
|------|------|------|
| 질문 필터링 | runner.ts | `api key`, `secret`, `password` 등 키워드 차단 |
| 경로 검증 | tools.ts | 화이트리스트/블랙리스트 매칭, traversal 방지 |
| 출력 필터링 | tools.ts | Base64, API key 패턴 마스킹 |
| LLM 가드레일 | rules.md | 민감 정보 금지 지시 |

## Inline Ask

실행 중인 Job 컨텍스트 내에서 질문에 답변한다. Agentic Ask와 동일한 도구와 보안 계층을 사용하되, 현재 Job의 상태 정보에 접근할 수 있다.

## 프롬프트 구조

| 파일 | 역할 | 내용 |
|------|------|------|
| `templates/ask/base.md` | WHAT | 시스템 개요, Job 타입, 설계 모드, 워크플로우 원칙, 입력 품질 가이드, UI 구조 |
| `templates/ask/rules.md` | HOW | 도구 사용 정책, 접근 가능 경로, 보안 제약, 응답 원칙 |

## Triage 연동

```
사용자 입력
    -> Triage (intent 판단)
    -> intent: ask + inScope -> runAskGraph()
    -> 채팅 응답 스트리밍
```

Ask 실행 중 Kanban, Workflow UI에는 변화가 없다. 채팅 응답만 스트리밍된다.

## 경계

- Triage 분류: [12-triage-routing.md](12-triage-routing.md)
- 프롬프트 구조: [13-prompt-system.md](13-prompt-system.md)
- 채팅 스트리밍: [31-chat-system.md](31-chat-system.md)
