# Chat System

## Overview

The Chat system manages the conversation between the user and the AI agents. It consists of LLM streaming response handling, content merging, Choice Cards, and the Activity Indicator. The Job Worker accesses Redis directly to manage chat state.

## Service Separation

| Service | Location | Role |
|--------|------|------|
| LLMResponseService | Job Worker (child process) | LLM streaming handling, content merging, Redis save/publish |
| ChatService | API Server | Message CRUD, triage handling, appending user messages |
| MessageBroadcaster | Job Worker | user-scoped Redis Pub/Sub wrapper |

### Data Flow

```
LLM API -> LLM streaming chunks
    -> LLMResponseService (handled directly inside the child process)
        -> ContentMerger (content merging)
        -> SessionStore -> Redis SET (session save)
        -> MessageBroadcaster -> Redis PUBLISH (user-scoped channel)
    -> Realtime Server (subscribe) -> SSE -> ant-ui

API Server (ChatService):
    GET  /chat/messages        (fetch messages)
    DELETE /chat/messages      (delete messages)
    POST /chat/user-message    (append user message)
    POST /chat/triage-choice   (handle user choice)
    GET  /chat/pending-choice  (check pending choice)
```

The Job Worker accesses Redis directly without going through the API Server.

## Unified Message Content Types

`MessageContent.type` is a single union type expressing all chat content.

| Category | Types |
|----------|------|
| Chat Status (progress indication) | `placeholder`, `thinking`, `exploring`/`explored`, `retrieving`/`retrieved`, `grepping`/`grepped`, `reading`/`read`, `reading_source`/`read_source`, `indexing`/`indexed`, `analyzing`/`analyzed`, `loading`/`loaded`, `storing`/`stored`, `learning`/`learned`, `processing`/`processed`, `downloading`/`downloaded`, `figma_calling`/`figma_called` |
| General content | `text`, `cancelled`, `triage_choice`, `choice_card`, `context_loaded`, `task_response` |
| File operations (realtime) | `file_creating`/`file_writing`/`file_create`/`file_create_failed`, `file_editing`/`file_updating`/`file_edit`/`file_edit_failed`, `file_deleting`/`file_delete`/`file_delete_failed`, `file_conflict`/`file_conflict_retry` |
| Tool operations | `tool_action`, `listing_files`/`listed_files`, `searching_code`/`searched_code`, `searching_reference`/`searched_reference` |
| Command execution | `command_running`/`command_streaming`/`command` |
| Plan streaming | `plan_generating`/`plan` |

In-progress/completed pairs (e.g. `exploring`→`explored`) are matched automatically by ContentMerger's fallback merge. `INFORMATIONAL_TYPES` (`context_loaded`) can coexist with a placeholder.

## ContentMerger

An 8-stage processing pipeline, per the Universal Placeholder System, applied when new content is added:

| Priority | Case | Behavior |
|----------|--------|------|
| 1 | New placeholder + existing placeholder present | In-place replacement at the existing position |
| 2 | Non-informational content + placeholder present | Merge with the placeholder (placeholder disappears) |
| 3 | `_mergeIndex` metadata | Merge directly at the explicit index |
| 4 | Completion states (`explored`, `read`, etc.) | Backward search to merge with the matching in-progress state |
| 5 | Duplicate completion types | Ignore (dedup) |
| 6 | Thinking block transition | Compute duration, broadcast collapse |
| 7 | Same-type streaming | Append content (`text`, `thinking`, `plan_generating`, `task_response`, same file) |
| 8 | File operation completion | Update the in-progress card via `activeFileOperations` or type-based search |

A placeholder may exist at **any position** in the contents[] array (because informational types may be appended after it). All content additions MUST go through `ContentMerger.addContent()`.

## Markdown Rendering (UI)

Chat/cards/file previews use a common markdown renderer, and fenced code blocks with `language-mermaid` render as Mermaid SVG. If Mermaid rendering fails, the raw code block fallback is kept.

| Surface | Path |
|---|---|
| Turn assistant text | `packages/ant-ui/src/presentation/components/chat/TurnItem.tsx` |
| Task response card | `packages/ant-ui/src/presentation/components/chat/TaskResponseCard.tsx` |
| Choice card title | `packages/ant-ui/src/presentation/components/chat/choiceCard/shared.tsx` |
| File markdown preview | `packages/ant-ui/src/presentation/components/FileEditorPanel.tsx` |
| Common renderer | `packages/ant-ui/src/presentation/components/markdown/createMarkdownComponents.tsx` / `MermaidBlock.tsx` |

## Chat Activity Indicator (CAI)

A visual feedback system telling the user "the system is working".

### Design Principles

- Zero-Gap Feedback: no blank screen from Job start until the first LLM token
- Auto-Inject / Auto-Remove: placeholders are inserted/removed automatically
- Single Source of Truth: ContentMerger solely manages the placeholder lifecycle

### Placeholder Auto-Injection Points

| Point | Call path |
|------|----------|
| New assistant message starts | `LLMResponseService.startMessage()` -> `showChatStatus('placeholder')` |
| `<clarify>` tag detected | `XMLStreamParser` -> `clarify_start` -> `showChatStatus('placeholder')` |
| Environment detection starts | `detect()` -> `showChatStatus('placeholder')` |

