# 28. Context Management Architecture

Context Window 관리 전략: 4단 계층 정의, 메커니즘 인벤토리, Job별 pruning/compaction 매트릭스.

---

## 1. 4-Tier Conversation Hierarchy

| Term | Definition |
|---|---|
| **Session** | Feature 단위 개발 세션. 하나의 feature 디렉토리 = 하나의 Session. 여러 JobType의 세션 파일들을 포괄하는 최상위 컨테이너. |
| **Job** | 하나의 목표를 가진 작업 단위. `httpJobId`로 식별(Isolation) 또는 파일 경로로 식별(Continuity). N개의 Run을 포함. |
| **Run** | 한 번의 BullMQ job 실행 = 한 프로세스 스폰. 세션 로드 → 처리 → 세션 저장의 한 사이클. 코드에서 `SessionRun`으로 기록. |
| **Turn** | Run 내 ReAct 루프의 한 LLM 호출-응답 쌍. `groupMessagesIntoTurns()` 반환 단위. `tool_use` 포함 가능. |

### Code Mapping

| Code | Tier |
|---|---|
| feature directory (`sessions/`) | **Session** |
| `Session` type, session file (*.json) | **Session** (Isolation) / **Job** (Continuity) |
| `httpJobId` | **Job** ID (Isolation) / **Run** ID (Continuity) |
| `SessionRun` | **Run** |
| `Session.runs` | Run list |
| `SessionRun.runId` | Run ID |
| `conversationHistory` (graph state) | Turn array within a Run |
| `ConversationEntry[]` (`state.conversation`) | Job-level semantic history (Continuity only) |
| `groupMessagesIntoTurns()` return unit | **Turn** |

---

## 2. Context Management Strategies

### Context Isolation (Code, Design)

Spec-driven development. Each user directive is an independent Job. Context is intentionally discarded between Jobs.

```
Session (feature: "my-sns-app")
 └── code.json (N Jobs)
      ├── Job "aaa" ("implement login")
      │    ├── Run 1 (decompose → execute task 1)
      │    └── Run 2 (resume → execute task 2)
      └── Job "bbb" ("implement payment")
           └── Run 1 ...
```

- 1 Session : **N Jobs** : M Runs per Job
- Job artifacts (code, docs) serve as state — no inter-Job conversation history
- Enables: parallel execution, independent retry, context freshness

#### Inter-Job Context Bridge

Code/Design의 Context Isolation을 유지하면서 Job 간 맥락을 전달하는 메커니즘.

**핵심 개념:**
- `session.state.jobConversation: ConversationEntry[]` — Job 완료 기록의 누적 배열
- 각 Job 완료 시 2개 entry 추가 (user: directive, assistant: result)
- 기존 `conversationHistory` 폐기 정책은 불변 — jobConversation은 별도 채널

**Boundary Classification:**

| 분류 | 의미 | 결정 시점 |
|---|---|---|
| **Heavyweight** | 복잡한 작업, inter-task isolation 적용. raw context 보존 가치 낮음 | decompose (pre-determined 또는 LLM 판정) |
| **Lightweight** | 응집적 작업, raw context가 그 자체로 가치 있음 | decompose (pre-determined 또는 LLM 판정) |

**Dual-Trigger Compaction (모든 압축은 다음 Job의 resolve에서 수행):**
- **Trigger 2 (Heavyweight)**: 미압축 heavyweight entries를 LLM 요약으로 교체 (`compressHeavyweightEntries`)
- **Trigger 1 (Threshold)**: 전체 `jobConversation` 토큰이 threshold 초과 시 `compactJob`으로 MECE 압축

**데이터 흐름:**
1. learn: raw record만 append (LLM 호출 없음)
2. 다음 Job resolve: jobConversation 로드 → Trigger 2 → Trigger 1 → persist
3. decompose: 압축된 jobConversation을 `job-history` partial로 프롬프트에 주입

**프롬프트:**
- `common/compaction/job-summary.md` — Trigger 2 heavyweight 요약용
- `code/base/injections/job-history.md` — Code decompose에 주입
- `design/base/injections/job-history.md` — Design decompose에 주입

### Context Continuity (Plan, Visual)

Free-form conversation. The entire session file is one continuous dialogue.

```
Session (feature: "my-sns-app")
 └── plan.json (1 Job = entire conversation)
      └── Job
           ├── Run 1 ("create SNS PRD")
           └── Run 2 ("elaborate auth section")
```

- 1 Session : **1 Job** : N Runs
- Context preserved across Runs via `conversationHistory` + `conversation`
- Requires pruning/compaction to prevent unbounded growth

