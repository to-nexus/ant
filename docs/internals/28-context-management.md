# 28. Context Management Architecture

Context window management strategy: 4-tier hierarchy definition, mechanism inventory, and per-job pruning/compaction matrix.

> ⚠️ **Partially superseded (2026-04-20)**: The "Context Isolation" model for the code/design paths (§2 Inter-Job Context Bridge · `jobConversation` · heavyweight/lightweight compaction · the `CODE_JOB_COMPACTION_*` / `DESIGN_JOB_COMPACTION_*` constants · the `job-history` templates) has been **fully replaced** by [`18-session-redesign.md`](./18-session-redesign.md). code/design now use `feature.jsonl` + `featureContext` + `FEATURE_CONTEXT_THRESHOLD(12000)`.
>
> **Still-valid scope** of this document: (a) the 4-Tier conversation hierarchy (Session/Job/Run/Turn) definitions · (b) the `compactRun` 2-stage pipeline (`compactTurns` → `pruneTurns`) · (c) `compactJob` + `applyCompactionToConversation` for the **plan / visual** paths (Continuity model) · (d) `retentionPolicy` (Task boundary, shared by code/design).
>
> **Removed symbols** covered by this document (grep must return 0 hits): `jobConversation` / `compressHeavyweightEntries` / `CODE_JOB_COMPACTION_THRESHOLD` / `CODE_JOB_COMPACTION_WINDOW` / `DESIGN_JOB_COMPACTION_THRESHOLD` / `DESIGN_JOB_COMPACTION_WINDOW` / `common/compaction/job-summary.md` / `code/base/injections/job-history.md` / `design/base/injections/job-history.md`. Read the corresponding passages below as historical background only.

---

## 1. 4-Tier Conversation Hierarchy

| Term | Definition |
|---|---|
| **Session** | A feature-scoped development session. One feature directory = one Session. The top-level container spanning the session files of multiple JobTypes. |
| **Job** | A unit of work with a single goal. Identified by `httpJobId` (Isolation) or by file path (Continuity). Contains N Runs. |
| **Run** | One BullMQ job execution = one process spawn. One cycle of session load → processing → session save. Recorded as `SessionRun` in code. |
| **Turn** | One LLM call-response pair of the ReAct loop within a Run. The unit returned by `groupMessagesIntoTurns()`. May contain `tool_use`. |

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

A mechanism for carrying context between Jobs while preserving Code/Design's Context Isolation.

**Core concepts:**
- `session.state.jobConversation: ConversationEntry[]` — a cumulative array of Job completion records
- On each Job completion, 2 entries are appended (user: directive, assistant: result)
- The existing `conversationHistory` discard policy is unchanged — jobConversation is a separate channel

**Boundary Classification:**

| Classification | Meaning | Decided at |
|---|---|---|
| **Heavyweight** | Complex work with inter-task isolation applied. Low value in preserving raw context | decompose (pre-determined or LLM judgment) |
| **Lightweight** | Cohesive work whose raw context is valuable as-is | decompose (pre-determined or LLM judgment) |