### Frontend TypingIndicator Appearance Conditions

| Location | Condition |
|------|------|
| ChatHistory Footer | isRunning && !hasActiveStreamingAssistant |
| MessageItem (empty message) | isStreaming && contents.length === 0 |
| ShimmerCard (placeholder) | content.type === 'placeholder' && isStreaming |

Leftover placeholders on non-streaming messages are not rendered (defensive filtering).

## Preventing Message Loss on SSE Reconnection

When the SSE connection drops and recovers, the intermediate content of an in-flight streaming assistant message can be lost. To prevent this, the current session snapshot stored in Redis is synchronized with the frontend state on reconnection.

## Worker Scope · Task Scope · Section Ordering

The `workerScope` of a chat event is an identifier composed of **three dimensions**. The AsyncLocalStorage in `core/parallel/workerScope.ts` holds all three dimensions, and `TurnContext.getWorkerScopeKey()` serializes them into a single key.

| Situation | scope key |
|------|-----------|
| Main graph (no worker) | `_main_` |
| Parallel worker, outside a task | `worker-N` |
| Parallel worker, executing a task (first attempt) | `worker-N#task-K` |
| Parallel worker, executing a task (re-entry cycle) | `worker-N#task-K#p{cycleSeq}` |
| Cancelled choice card | `_cancelled_:{cardId}` |

`task-K` is stable via `task.id` (or `task.name` as fallback). `TaskWorker.executeTask` overlays the per-task scope with `runInTaskScope(taskKey, cycleSeq, …)` inside `runInWorkerScope(workerId, …)`. Thanks to this two-level wrapping, every chat event — LLM emits, file ops, tool calls — automatically receives the correct identifier.

### `cycleSeq` SSOT — task lifecycle entry cycle

`cycleSeq` is the **lifecycle entry index of a task**. When `TaskWorker.executeTask` picks up a task, if a re-entry marker is present (`task.interrupted === true` or `task._failedAttempts > 0`) it INCRs and receives via `StateStorePort.nextWorkerCycleSeq(turnId, taskKey)`; on a fresh entry with no marker it only peeks via `getCurrentWorkerCycleSeq`. The Redis key is `ant:chat:cycleSeq:{turnId}:{taskKey}` (per-(turn, task) isolation, 24h TTL).

All 3 INCR trigger sources set the `task.interrupted = true` marker, so the single call site (TaskWorker.executeTask) is the SSOT:

| Source | Where the marker is set |
|--------|----------------|
| User Stop + Resume | `handleInterruption` / the checkpoint path preserves the task in the queue with `interrupted: true` |
| batchSplit Path A requeue (verification) | `requeuedTask = { ...nextTask, interrupted: !!snapshot ? true : undefined, ... }` in [`tasks/_shared/batchSplit/process.ts`](packages/ant-cli/src/agents/architect/graph/code/tasks/_shared/batchSplit/process.ts) |
| TaskOrchestrator transient retry | `task.interrupted = true; this.taskQueue.push(task)` in [`parallel/TaskOrchestrator.ts`](packages/ant-cli/src/agents/architect/graph/code/parallel/TaskOrchestrator.ts) |

On the first attempt (no marker), cycleSeq=0 is returned and the suffix is omitted, so the key `worker-N#task-K` is identical to the two-dimension form — the schema BC of chat.jsonl lines is preserved.

### `pauseSeq` ↔ `cycleSeq` — intentional separation (not a code smell)

The two counters only look alike in being monotonic INCRs; their responsibilities differ — do not merge them.

| | `pauseSeq` (`CANCELLED_PAUSE_SEQ`) | `cycleSeq` (`WORKER_CYCLE_SEQ`) |
|---|---|---|
| Redis key | `ant:chat:pauseSeq:{turnId}` | `ant:chat:cycleSeq:{turnId}:{taskKey}` |
| Responsibility | cancelled cardId uniqueness | worker scope suffix → FE section + WorkerLocalState slot isolation |
| INCR trigger | User Stop (`ChatService.appendChoicePresentedCancelled`) | Every task re-entry (`TaskWorker.executeTask`) |
| Isolation unit | Whole turn | (turn, task) pair |

A cancelled cardId must be unique across all tasks within one turn, so a turn-level counter suffices; but worker scope isolation must be independent per task, so a (turn, task) composite key is needed. If the two responsibilities were bound to one counter (the previous design), re-entry sources other than Stop (batchSplit / orchestrator retry) could not bump cycleSeq and would carry a stale `WorkerLocalState` slot — this RCA was the bug where file/command/thinking cards updated near the top of the chat on verification re-entry.

### `_cancelled_:{cardId}`

`_cancelled_:{cardId}` is a synthetic scope stamped directly by `ChatService.appendChoicePresentedCancelled`, not by AsyncLocalStorage. Because the cardId includes pauseSeq, each cancellation is separated into an independent section even when pause-resume happens multiple times within one turn. The paired `choice_resolved` stays in the same section because `findTurnIdByCardId` surfaces the scope from the original presented line. The cardId is independent of cycleSeq (it uses pauseSeq only) — the separation of the two counters' responsibilities naturally preserves the cardId schema BC.

