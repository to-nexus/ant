# 28. In-Job Compaction (conversation history)

SSOT for how conversation history is compacted **inside** a job: the 4-tier
conversation hierarchy, the `compactRun` turn pipeline, LLM compaction for the
Continuity jobs, and the task-boundary retention policy.

Related code: [`core/context/`](../../packages/ant-cli/src/core/context/)

**Scope boundary** — three documents divide context management along different
axes; do not duplicate content between them:

| Axis | Document |
|---|---|
| **in-job** — history inside one job | **this document** |
| **cross-job** — context carried between jobs (Context Lens) | [`37-context-management.md`](./37-context-management.md) |
| **session storage** — `feature.jsonl` / `trace.jsonl`, the three orthogonal axes | [`18-session-redesign.md`](./18-session-redesign.md) |

---

## 1. 4-Tier Conversation Hierarchy

| Term | Definition |
|---|---|
| **Session** | A feature-scoped development session. One feature directory = one Session. The top-level container spanning the session files of multiple JobTypes. |
| **Job** | A unit of work with a single goal. Identified by `httpJobId` (Isolation) or by file path (Continuity). Contains N Runs. |
| **Run** | One BullMQ job execution = one process spawn. One cycle of session load → processing → session save. Recorded as `SessionRun` in code. |
| **Turn** | One LLM call-response pair of the ReAct loop within a Run. The unit returned by `groupMessagesIntoTurns()`. May contain `tool_use`. |

### Code mapping

| Code | Tier |
|---|---|
| feature directory (`sessions/`) | **Session** |
| `Session` type, session file | **Session** (Isolation) / **Job** (Continuity) |
| `httpJobId` | **Job** ID (Isolation) / **Run** ID (Continuity) |
| `SessionRun` | **Run** |
| `Session.runs` | Run list |
| `groupMessagesIntoTurns()` output | **Turn** list |

---

## 2. Two strategies

| Strategy | Jobs | Shape | History between units |
|---|---|---|---|
| **Context Isolation** | code, design | 1 Session : N Jobs : M Runs | Discarded at the task boundary — artifacts on disk are the state. Enables parallel execution, independent retry, context freshness. |
| **Context Continuity** | plan, visual | 1 Session : 1 Job : N Runs | Preserved across Runs via `conversationHistory` + `conversation`; needs compaction to stay bounded. |

Cross-job carry-over for code/design is **not** part of this axis — it is the
Context Lens (`feature.jsonl`), documented in
[`37-context-management.md`](./37-context-management.md).

### Data formats

| Format | Tier | Used by | Structure |
|---|---|---|---|
| `ConversationMessage[]` | Run (Turn) | `conversationHistory` graph state | `{ role, content: string \| MessageContentBlock[] }` |
| `ConversationEntry[]` | Job (semantic) | Plan/Visual `state.conversation` | `{ role: 'user'\|'assistant'\|'system', content, timestamp, metadata? }` |

`ConversationMessage[]` is the LLM message format (including
`tool_use`/`tool_result` blocks); `ConversationEntry[]` is a human-readable
summary format. The `system` role marks chapter boundaries (Visual deliver) and
compaction summaries.

---

## 3. Mechanism inventory

| Mechanism | Tier | LLM? | Target format | Role |
|---|---|---|---|---|
| `compactTurns` | Turn | No | `ConversationMessage[]` | Replace cold turns with rule-based fact summaries |
| `pruneTurns` | Turn | No | `ConversationMessage[]` | Priority-based turn deletion |
| `compactRun` | Run (orchestrator) | No | `ConversationMessage[]` | Runs the two above in order |
| `compactJob` | Job (prompt) | **Yes** | `ConversationEntry[]` | LLM conversation summarization (Continuity only) |
| `applyCompactionToConversation` | Job (persist) | No | `ConversationEntry[]` | Write the `compactJob` result back to the session file |
| `retentionPolicy` | Task | No | `ConversationMessage[]` | Retain / compact / discard on task transition (Isolation only) |

---

## 4. `compactRun` — the Run pipeline

```
compactTurns (Turn)  →  pruneTurns (Turn)
```

Takes `ConversationMessage[]` and runs both stages in order, respecting the
`TokenBudgetManager` budget.

**`compactTurns`** — when the token threshold is exceeded, replaces cold turns
with rule-based fact summaries. Extracts structural facts (file writes, command
executions, errors) from `tool_use`/`tool_result` blocks with no LLM call.
Summaries are inserted as assistant+user pairs so API role alternation holds.

**`pruneTurns`** — priority-based deletion, keeping a minimum recent window.
Priority weights: error `+10`, setup `+5`, large result `-5`.

### Call sites

| Call site | Data | When |
|---|---|---|
| code `plan` node | carry history | Before LLM call |
| plan `execute` / `plan` / `sessionWriter` | `conversationHistory` | Before LLM call + before session save |
| `applyRetention` (Isolation) | `nodeHistory` | On task transition |

