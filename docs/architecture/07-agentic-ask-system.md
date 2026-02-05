# Agentic Ask System

## 1. 개요

### 목적

사용자의 Ant 시스템 관련 질문에 **정적 지식 + 동적 코드 탐색**을 결합하여 답변.

### 설계 원칙

| 원칙 | 설명 |
|------|------|
| **하이브리드 응답** | 정적 지식(프롬프트)으로 개념 설명, 동적 탐색(도구)으로 구체적 값 확인 |
| **효율성** | 개념 질문은 도구 호출 없이 즉시 응답 |
| **정확성** | 최신 구현 세부사항은 코드에서 직접 확인 |
| **보안** | 4계층 가드레일로 민감 정보 보호 |

---

## 2. 응답 패턴

### 2.1 정적 지식만으로 응답 (Tool 불필요)

```
질문: "Design Job이 뭐야?"
     ↓
LLM: base.md에 Job Types 설명 있음
     ↓
즉시 응답 (tool call 0회)
```

**적용 대상**: 개념 설명, 비교, 워크플로우 원칙, 일반 가이드

### 2.2 동적 탐색 필요 (Tool 사용)

```
질문: "Design Job의 prerequisite이 뭐야?"
     ↓
LLM: 구체적 값은 base.md에 없음
     ↓
tool call: read_ant_source("core/data/triage/jobs/design.yaml")
     ↓
YAML에서 값 확인 후 응답
```

**적용 대상**: 구체적 파라미터, 최신 구현 세부사항, 타입 정의

### 2.3 복합 응답 (정적 + 동적)

```
질문: "UI Design 모드는 언제 실행돼?"
     ↓
base.md: 개념적 설명 (Screen captures exist → UI specs)
     +
tool: design.yaml에서 trigger 조건 확인
     ↓
통합 응답
```

---

## 3. 프롬프트 구조

### WHAT/HOW 분리 (FPOP 준수)

```
core/prompt/templates/ask/
├── base.md    # WHAT: 정적 지식, 컨텍스트
└── rules.md   # HOW: 도구 사용 규칙, 보안 제약
```

### base.md 내용 (284줄)

| 섹션 | 내용 |
|------|------|
| Ant System Overview | 핵심 원칙, 제한사항 |
| Job Types | Design, Code, Learn 역할과 사용 시점 |
| Design Job Modes | UI Design vs System Design 차이 |
| Workflow Principles | 결정 가이드, 언제 Design 건너뛰는지 |
| Input Quality Guide | 좋은 PRD, 좋은 스크린샷 기준 |
| Output Documents | ui-tokens, ui-spec, system-design 상세 |
| Feature & Session | 세션 상태, 재개 개념 |
| UI Structure | Chat, Kanban, Workflow 역할 |
| Common Scenarios | 대표 시나리오별 가이드 |

### rules.md 내용 (80줄)

| 섹션 | 내용 |
|------|------|
| Tool Usage Policy | 언제 도구 사용/불필요 |
| Available Tools | read_ant_source, list_ant_files, search_ant_code |
| Accessible Paths | 화이트리스트 경로 |
| Security Constraints | 금지 사항 |
| Response Guidelines | 응답 원칙 |

---

## 4. LangGraph 워크플로우

### 4.1 아키텍처

```
┌─────────────────────────────────────────┐
│         Ask LangGraph                   │
│                                         │
│    ┌───────────┐      ┌───────────┐     │
│    │   agent   │─────►│   tool    │     │
│    │ (LLM+지식) │      │ (코드탐색) │     │
│    └─────┬─────┘      └─────┬─────┘     │
│          │                  │           │
│          │◄─────────────────┘           │
│          │                              │
│          ▼ (충분)                        │
│    ┌───────────┐                        │
│    │  respond  │                        │
│    └───────────┘                        │
└─────────────────────────────────────────┘
```

### 4.2 노드 역할

| 노드 | 파일 | 역할 |
|------|------|------|
| **agent** | `nodes/agent.ts` | base.md + rules.md 로드, LLM 판단, tool call 결정 |
| **tool** | `nodes/tool.ts` | 도구 실행, 보안 검증, 결과 반환 |
| **respond** | `nodes/respond.ts` | 최종 응답 Chat UI 스트리밍 |

### 4.3 상태 구조

```typescript
interface AskGraphState {
  question: string;           // 사용자 질문
  language: 'ko' | 'en';      // 응답 언어
  messages: BaseMessage[];    // LLM 대화 히스토리
  toolCalls: AskToolCall[];   // 도구 호출 기록
  pendingToolCall?: {...};    // 대기 중인 도구 호출
  response?: string;          // 최종 응답
  deps?: { llm?: any };       // 의존성
  _httpJobId?: string;        // HTTP 컨텍스트
}
```