### Why Three Dimensions

- **`workerId` (axis 1)**: the identifier of the long-lived TaskWorker loop.
- **`taskKey` (axis 2)**: per-cohort section separation when one worker finishes task A of cohort 1 and picks up task B of cohort 2. Without it, cohort 2 messages appear higher in the scroll than cohort 1 messages of another worker that already finished — a time inversion (the `rigid-fanning-faith` regression).
- **`cycleSeq` (axis 3)**: even after a task goes through re-entry (Stop/Resume, batchSplit Path A, orchestrator transient retry), `task.id` stays the same, so omitting it causes two regressions simultaneously —
  1. **FE section anchoring** (`even-getting-knave`): events from all cycles accumulate in one section, so the first ts is permanently anchored at the first attempt. The cancelled card's first ts (= the Stop moment) is always later, so after chronological sorting the cancelled section lands *below* the worker section and gets "pinned" right above the chat input.
  2. **WorkerLocalState slot reuse** (the verification re-entry stale-card RCA): `LLMResponseService.workerStates: Map<workerScopeKey, WorkerLocalState>` reuses the previous cycle's `fileCardByPath` / `commandCardByCommand` / `thinking` cardId cache under the same key. The next cycle's terminal `chat_status` is emitted with the old cardId, and the FE folds the same cardId into one card (last-write-wins, first-appearance position) → file/command/thinking cards higher up in the chat (scroll history) appear to update with the new cycle's results. When cycleSeq receives a new value, `Map.get` creates a new slot and isolation is automatic.

### FE Section Ordering

`selectTurns` builds sections per `workerScope` within a turn and orders them with these rules:

1. `_main_` always comes first (turn-level orchestration narrative).
2. All other sections are ordered by first event timestamp, ascending.
3. Ties are broken by `workerScope.localeCompare`.
4. A cancelled choice card receives the synthetic `_cancelled_:{cardId}` scope from the BE. Its first event ts is exactly the moment the user pressed Stop, so by rule 2 it naturally lands **below** the earlier worker output. Right after Resume, when the worker starts its next task attempt, `cycleSeq` increments by 1 and the worker scope becomes `worker-N#task-K#p1`; that new scope's first ts is later than the cancelled scope's, so as more output arrives the cancelled card is pushed upward. In other words, this rule does not hold without cycleSeq — that dependency was the essence of the `even-getting-knave` regression.

`TurnItem.parseScope` suppresses the worker label header for the two synthetic scopes, `_main_` and the `_cancelled_:` prefix. The cancelled card is itself a visually self-contained ChoiceCard, so exposing a scope label would only be noise. The cycleSeq suffix (`#p{n}`) passes through as part of the worker label so that which cycle produced the output can be identified when debugging.

## Choice Card

### Variants

| Variant | Purpose |
|---------|------|
| `triage_choice` | Work routing choice |
| `cancelled` | Resume/ignore after work cancellation |
| `eval_save` | Save an evaluation report |
| `spec_complete` | Confirm spec completion |
| `clarifying` | Multiple questions during PRD generation (Compound Card) |

### Compound Clarifying Card

Bundles N questions into a single card. Supports per-question option buttons and inline free-text input. Submittable once 1+ responses are given (partial allowed). All selections are stored in the Zustand `pendingClarifyAnswers` and shared with ChatInput.

### Cancelled Card NX semantics — release-on-failure

The `ant:chat:cancelled-emitted:job:{jobId}` NX guard in `ChatService.appendChoicePresentedCancelled` means **"skip the second attempt once it has been SUCCESSFULLY emitted"** — not simply "skip once attempted". If emission throws after acquire (Redis blip / chat.jsonl write race / `autoResolveStaleCancelledCards` failure, etc.), the lock is released immediately in try/finally so the next pause source can retry. On the success path, the 24h NX remains intact, preserving the multi-source idempotency contract (preventing duplicate cards when StaleJobRecovery / the BullMQ stalled handler / ServerLifecycleManager fire concurrently).

Regression when the release is missing: if a case arises where NX was set but the line emit failed (as when the previous bug — a single outer try/catch in cleanupJobState swallowing the emit throw — was present), every cancelled card attempt for the same jobId is silently skipped for the 24h TTL (the `cancelled-card-stale-NX` RCA — observed in `vast-curling-perch`, fixed in commit `8ea931b8` + the ChatService release-on-failure). Regression guard: the 4 `release-on-failure (a~d)` cases in [`tests/http/chatService.test.ts`](packages/ant-cli/tests/http/chatService.test.ts).

## Boundaries

- Redis Pub/Sub channels: [02-infrastructure.md](02-infrastructure.md)
- SSE connections and broadcasting: [21-realtime-system.md](21-realtime-system.md)
- Triage Choice: [12-triage-routing.md](12-triage-routing.md)
- Planner Clarify: [16-planner-job.md](16-planner-job.md)
