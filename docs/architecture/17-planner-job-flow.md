# Planner Job Flow

> Planner agent의 PRD 생성/수정 흐름, clarifying question 메커니즘, conversation continuation 아키텍처

---

## 1. 개요

Planner job은 사용자의 directive를 받아 PRD(Product Requirements Document)를 생성하거나 수정하는 LangGraph 기반 에이전트이다.
Code/Design job과 달리 decompose 단계가 없고, 단일 ReAct 루프(generate ⟷ tool)로 동작한다.

### 다른 Job과의 차이점

| 항목 | Code Job | Design Job | **Planner Job** |
|------|----------|------------|-----------------|
| Agent | architect | architect | **planner** |
| Graph 노드 | decompose → plan → codeGen → tool → validate | decompose → plan → docGen → tool | **resolve → triage → generate → tool** |
| 출력물 | 소스 코드 파일 | 설계 문서 (MD, JSON) | **PRD (prd-refine.md)** |
| Staging 패턴 | 직접 코드베이스 쓰기 | 직접 파일 쓰기 | **outputs/plan/prd-refine.md → inputs/sources/prd.md** |
| 멀티턴 대화 | 미지원 | 미지원 | **지원 (session 기반 conversation)** |
| Clarifying questions | 미지원 | 미지원 | **지원 (`<clarify>` 태그)** |

---

## 2. 핵심 개념

### 2.1 Mode: generate vs refine

| Mode | 조건 | 행동 |
|------|------|------|
| `generate` | `inputs/sources/prd.md`가 없거나 template-only | 새 PRD를 `<file>` 태그로 전체 출력 |
| `refine` | 기존 PRD가 존재 | `edit_file` 도구로 targeted editing |

resolve 노드가 mode를 자동 결정한다 (`resolve.ts` L68).

### 2.2 Conversation Continuation

Planner는 멀티턴 대화를 지원한다. 세션 파일(`sessions/planner/plan.json`)에 대화 이력이 저장되고, 다음 실행 시 로드된다.

| 상태 | 라우팅 |
|------|--------|
| 첫 실행 (conversation 없음) | resolve → **triage** → generate |
| 대화 계속 (conversation 존재 + isResume) | resolve → **generate** (triage 건너뜀) |

### 2.3 PRD-as-State 패턴

PRD 파일이 곧 영속 상태이다:
- 생성 중: `outputs/plan/prd-refine.md` (staging)
- 적용 후: `inputs/sources/prd.md` (canonical)
- PRD Apply ChoiceCard를 통해 사용자가 적용 결정

### 2.4 Clarifying Questions (`<clarify>` 태그)

PRD 생성/수정 시 정보가 부족하거나 모호할 때, LLM이 `<clarify>` 태그로 질문을 출력하면 이를 파싱하여 ChoiceCard로 렌더링한다.

```
<clarify question="타겟 플랫폼은?">
<option>웹 앱 (SPA)</option>
<option>모바일 앱 (React Native)</option>
<option>데스크톱 앱 (Electron)</option>
</clarify>
```

**양쪽 모드에서 사용 가능:**

| Mode | 트리거 |
|------|--------|
| Generate | directive의 정보 밀도가 낮아 PRD 섹션을 채울 수 없을 때 |
| Refine | directive가 모호하여 여러 해석이 가능할 때 |

---

## 3. Graph 라우팅

### 3.1 전체 흐름

```
__start__
    │
    ▼
  resolve ──── 컨텍스트 로딩 (PRD, eval, session, conversation)
    │
    ├── conversation 있음? ──► generate (triage 건너뜀)
    │
    ▼
  triage ──── 의도 분류 (ask / work / redirect / blocked)
    │
    ├── ask ──────────► __end__ (질문 답변만)
    ├── redirect ─────► __end__ (다른 agent/job으로 안내)
    ├── blocked ──────► __end__ (필수 자료 누락)
    │
    ▼
  generate ──── LLM 호출 (ReAct loop)
    │
    ├── tool_use ──► tool ──► generate (루프)
    ├── <clarify> ──► ChoiceCard 발행 ──► __end__ (사용자 응답 대기)
    ├── <file> ───► PRD 저장 + PRD Apply ChoiceCard ──► __end__
    └── text only ──► 대화 저장 ──► __end__
```