---

## 5. 도구 정의

### 5.1 사용 가능한 도구

| 도구 | 설명 | 파라미터 |
|------|------|----------|
| `read_ant_source` | 파일 읽기 | path, source (cli/ui) |
| `list_ant_files` | 디렉토리 목록 | path, source |
| `search_ant_code` | 코드 검색 | query, source, filePattern |

### 5.2 접근 가능 경로 (화이트리스트)

**ant-cli:**
- `core/data/triage/jobs/*.yaml`
- `core/prompt/templates/**/*.md`
- `agents/**/types.ts`, `agents/**/state.ts`
- `docs/**/*.md`

**ant-ui:**
- `src/presentation/components/**/*.tsx`
- `src/domain/store/**/*.ts`
- `src/application/hooks/**/*.ts`

### 5.3 금지 경로 (블랙리스트)

- `.env`, `secret`, `key.`, `token`, `password`, `credential`
- `infrastructure/`, `/auth/`, `node_modules/`, `.git/`

---

## 6. 보안 계층

```
질문 필터링 → 경로 검증 → 출력 필터링 → LLM 가드레일
```

| 계층 | 위치 | 기능 |
|------|------|------|
| **질문 필터링** | `runner.ts` | `api key`, `secret`, `password` 등 키워드 차단 |
| **경로 검증** | `tools.ts` | 화이트리스트/블랙리스트 패턴 매칭, traversal 방지 |
| **출력 필터링** | `tools.ts` | Base64, API key 패턴 마스킹 |
| **LLM 가드레일** | `rules.md` | 민감 정보 금지 지시 |

---

## 7. Triage 연동

### 7.1 흐름

```
사용자 입력
    ↓
┌─────────────────────────────────────┐
│            Triage                    │
│  - intent 판단 (ask / work)          │
│  - inScope 판단                      │
└──────────────┬──────────────────────┘
               │
     ┌─────────┴─────────┐
     │                   │
     ▼                   ▼
[intent: ask]      [intent: work]
     │                   │
     ▼                   ▼
runAskGraph()      Design/Code/Learn Job
     │
     ▼
채팅 응답
```

### 7.2 호출 코드 (`triage/index.ts`)

```typescript
if (triageResult.intent === 'ask' && triageResult.inScope) {
  const askResult = await runAskGraph({
    question: userInput,
    language,
    workspaceState,
    currentJob,
    currentAgent,
    deps: { llm },
    _httpJobId: state._httpJobId,
  });
  
  triageResult = {
    ...triageResult,
    askResponse: askResult.response,
    displayMessage: askResult.response,
  };
}
```

### 7.3 UI 동작

- Job mode 표시: **변화 없음**
- 칸반 보드: **변화 없음**
- 워크플로우 UI: **변화 없음**
- 채팅: 응답 스트리밍

---

## 8. 파일 구조

```
agents/architect/graph/ask/
├── index.ts       # 모듈 export
├── state.ts       # AskGraphState 타입
├── tools.ts       # 도구 정의 + 보안 검증
├── graph.ts       # LangGraph 워크플로우
├── runner.ts      # 진입점 + 질문 필터링
└── nodes/
    ├── agent.ts   # LLM 판단 + 템플릿 로드
    ├── tool.ts    # 도구 실행
    └── respond.ts # Chat 스트리밍

core/prompt/templates/ask/
├── base.md        # WHAT: 정적 지식 (284줄)
└── rules.md       # HOW: 규칙 (80줄)
```

---

## 9. 디버그

```bash
ASK_DEBUG=true           # 도구 호출, 응답 길이 로깅
ASK_RECURSION_LIMIT=10   # 에이전트 루프 제한 (기본: 10)
```

---

## 10. 레거시 마이그레이션 (완료)

### 삭제된 파일

| 경로 | 설명 |
|------|------|
| `core/ask/` | AskResponseGenerator, types, index |
| `core/prompt/templates/triage/guide/` | 정적 지식 베이스 6개 파일 |

### 재생성된 파일

| 경로 | 설명 |
|------|------|
| `core/prompt/templates/ask/base.md` | FPOP 준수 정적 지식 |
| `core/prompt/templates/ask/rules.md` | 도구 사용 규칙 |

### 변경된 흐름

```
[Before]
triage → askResponseGenerator.generateStreaming()
       → 정적 마크다운 6개 로드
       → LLM 응답

[After]
triage → runAskGraph()
       → base.md + rules.md (정적 지식)
       → LLM 판단
       → (필요시) 도구로 코드 탐색
       → 응답
```