**Dual-Trigger Compaction (all compression happens in the next Job's resolve):**
- **Trigger 2 (Heavyweight)**: replace uncompressed heavyweight entries with an LLM summary (`compressHeavyweightEntries`)
- **Trigger 1 (Threshold)**: when total `jobConversation` tokens exceed the threshold, MECE-compress via `compactJob`

**Data flow:**
1. learn: append the raw record only (no LLM call)
2. Next Job's resolve: load jobConversation → Trigger 2 → Trigger 1 → persist
3. decompose: inject the compacted jobConversation into the prompt via the `job-history` partial

**Prompts:**
- `common/compaction/job-summary.md` — for Trigger 2 heavyweight summarization
- `code/base/injections/job-history.md` — injected into Code decompose
- `design/base/injections/job-history.md` — injected into Design decompose

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

## 3. Data Formats

| Format | Tier | Used by | Structure |
|---|---|---|---|
| `ConversationMessage[]` | Run (Turn) | `conversationHistory` graph state, `historyManager` | `{ role, content: string \| MessageContentBlock[] }` |
| `ConversationEntry[]` | Job (semantic) | Plan/Visual `state.conversation` | `{ role: 'user'\|'assistant'\|'system', content, timestamp, metadata? }` |

`ConversationMessage[]` is the LLM message format (including tool_use/tool_result blocks); `ConversationEntry[]` is a human-readable summary format. The `system` role is used for chapter markers (Visual deliver) and compaction summaries (persist pruning).

---

## 4. Pruning Mechanism Inventory

| Mechanism | Tier | LLM? | Target data format | Role |
|---|---|---|---|---|
| `compactTurns` | Turn | No | `ConversationMessage[]` | Replace cold turns with fact summaries |
| `pruneTurns` | Turn | No | `ConversationMessage[]` | Priority-based turn deletion |
| `compactRun` | Run (orchestrator) | No | `ConversationMessage[]` | Runs the two above in order |
| `compactJob` | Job (prompt) | **Yes** | `ConversationEntry[]` etc. | LLM-based session conversation summarization |
| `applyCompactionToConversation` | Job (persist) | No | `ConversationEntry[]` | Apply compactJob results to the session file |
| `retentionPolicy` | Task | No | - | Retain/discard decision on task transition |

### 4.1 compactTurns (Turn)

When the token threshold is exceeded, replaces cold turns with rule-based fact summaries. Extracts structural facts (file creation/edits, command executions, errors) from tool_use/tool_result blocks without any LLM call.

- Threshold: 50,000 tokens
- Hot tail: preserves the 5 most recent turns
- Summaries are inserted as assistant+user message pairs (preserving API alternation)

### 4.2 pruneTurns (Turn)

Priority-based turn deletion. Preserves a minimum of N recent turns; error/setup turns get priority.

- Default budget: 75,000 tokens
- Minimum retention: 3 turns
- Priority: error (+10), setup (+5), large result (-5)

### 4.3 compactRun (Run orchestrator)

A pipeline that runs the two stages above in order:
1. compactTurns → 2. pruneTurns

### 4.4 compactJob (Job — prompt)

LLM-based session conversation summarization. Targets `ConversationEntry[]`; older entries are summarized by the LLM.
- Used by Plan/Visual (replaces the former rule-based `pruneSession`)
- `CompactionResult<T>`: `{ entries, summary?, wasCompacted, tokensBefore, tokensAfter }`
- The caller decides the summary rendering format → compatible with existing prompt formats
- Prompt: `common/compaction/system.md` (injected via PromptPort, MECE preservation strategy)
- MECE preservation categories: **Agreements** (confirmed), **Artifacts** (deliverables), **Open Items** (unresolved)
- Design based on the Claude Code benchmark: the "structured checklist → working state" pattern

### 4.4b applyCompactionToConversation (Job — persist)

Applies the compactJob result to the conversation array on session save. No additional LLM call.
- Receives `ConversationCompaction { summary, summarizedCount }` metadata
- Replaces the first `summarizedCount` entries of the conversation with a single `system` summary entry
- Supports progressive summarization: a previous summary entry can itself become a compactJob target again

### 4.5 retentionPolicy (Task)

Context Isolation only. Decides whether to preserve/compact/discard conversation history on task transition.
- Code: always discard
- Design system-design (same targetFile): compact
- Design ui-design: discard (uses disk-based loadPreviousUiDocs)

---

## 5. Per-Job Application Matrix

### Current State

|  | compactRun | compactJob (prompt) | applyCompactionToConversation (persist) | retentionPolicy | Inter-Job Context Bridge |
|---|---|---|---|---|---|
| Code (Isolation) | O | O (jobConversation, 8K threshold) | O (jobConversation) | O | O (resolve: Trigger 2 + Trigger 1) |
| Design (Isolation) | O | O (jobConversation, 8K threshold) | O (jobConversation) | O (spec: explicit discard) | O (resolve: Trigger 2 + Trigger 1) |
| Plan (Continuation) | O (50K budget) | O (LLM-based, 12K threshold) | O | - | - |
| Visual (Continuation) | X (tool loop ephemeral) | O (LLM-based, 6.4K threshold) | O | - | - |

Why Visual does not need compactRun: `streamWithToolLoop`'s `currentMessages` is a function-local variable that vanishes after at most 5 rounds. It is never stored in graph state or the session, so there is no cross-invocation growth.

### Future Improvements

| Item | Current | Goal | Notes |
|---|---|---|---|
| Per-JobType compaction headroom UI | Not applied | Show a circular progress gauge in the chat panel | estimateTokens(jobConversation) / threshold |
| Manual compaction (Manual Trigger 1) | Not applied | A "Compact" button in the UI | Requires a new API endpoint |

---

## 6. Common Pipeline: compactRun

```
compactTurns (Turn)
  → pruneTurns (Turn)
```

`compactRun` takes `ConversationMessage[]` (the LLM message format) as input and runs the 2-stage pipeline in order. Respects the TokenBudgetManager budget.

### Call Sites

| Call site | Data | When |
|---|---|---|
| Code/Design prompt builders | `conversationHistory` | Before LLM call |
| Plan generateNode | `conversationHistory` | Before LLM call + before session save |
| `applyRetention` (Isolation) | `conversationHistory` | On task transition |

---

## 7. Differentiation Mechanisms

### retentionPolicy (Context Isolation)

Decides whether to preserve/discard conversation history on task transition. Calls `compactRun` internally (when the decision is compact).

| Condition | Decision |
|---|---|
| Code (all cases) | discard |
| Design + no next task | discard |
| Design + system-design + same targetFile | compact |
| Design + system-design + different file | discard |
| Design + ui-design | discard |
| Design + spec | discard (goal: explicit branch) |

### compactJob (Context Continuity)

Job-level LLM-based conversation summarization. Receives the `common/compaction/system.md` template via PromptPort.

| Job | Threshold | Window | Notes |
|---|---|---|---|
| Plan | 12,000 tokens | 4 most recent entries | conversation context inside the system prompt |
| Visual | 6,400 tokens | 3 most recent entries | conversation context inside the user prompt |

**MECE preservation strategy**: based on the Claude Code benchmark. All meaningful information is classified into 3 categories:

| Category | What is preserved | Claude Code equivalent |
|---|---|---|
| **Agreements** | Decisions, constraints, requirements, scope | User intent + Technical decisions + Errors & fixes |
| **Artifacts** | Created files, saved assets, documents, paths | Files touched & why |
| **Open Items** | Unresolved questions, pending decisions, next work | Pending tasks + Next step |

**Persist Pruning**: `applyCompactionToConversation` is applied on session save to prevent unbounded conversation growth.
- Visual: uses the `finalState._conversationCompaction` metadata in `graph.ts`
- Plan: the `compactionMeta` local variable inside `generateNode` is passed to `saveConversationToSession`

**Progressive Summarization**: a previous summary entry (role='system') becomes a compactJob target again, yielding natural multi-stage summarization behavior.

---

## 8. core/context/ Module Structure

```
packages/ant-cli/src/core/context/
├── types.ts              ← types + shared helpers (groupMessagesIntoTurns, isErrorContent)
├── constants.ts          ← all constants
├── compactTurns.ts       ← (Turn)
├── pruneTurns.ts         ← (Turn) TurnPruner
├── compactRun.ts         ← (Run) orchestrator
├── compactJob.ts         ← (Job) LLM compaction
├── retentionPolicy.ts    ← (Task) retention
└── index.ts              ← barrel
```

### Dependency Graph

```
compactTurns → types
pruneTurns → types, tokenBudget
compactRun → compactTurns, pruneTurns, tokenBudget, constants
compactJob → types, constants, llmPort, promptPort
retentionPolicy → compactRun, types, tokenBudget
```

No circular dependencies.

### Re-export Bridges

Bridge files are provided to keep existing external imports working:

- `core/utils/historyManager.ts` → re-exports `compactRun`, `compactTurns`, and types
- `core/utils/conversationRetention.ts` → re-exports `retentionPolicy`

---

## 9. Token Constants

| Constant | Value | Used for |
|---|---|---|
| `DEFAULT_COMPACT_TURNS_THRESHOLD` | 50,000 | compactTurns trigger threshold |
| `DEFAULT_COMPACT_TURNS_HOT_TAIL` | 5 | compactTurns default hot tail |
| `DEFAULT_PRUNE_TURNS_MAX_TOKENS` | 75,000 | pruneTurns default budget |
| `DEFAULT_PRUNE_TURNS_MIN_KEEP` | 3 | pruneTurns minimum retained turns |
| `PLAN_CONVERSATION_HISTORY_BUDGET` | 50,000 | Plan conversationHistory budget |
| `PLAN_COMPACTION_THRESHOLD` | 12,000 | Plan compactJob trigger |
| `PLAN_COMPACTION_WINDOW` | 4 | Plan compactJob recent window |
| `VISUAL_COMPACTION_THRESHOLD` | 6,400 | Visual compactJob trigger |
| `VISUAL_COMPACTION_WINDOW` | 3 | Visual compactJob recent window |
| `COMPACTION_MAX_OUTPUT_TOKENS` | 16,384 | compactJob LLM max output |
| `CODE_JOB_COMPACTION_THRESHOLD` | 8,000 | Code Inter-Job Context compactJob trigger |
| `CODE_JOB_COMPACTION_WINDOW` | 3 | Code Inter-Job Context recent window |
| `DESIGN_JOB_COMPACTION_THRESHOLD` | 8,000 | Design Inter-Job Context compactJob trigger |
| `DESIGN_JOB_COMPACTION_WINDOW` | 3 | Design Inter-Job Context recent window |

---

## Key Files

| File | Role |
|---|---|
| `core/context/types.ts` | ConversationMessage, HistoryPruneConfig, CompactionResult, CompactionConfig |
| `core/context/constants.ts` | All token constants |
| `core/context/compactTurns.ts` | Turn-level rule-based summarization |
| `core/context/pruneTurns.ts` | Turn-level priority-based deletion |
| `core/context/compactRun.ts` | Run-level 2-stage orchestrator |
| `core/context/compactJob.ts` | Job-level LLM compaction + applyCompactionToConversation + ConversationCompaction |
| `core/prompt/templates/common/compaction/system.md` | compactJob prompt (MECE preservation strategy) |
| `core/prompt/templates/common/compaction/job-summary.md` | Trigger 2 heavyweight job summarization prompt |
| `core/prompt/templates/code/base/injections/job-history.md` | Job history partial injected into Code decompose |
| `core/prompt/templates/design/base/injections/job-history.md` | Job history partial injected into Design decompose |
| `core/context/retentionPolicy.ts` | Task-boundary retention (Isolation) |
| `core/utils/tokenBudget.ts` | TokenBudgetManager (model-aware area budgets — auto-scales to `getModelContextWindow(modelId)`, 200K fallback for unknown models) |
| `core/types/session.ts` | Session, SessionRun, ConversationEntry types |
| `core/schemas/session.schema.ts` | Zod validation schemas |
| `core/ports/session.ts` | SessionPort interface |