### 3.2 Clarify 흐름 상세

```
┌─────────────────────────────────────────────────────────┐
│ generate node                                            │
│                                                          │
│  1. LLM 응답 수신                                       │
│  2. parseClarifyBlocks(responseText)                     │
│     ├── 있으면: clarify 경로                              │
│     │   ├── stripClarifyBlocks (채팅용 텍스트 정제)       │
│     │   ├── sendClarifyCard (ChoiceCard 발행)            │
│     │   ├── saveConversationToSession                    │
│     │   ├── finalizeMessage                              │
│     │   └── return (PRD 미생성, __end__)                  │
│     │                                                     │
│     └── 없으면: 기존 PRD 생성/수정 경로                    │
│         ├── <file> 태그 추출 or staging 파일 읽기          │
│         ├── 디스크 쓰기                                   │
│         ├── PRD Apply ChoiceCard 발행                     │
│         └── return                                        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ 사용자 응답 (ChoiceCard 선택 or 직접 입력)                │
│                                                          │
│  옵션 선택 → runJob(agent, jobType, selectedOption)      │
│  직접 입력 → 채팅창 포커스 → 일반 채팅 제출 흐름          │
│                                                          │
│  두 경우 모두:                                           │
│    → /execute (overrideDirective = 사용자 응답)           │
│    → resolve: session에서 conversation 로드               │
│    → isConversationContinuation = true                    │
│    → generate: 축적된 대화 컨텍스트로 LLM 호출            │
│    → 추가 질문 or 최종 PRD 생성                           │
└─────────────────────────────────────────────────────────┘
```

---

## 4. 프롬프트 구조

### 4.1 WHAT/HOW 분리 (base.md / rules.md)

| 파일 | 역할 | 내용 |
|------|------|------|
| `base.md` | WHAT (컨텍스트) | directive, mode, existingDocument, evalReport, conversationContext, language |
| `rules.md` | HOW (규칙) | Output Protocol, Clarifying Questions, Mode-Specific Behavior, Tool Usage, Constraints |

### 4.2 System Prompt 조립 (`generate.ts:buildSystemPrompt`)

```
base.md (Handlebars 렌더링)
  + directive, mode, existingDocument, evalReport, conversation...

---

rules.md (raw text)
  + Output Protocol, Clarifying Questions (Both Modes), Mode-Specific Behavior...
```

### 4.3 Clarifying Questions 프롬프트 설계 (FPOP 원칙)

| FPOP 원칙 | 적용 |
|-----------|------|
| Principles over Examples | 도메인별 예시 없음, 관찰 원칙만 |
| Observable over Assumed | "관찰되지 않은 것만 질문. 관찰된 것은 질문하지 않는다" |
| Constraints over Instructions | "이미 제공된 정보는 재질문 금지", "턴당 3개 이하 질문" |
| Reminders for Blind Spots | "비기능 요구사항, 비목표, 제약사항은 자주 누락" |

핵심 원칙: **입력 밀도에 비례하는 질문 깊이**
- 한 줄 입력 → 넓은 범위 질문
- 풍부한 소스 → 좁은 범위 구체화 질문만

---

## 5. 파일 구조

### 5.1 백엔드 (ant-cli)

```
packages/ant-cli/src/agents/planner/
├── index.ts                         # runPlanGraph() 진입점
└── graph/
    ├── tools.ts                     # 도구 정의 (read, list, search_web, edit_file)
    └── plan/
        ├── graph.ts                 # LangGraph 정의 (resolve → triage → generate ⟷ tool)
        ├── state.ts                 # PlanGraphState 인터페이스
        ├── runner.ts                # Graph 실행기
        └── nodes/
            ├── resolve.ts           # 컨텍스트 로딩 (PRD, eval, session, conversation)
            ├── generate.ts          # LLM 호출 + clarify 파싱 + PRD 출력
            └── tool.ts              # 도구 실행

packages/ant-cli/src/core/prompt/templates/planner/plan/
├── base.md                          # WHAT: 컨텍스트 템플릿
└── rules.md                         # HOW: 규칙 템플릿
```

### 5.2 프론트엔드 (ant-ui)

