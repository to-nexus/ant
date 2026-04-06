# Ask System

## 개요

Ask 시스템은 사용자의 Ant 관련 질문에 **정적 지식**과 **동적 코드 탐색**을 결합하여 답변한다. Agentic Ask(독립 그래프)와 Inline Ask(중단된 Job 컨텍스트 내)로 구분된다.

## 2계층 지식 구조

### 계층 1: 정적 지식 (System Prompt)

LLM system prompt에 포함되어 tool call 없이 즉시 답변 가능한 지식.

**구성 요소:**

| 소스 | 내용 | 성격 |
|------|------|------|
| `ask/base.md` 고정 섹션 | Ant 개요, 핵심 원칙, 제약사항, Feature/Session 개념, UI 구조 | 안정적, 변경 드묾 |
| `{{{jobKnowledge}}}` | Job 타입 표, 모드별 설명/Outputs/Scope, Workflow Decision Principles | **YAML에서 런타임 생성** |
| `ask/rules.md` | 도구 사용 정책, 평가 프로토콜, 보안 제약, 응답 원칙 | 안정적 |

**YAML 단일 소스 원칙**: Job/Mode 설명은 `core/data/triage/jobs/*.yaml`에 정의된다. `AgentRegistry.generateAskKnowledge()`가 YAML을 마크다운으로 렌더링하여 `{{{jobKnowledge}}}`에 주입한다. 동일한 YAML을 triage 라우팅(`generatePromptContext()`)과 ask 지식이 함께 사용하므로, YAML을 업데이트하면 양쪽 모두 반영된다.

```
YAML (core/data/triage/jobs/*.yaml)
  ├─ AgentRegistry.generatePromptContext() → triage/base.md {{{jobCapabilities}}}
  └─ AgentRegistry.generateAskKnowledge()  → ask/base.md {{{jobKnowledge}}}
```

### 계층 2: 동적 코드 탐색 (Tool Calls)

정적 지식만으로 불충분할 때, LLM이 Ant 소스코드와 문서를 직접 읽어서 답변한다.

**판단 기준** (`rules.md`):

| 질문 유형 | 동작 |
|-----------|------|
| "X가 뭐야?" (개념) | 정적 지식으로 답변 가능 |
| "X가 어떻게 작동해?" | 반드시 도구로 검증 후 답변 |
| "왜 X가 이렇게 되지?" | 반드시 도구로 검증 후 답변 |
| 평가 요청 | 루브릭 + 대상 문서를 반드시 도구로 읽고 점수 매김 |

## Agentic Ask

Triage에서 `intent: ask, inScope: true`로 판정되면 Ask 그래프가 실행된다.

### LangGraph 워크플로우

```
agent (LLM + system prompt) → [router]
    +→ tool (코드 탐색) → agent (루프)
    +→ respond (최종 답변, 채팅 스트리밍)
```

### 노드 역할

| 노드 | 역할 |
|------|------|
| agent | base.md + rules.md + YAML 지식 로드, LLM 판단, tool call 결정 |
| tool | 도구 실행, 보안 검증, 결과 반환 |
| respond | 최종 응답을 Chat UI로 스트리밍 |

### 도구

Ant 소스 탐색 도구와 워크스페이스 탐색 도구로 구분된다.

| 도구 | 카테고리 | 설명 |
|------|----------|------|
| `read_ant_source` | Ant 소스 | 파일 읽기 (path, source: cli/ui/docs) |
| `list_ant_files` | Ant 소스 | 디렉토리 목록 (source: cli/ui/docs) |
| `search_ant_code` | Ant 소스 | 코드/문서 검색 (query, source, filePattern) |
| `read_workspace_file` | 워크스페이스 | 피처 디렉토리 내 파일 읽기 |
| `list_workspace_files` | 워크스페이스 | 피처 디렉토리 내 목록 |

**Source 옵션:**

| Source | 루트 | 대상 |
|--------|------|------|
| `cli` | ant-cli/src | 백엔드 소스 (agents, core, infrastructure) |
| `ui` | ant-ui/src | 프론트엔드 소스 (components, stores) |
| `docs` | docs/ | 루브릭, 아키텍처 문서, 가이드 |

### 접근 제어

Ant 소스 도구는 블랙리스트 패턴으로 민감 경로를 차단한다. 워크스페이스 도구는 `inputs/`, `outputs/`, `sessions/` 디렉토리만 허용(화이트리스트)한다.

**블랙리스트 (FORBIDDEN_PATTERNS)**: `.env`, `secret`, `credentials`, `password`, `private_key`, `api_key`, `infrastructure/auth/`, `infrastructure/networking/`, `node_modules/`, `.git/`, `dist/`

### 보안 계층

| 계층 | 위치 | 기능 |
|------|------|------|
| 경로 검증 | tools.ts | 블랙리스트 매칭, traversal 방지, 워크스페이스 허용 디렉토리 검증 |
| 출력 필터링 | tools.ts | Base64, API key 패턴 마스킹 |
| LLM 가드레일 | rules.md | 민감 정보 금지, Ant 소스코드 사용자 노출 금지 |

## Inline Ask

중단(interrupted)된 Job 세션에서 사용자가 채팅할 때 실행된다 (`POST /inline-ask`). Agentic Ask와 동일한 도구와 보안 계층을 사용하되, 중단된 Job의 태스크 컨텍스트(`existingTaskSummary`)를 triage에 주입하여 작업 재개 여부를 판단한다.

## Triage 연동

```
사용자 입력
    → Triage (intent 판단)
    → intent: ask + inScope → runAskGraph()
    → 채팅 응답 스트리밍
```

Ask 실행 중 Kanban, Workflow UI에는 변화가 없다. 채팅 응답만 스트리밍된다.

## 경계

- Triage 분류: [12-triage-routing.md](12-triage-routing.md)
- YAML Job 정의: `core/data/triage/jobs/*.yaml`
- 프롬프트 구조: [13-prompt-system.md](13-prompt-system.md)
- 채팅 스트리밍: [31-chat-system.md](31-chat-system.md)