---

## 3. 데이터 포맷

| 포맷 | 계층 | 사용처 | 구조 |
|---|---|---|---|
| `ConversationMessage[]` | Run (Turn) | `conversationHistory` graph state, `historyManager` | `{ role, content: string \| MessageContentBlock[] }` |
| `ConversationEntry[]` | Job (semantic) | Plan/Visual `state.conversation` | `{ role: 'user'\|'assistant'\|'system', content, timestamp, metadata? }` |

`ConversationMessage[]`는 LLM 메시지 포맷(tool_use/tool_result block 포함)이고, `ConversationEntry[]`는 사람 읽기 가능한 요약 포맷. `system` role은 chapter marker(Visual deliver)와 compaction summary(persist pruning)에 사용.

---

## 4. Pruning 메커니즘 인벤토리

| 메커니즘 | 계층 | LLM? | 대상 데이터 포맷 | 역할 |
|---|---|---|---|---|
| `compactToolResults` | Sub-turn | No | `ConversationMessage[]` | tool_result content block 축약 |
| `compactTurns` | Turn | No | `ConversationMessage[]` | cold turns → fact 요약 교체 |
| `pruneTurns` | Turn | No | `ConversationMessage[]` | 우선순위 기반 turn 삭제 |
| `compactRun` | Run (오케스트레이터) | No | `ConversationMessage[]` | 위 3개를 순서대로 실행 |
| `compactJob` | Job (prompt) | **Yes** | `ConversationEntry[]` 등 | LLM-based 세션 대화 요약 |
| `applyCompactionToConversation` | Job (persist) | No | `ConversationEntry[]` | compactJob 결과를 세션 파일에 반영 |
| `retentionPolicy` | Task | No | - | task 전환 시 보존/폐기 결정 |

### 4.1 compactToolResults (Sub-turn)

Hot tail 외부의 `tool_result` content block을 rule-based로 축약. 에러 결과는 보존.

- 대상 도구: `read_file`, `search_code`, `run_command`, `list_files`, `search_reference_code`, `read_source_doc`
- 최소 축약 임계값: 200 tokens
- Anthropic API 포맷 (tool_use/tool_result 쌍) 보존

### 4.2 compactTurns (Turn)

토큰 임계값 초과 시 cold turns를 rule-based fact 요약으로 교체. LLM 호출 없이 tool_use/tool_result 블록에서 구조적 사실(파일 생성/편집, 명령 실행, 에러) 추출.

- 임계값: 50,000 tokens
- Hot tail: 최근 5 turns 보존
- 요약은 assistant+user 메시지 쌍으로 삽입 (API alternation 유지)

### 4.3 pruneTurns (Turn)

우선순위 기반 turn 삭제. 최소 N개 최근 turn 보존, 에러/setup turn 우선순위 부여.

- 기본 예산: 75,000 tokens
- 최소 보존: 3 turns
- 우선순위: 에러(+10), setup(+5), 대형 결과(-5)

### 4.4 compactRun (Run 오케스트레이터)

위 3단계를 순서대로 실행하는 파이프라인:
1. compactToolResults → 2. compactTurns → 3. pruneTurns

### 4.5 compactJob (Job — prompt)

LLM-based 세션 대화 요약. `ConversationEntry[]`를 대상으로 오래된 항목을 LLM이 요약.
- Plan/Visual에서 사용 (기존 `pruneSession` rule-based 대체)
- `CompactionResult<T>`: `{ entries, summary?, wasCompacted, tokensBefore, tokensAfter }`
- 호출자가 summary 렌더링 포맷 결정 → 기존 프롬프트 포맷 호환
- 프롬프트: `common/compaction/system.md` (PromptPort를 통해 주입, MECE 보존 전략)
- MECE 보존 카테고리: **Agreements** (확정), **Artifacts** (산출물), **Open Items** (미결)
- Claude Code 벤치마크 기반 설계: "structured checklist → working state" 패턴

### 4.5b applyCompactionToConversation (Job — persist)

compactJob 결과를 세션 저장 시 conversation 배열에 반영. 추가 LLM 호출 없음.
- `ConversationCompaction { summary, summarizedCount }` 메타데이터를 받아
- conversation 앞 `summarizedCount`개 항목을 하나의 `system` summary entry로 대체
- Progressive summarization 지원: 이전 summary entry가 다시 compactJob 대상이 될 수 있음

### 4.6 retentionPolicy (Task)

Context Isolation 전용. Task 전환 시 대화 이력 보존/압축/폐기 결정.
- Code: 항상 discard
- Design system-design (같은 targetFile): compact
- Design ui-design: discard (disk-based loadPreviousUiDocs 사용)