---

## 5. `compactJob` — LLM compaction (Continuity only)

Targets `ConversationEntry[]`; older entries are summarized by the LLM while a
recent window is kept verbatim. Returns
`CompactionResult<T> { entries, summary?, wasCompacted, tokensBefore, tokensAfter }` —
the caller owns the summary rendering format.

Prompt: [`infra/compaction/system.md`](../../packages/ant-cli/src/core/prompt/templates/infra/compaction/system.md),
rendered via `promptPort.render('infra/compaction/system', …)`.

| Job | Threshold | Recent window | Conversation context lives in |
|---|---|---|---|
| Plan | `PLAN_COMPACTION_THRESHOLD` 12,000 | 4 entries | system prompt |
| Visual | `VISUAL_COMPACTION_THRESHOLD` 6,400 | 3 entries | user prompt |

**MECE preservation strategy** — every meaningful item is classified into
exactly three categories, so nothing is both dropped and double-kept:

| Category | What is preserved |
|---|---|
| **Agreements** | Decisions, constraints, requirements, scope |
| **Artifacts** | Created files, saved assets, documents, paths |
| **Open Items** | Unresolved questions, pending decisions, next work |

**Persist pruning** — `applyCompactionToConversation` runs on session save so
the stored conversation cannot grow without bound. It replaces the first
`summarizedCount` entries with a single `system` summary entry. Call sites:
plan `sessionWriter.ts`, visual `runner.ts`.

**Progressive summarization** — a previous summary entry (`role: 'system'`) is
itself eligible for the next `compactJob`, which yields multi-stage
summarization for free.

Why Visual needs no `compactRun`: `streamWithToolLoop`'s `currentMessages` is a
function-local that dies with the call. It never reaches graph state or the
session, so there is no cross-invocation growth.

---

## 6. `retentionPolicy` — the task boundary (Isolation only)

`decideRetention(ctx)` is the single decision site; `applyRetention(ctx)`
executes it (calling `compactRun` for `compact`). Evaluated in order:

| Condition | Decision |
|---|---|
| `jobType === 'code'` | `discard` — artifacts are the state |
| no next task | `discard` |
| `intentGroup === 'design-spec'` | `discard` — spec uses accumulated doc artifacts |
| `intentGroup === 'design-ui'` | `discard` — loads previous docs from the artifact pool |
| `intentGroup === 'design-game-art'` | `discard` — loads previous catalogs from the artifact pool |
| `intentGroup === 'design-system'` + same `targetFile` | `compact` — continuation of one document |
| `intentGroup === 'design-system'` + different `targetFile` | `discard` |
| fallback (unknown intent group) | `discard` |

`compact` runs `compactRun` with a tightened override
(`autoCompactThreshold: 30000`, `autoCompactHotTail: 2`) rather than the
Run-level defaults.

---

## 7. Token constants

Defined in [`core/context/constants.ts`](../../packages/ant-cli/src/core/context/constants.ts).

| Constant | Value | Used for |
|---|---|---|
| `DEFAULT_COMPACT_TURNS_THRESHOLD` | 50,000 | `compactTurns` trigger |
| `DEFAULT_COMPACT_TURNS_HOT_TAIL` | 5 | `compactTurns` hot tail |
| `DEFAULT_PRUNE_TURNS_MAX_TOKENS` | 75,000 | `pruneTurns` budget |
| `DEFAULT_PRUNE_TURNS_MIN_KEEP` | 3 | `pruneTurns` minimum retained turns |
| `PLAN_CONVERSATION_HISTORY_BUDGET` | 50,000 | Plan `conversationHistory` budget |
| `PLAN_COMPACTION_THRESHOLD` / `_WINDOW` | 12,000 / 4 | Plan `compactJob` |
| `VISUAL_COMPACTION_THRESHOLD` / `_WINDOW` | 6,400 / 3 | Visual `compactJob` |
| `COMPACTION_MAX_OUTPUT_TOKENS` | 16,384 | `compactJob` LLM max output |

---

## Key files

| File | Role |
|---|---|
| `core/context/types.ts` | `ConversationMessage`, `CompactionResult`, `groupMessagesIntoTurns` |
| `core/context/constants.ts` | Token constants |
| `core/context/compactTurns.ts` | Turn-level rule-based summarization |
| `core/context/pruneTurns.ts` | Turn-level priority deletion |
| `core/context/compactRun.ts` | Run-level 2-stage orchestrator |
| `core/context/compactJob.ts` | Job-level LLM compaction + `applyCompactionToConversation` |
| `core/context/retentionPolicy.ts` | Task-boundary retention |
| `core/prompt/templates/infra/compaction/system.md` | `compactJob` prompt (MECE strategy) |
| `core/utils/tokenBudget.ts` | `TokenBudgetManager` — model-aware area budgets, auto-scaled to `getModelContextWindow(modelId)` |
| `core/types/session.ts` | `Session`, `SessionRun`, `ConversationEntry` |