```
packages/ant-ui/src/
├── domain/models/chat.ts            # MessageContent 타입 (clarifyBlocks 메타데이터)
├── domain/store/slices/uiSlice.ts   # pendingClarifyAnswers Zustand 상태 (카드↔채팅입력 공유)
├── presentation/components/chat/
│   ├── ChoiceCard.tsx               # ClarifyingVariant (compound card + 인라인 직접입력)
│   ├── MessageItem.tsx              # cardType='clarifying' 분기
│   └── ChatInput.tsx                # pending clarify 합산 + 자유 입력 하이브리드 제출
└── infrastructure/http/api.ts       # submitPrdApply, submitChoiceDismiss 등
```

### 5.3 워크스페이스 파일

```
ant-workspaces/{org}/{group}/{project}/features/{feature}/
├── inputs/sources/prd.md            # canonical PRD (적용된 최종본)
├── outputs/plan/prd-refine.md       # staging PRD (적용 전 초안)
├── outputs/evals/prd/               # PRD 평가 리포트
└── sessions/planner/plan.json       # 대화 이력 + 세션 상태
```

---

## 6. ChoiceCard 아키텍처

### 6.1 Variant 구분

| Variant | 테마 | 레이아웃 | 용도 |
|---------|------|----------|------|
| `triage_choice` | blue | TwoButtonLayout | 작업 라우팅 선택 |
| `cancelled` | orange | TwoButtonLayout | 작업 취소 후 재개/무시 |
| `eval_save` | emerald | TwoButtonLayout | 평가 리포트 저장 |
| `prd_apply` | violet | TwoButtonLayout | PRD 적용 |
| **`clarifying`** | violet | **Compound Card** | **PRD 생성 시 다수 질문** |

### 6.2 Compound Clarifying Card 구조

N개 질문을 **하나의 카드**에 묶어 표시. 개별 질문마다 옵션 버튼 + 인라인 직접입력을 지원.

```
+---------------------------------------+
| 💬 PRD 작성을 위해 3가지 질문          |
|                                       |
| Q1: 블록체인 네트워크?                |
| [✓ Ethereum] [Solana] [Base] [기타]  |
|                                       |
| Q2: 베팅 마켓 종류?                   |
| [정치] [암호화폐] [스포츠] [✓ 모든종류]|
|                                       |
| Q3: 타겟 사용자?                      |
| [Polygon zkEVM|____]  ← 인라인 input  |
|                                       |
|        [ 답변 제출 (2/3) ]            |
| 답변하지 않은 질문은 건너뜁니다.       |
+---------------------------------------+
```

**핵심 특징:**
- 질문별 옵션은 wrap 배치 (가로 → 줄바꿈)
- "직접 입력" 클릭 시 해당 질문 영역 내에 인라인 input 표시 (채팅창 포커스 아님)
- 제출 버튼은 1개 이상 응답 시 활성화 (partial 허용)
- 모든 선택은 Zustand `pendingClarifyAnswers`에 저장 (ChatInput과 공유)

### 6.3 세 가지 응답 경로 (하이브리드)

| 경로 | 카드 응답 | 채팅 입력 | 결합 결과 |
|------|-----------|-----------|-----------|
| A: 카드에서 전부 답변 후 제출 | 3/3 | 없음 | 구조적 응답만 |
| B: 카드 일부 + 자유 입력 | 1~2/3 | 있음 | 구조적 + 자유 합산 |
| C: 카드 무시, 자유 입력만 | 0/3 | 있음 | 자유 입력만 |

**Zustand 공유 상태로 구현:**

```
ClarifyQuestionBlock          Zustand Store                ChatInput
     │                            │                            │
     ├── Q1 선택: "Ethereum" ──►  pendingClarifyAnswers        │
     ├── Q2 선택: "모든 종류" ──► = {0: "Ethereum",            │
     │                              1: "모든 종류"}            │
     │                            │                            │
     │                            │       사용자 Enter 시      │
     │                            │  ◄── handleSubmit ────►    │
     │                            │      pending + 자유텍스트   │
     │                            │      합산 → runJob()        │
     │                            │      clearPendingClarify()  │
```