---

## 5. Job별 적용 매트릭스

### 현재 상태

|  | compactRun | compactJob (prompt) | applyCompactionToConversation (persist) | retentionPolicy | Inter-Job Context Bridge |
|---|---|---|---|---|---|
| Code (Isolation) | O | O (jobConversation, 8K threshold) | O (jobConversation) | O | O (resolve: Trigger 2 + Trigger 1) |
| Design (Isolation) | O | O (jobConversation, 8K threshold) | O (jobConversation) | O (spec 명시적 discard) | O (resolve: Trigger 2 + Trigger 1) |
| Plan (Continuation) | O (50K budget) | O (LLM-based, 12K threshold) | O | - | - |
| Visual (Continuation) | X (tool loop ephemeral) | O (LLM-based, 6.4K threshold) | O | - | - |

Visual에 compactRun이 불필요한 이유: `streamWithToolLoop`의 `currentMessages`는 함수 로컬 변수로 최대 5라운드 후 소멸. graph state/세션에 저장되지 않으므로 cross-invocation 성장 없음.

### 향후 개선

| 항목 | 현재 | 목표 | 비고 |
|---|---|---|---|
| Job Type별 압축 잔여량 UI | 미적용 | 채팅창에 circular progress 게이지 표시 | estimateTokens(jobConversation) / threshold |
| 수동 압축 (Manual Trigger 1) | 미적용 | UI에서 "압축하기" 버튼 | API endpoint 추가 필요 |

---

## 6. 공통 파이프라인: compactRun

```
compactToolResults (Sub-turn)
  → compactTurns (Turn)
    → pruneTurns (Turn)
```

`compactRun`은 `ConversationMessage[]` (LLM 메시지 포맷)를 입력받아 3단계 파이프라인을 순서대로 실행. TokenBudgetManager의 예산을 반영.

### 사용처

| 사용처 | 데이터 | 호출 시점 |
|---|---|---|
| Code/Design prompt builders | `conversationHistory` | LLM 호출 전 |
| Plan generateNode | `conversationHistory` | LLM 호출 전 + 세션 저장 전 |
| `applyRetention` (Isolation) | `conversationHistory` | Task 전환 시 |

---

## 7. 분화 메커니즘

### retentionPolicy (Context Isolation)

Task 전환 시 대화 이력 보존/폐기 결정. `compactRun`을 내부적으로 호출 (compact 결정 시).

| 조건 | 결정 |
|---|---|
| Code (모든 경우) | discard |
| Design + no next task | discard |
| Design + system-design + same targetFile | compact |
| Design + system-design + different file | discard |
| Design + ui-design | discard |
| Design + spec | discard (목표: 명시적 분기) |

### compactJob (Context Continuity)

Job-level LLM-based 대화 요약. PromptPort를 통해 `common/compaction/system.md` 템플릿을 주입받아 사용.

| Job | 임계값 | Window | 비고 |
|---|---|---|---|
| Plan | 12,000 tokens | 최근 4 entries | system prompt 내 conversation context |
| Visual | 6,400 tokens | 최근 3 entries | user prompt 내 conversation context |

**MECE 보존 전략**: Claude Code 벤치마크 기반. 모든 유의미한 정보를 3 카테고리로 분류:

| 카테고리 | 보존 대상 | Claude Code 대응 |
|---|---|---|
| **Agreements** | 결정, 제약조건, 요구사항, 스코프 | User intent + Technical decisions + Errors & fixes |
| **Artifacts** | 생성 파일, 저장 에셋, 문서, 경로 | Files touched & why |
| **Open Items** | 미해결 질문, 보류 결정, 다음 작업 | Pending tasks + Next step |

**Persist Pruning**: `applyCompactionToConversation`을 세션 저장 시 적용하여 conversation 무한 성장 방지.
- Visual: `graph.ts`에서 `finalState._conversationCompaction` 메타데이터 사용
- Plan: `generateNode` 내부의 `compactionMeta` 로컬 변수를 `saveConversationToSession`에 전달

**Progressive Summarization**: 이전 summary entry(role='system')가 다시 compactJob 대상이 되어 자연스러운 다단계 요약 동작.

---

## 8. core/context/ 모듈 구조

```
packages/ant-cli/src/core/context/
├── types.ts              ← 타입 + 공유 헬퍼 (groupMessagesIntoTurns, isErrorContent)
├── constants.ts          ← 모든 상수
├── compactToolResults.ts ← (Sub-turn)
├── compactTurns.ts       ← (Turn)
├── pruneTurns.ts         ← (Turn) TurnPruner
├── compactRun.ts         ← (Run) 오케스트레이터
├── compactJob.ts         ← (Job) LLM compaction
├── retentionPolicy.ts    ← (Task) retention
└── index.ts              ← barrel
```