**경로 A (카드 내 제출 버튼):**
```
카드 "답변 제출" 클릭
    → ClarifyingVariant.handleSubmitAll()
    → pendingClarifyAnswers에서 답변 수집
    → "- Q1: Ethereum\n- Q2: 모든 종류" 형태로 결합
    → runJob(agent, jobType, combined) → /execute
    → clearPendingClarify()
```

**경로 B (카드 일부 + 채팅 자유 입력):**
```
카드에서 Q1, Q2 선택 (pendingClarifyAnswers에 저장)
    → 채팅창에 "일반 사용자 대상 모바일 우선" 입력 후 Enter
    → ChatInput.handleSubmit()
    → pendingClarifyAnswers 감지
    → "- 네트워크: Ethereum\n- 마켓: 모든 종류\n\n일반 사용자 대상 모바일 우선" 합산
    → runJob(agent, jobType, combined)
    → clearPendingClarify()
```

**경로 C (채팅 자유 입력만):**
```
카드 무시, 채팅창에 자유 입력 후 Enter
    → ChatInput.handleSubmit()
    → pendingClarifyAnswers 비어있음
    → 자유 텍스트만으로 runJob()
    → 일반 conversation continuation 흐름
```

### 6.4 `<clarify>` 스트리밍 suppress

`XMLStreamParser`가 `<clarify>` 태그를 인식하여 스트리밍 중 채팅에 raw XML이 노출되지 않도록 한다:

```
LLM 스트리밍 출력:
  "몇 가지 질문이 있습니다.\n<clarify question="...">...</clarify>"

XMLStreamParser 동작:
  1. "몇 가지 질문이 있습니다.\n" → response action (채팅에 표시)
  2. "<clarify ...>...</clarify>" → suppress (버퍼에서 폐기)

generate.ts post-stream:
  3. parseClarifyBlocks(responseText) → 질문 추출
  4. chatAPI.sendClarifyCards(blocks) → compound choice card 발행
```

---

## 7. 도구 (Tools)

| 도구 | 설명 | Generate | Refine |
|------|------|----------|--------|
| `read_workspace_file` | 워크스페이스 파일 읽기 | O | O |
| `list_workspace_files` | 디렉토리 목록 | O | O |
| `search_web` | 웹 검색 (Tavily API) | O | O |
| `edit_file` | PRD 파일 편집 (search/replace) | X | O |

---

## 8. Session 구조

`sessions/planner/plan.json`:

```json
{
  "sessionId": "job-xxx",
  "project": "my-project",
  "feature": "my-feature",
  "createdAt": "2026-02-13T...",
  "updatedAt": "2026-02-13T...",
  "turns": [...],
  "state": {
    "conversation": [
      { "role": "user", "content": "블록체인 지갑 만들어줘", "timestamp": "..." },
      { "role": "assistant", "content": "몇 가지 질문이 있습니다...", "timestamp": "...", "metadata": { "hasArtifact": false } },
      { "role": "user", "content": "웹 앱으로 만들겠습니다", "timestamp": "..." },
      { "role": "assistant", "content": "...", "timestamp": "...", "metadata": { "hasArtifact": true, "artifactPath": "outputs/plan/prd-refine.md" } }
    ],
    "jobId": "job-xxx"
  }
}
```

대화가 축적되며, PRD가 생성될 때 `hasArtifact: true`로 마킹된다.

---

## 9. 평가와의 관계

PRD 생성과 평가는 **별도 시스템**이다:

| 단계 | 담당 | 도구 |
|------|------|------|
| PRD 생성/수정 | Planner agent (`plan` job) | `<file>`, `edit_file`, `<clarify>` |
| PRD 평가 | Ask agent (architect) | PRD-RUBRIC.md 기반 6차원 100점 평가 |
| PRD 개선 | Planner agent (`plan` job, refine mode) | 사용자가 평가 결과를 참고해 개선 요청 |

생성 시점에 루브릭을 주입하지 않는 이유:
1. 840줄 루브릭이 "점수 올리기 위한 할루시네이션"을 유발
2. resolve 노드에서 rubric auto-loading이 비활성화됨 (실험 결과)
3. 관심사 분리: 생성은 사용자 의도 반영, 평가는 품질 측정