### 의존 그래프

```
compactToolResults → types
compactTurns → types
pruneTurns → types, tokenBudget
compactRun → compactToolResults, compactTurns, pruneTurns, tokenBudget, constants
compactJob → types, constants, llmPort, promptPort
retentionPolicy → compactRun, types, tokenBudget
```

순환 의존 없음.

### Re-export 브릿지

기존 외부 import를 유지하기 위해 브릿지 파일 제공:

- `core/utils/historyManager.ts` → `compactRun`, `compactToolResults`, `compactTurns`, 타입 re-export
- `core/utils/conversationRetention.ts` → `retentionPolicy` re-export

---

## 9. 토큰 상수

| 상수 | 값 | 사용처 |
|---|---|---|
| `COMPACTABLE_TOOLS` | Set(6) | compactToolResults 대상 도구 |
| `MIN_CONTENT_TOKENS_TO_COMPACT` | 200 | compactToolResults 최소 임계값 |
| `DEFAULT_COMPACT_TOOL_RESULTS_HOT_TAIL` | 3 | compactToolResults 기본 hot tail |
| `DEFAULT_COMPACT_TURNS_THRESHOLD` | 50,000 | compactTurns 트리거 임계값 |
| `DEFAULT_COMPACT_TURNS_HOT_TAIL` | 5 | compactTurns 기본 hot tail |
| `DEFAULT_PRUNE_TURNS_MAX_TOKENS` | 75,000 | pruneTurns 기본 예산 |
| `DEFAULT_PRUNE_TURNS_MIN_KEEP` | 3 | pruneTurns 최소 보존 turn |
| `PLAN_CONVERSATION_HISTORY_BUDGET` | 50,000 | Plan conversationHistory 예산 |
| `PLAN_COMPACTION_THRESHOLD` | 12,000 | Plan compactJob 트리거 |
| `PLAN_COMPACTION_WINDOW` | 4 | Plan compactJob 최근 window |
| `VISUAL_COMPACTION_THRESHOLD` | 6,400 | Visual compactJob 트리거 |
| `VISUAL_COMPACTION_WINDOW` | 3 | Visual compactJob 최근 window |
| `COMPACTION_MAX_OUTPUT_TOKENS` | 16,384 | compactJob LLM 최대 출력 |
| `CODE_JOB_COMPACTION_THRESHOLD` | 8,000 | Code Inter-Job Context compactJob 트리거 |
| `CODE_JOB_COMPACTION_WINDOW` | 3 | Code Inter-Job Context 최근 window |
| `DESIGN_JOB_COMPACTION_THRESHOLD` | 8,000 | Design Inter-Job Context compactJob 트리거 |
| `DESIGN_JOB_COMPACTION_WINDOW` | 3 | Design Inter-Job Context 최근 window |

---

## Key Files

| File | Role |
|---|---|
| `core/context/types.ts` | ConversationMessage, HistoryPruneConfig, CompactionResult, CompactionConfig |
| `core/context/constants.ts` | 모든 토큰 상수 |
| `core/context/compactToolResults.ts` | Sub-turn tool_result 축약 |
| `core/context/compactTurns.ts` | Turn-level rule-based 요약 |
| `core/context/pruneTurns.ts` | Turn-level 우선순위 기반 삭제 |
| `core/context/compactRun.ts` | Run-level 3단계 오케스트레이터 |
| `core/context/compactJob.ts` | Job-level LLM compaction + applyCompactionToConversation + ConversationCompaction |
| `core/prompt/templates/common/compaction/system.md` | compactJob 프롬프트 (MECE 보존 전략) |
| `core/prompt/templates/common/compaction/job-summary.md` | Trigger 2 heavyweight job 요약 프롬프트 |
| `core/prompt/templates/code/base/injections/job-history.md` | Code decompose에 주입되는 job history partial |
| `core/prompt/templates/design/base/injections/job-history.md` | Design decompose에 주입되는 job history partial |
| `core/context/retentionPolicy.ts` | Task-boundary retention (Isolation) |
| `core/utils/tokenBudget.ts` | TokenBudgetManager (200K area budgets) |
| `core/types/session.ts` | Session, SessionRun, ConversationEntry types |
| `core/schemas/session.schema.ts` | Zod validation schemas |
| `core/ports/session.ts` | SessionPort interface |
