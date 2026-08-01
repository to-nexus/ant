# 43 — Explore Subagent Pipeline

> Origin: local-caring-board RCA Track 2 (2026-07-15). A flat execute conversation
> carrying both evidence-gathering and authoring burned its recursion budget in a
> re-verification loop. The structural fix: parents delegate read-heavy
> investigation to async, in-process, read-only child LLMs and receive distilled
> reports.

## Surface

`explore(goal, hints?)` is an always-on tool in every job with a tool loop:

| Job | Parent phases | Child tool set (`TOOL_SETS.subagent*`) |
|---|---|---|
| code | plan / execute / decompose-inline / direct | `read_file, list_files, search_code, read_state` |
| design | plan / execute | `read_file, list_files, search_code, read_source_doc` |
| plan (planner) | plan / execute | `read_file, list_files, search_code` |
| ask | agent | ant-source + workspace readers |

detect / learn / visual are excluded (no tool loops / no delegation value).
There is **no enable flag** — only env tunables (`ANT_SUBAGENT_MAX_ROUNDS=12`,
`ANT_SUBAGENT_MAX_REPORT_CHARS=16000` (inline interface budget),
`ANT_SUBAGENT_MAX_REPORT_PERSIST_CHARS=100000` (card/drill-down ceiling),
`ANT_SUBAGENT_MAX_CONCURRENT=3` per
ownerKey, `ANT_SUBAGENT_TIMEOUT_MS=300000`, `ANT_SUBAGENT_JOIN_TIMEOUT_MS`,
`ANT_SUBAGENT_MAX_PENDING_AGE_MS`, `ANT_SUBAGENT_MAX_TOKENS=8192`,
`ANT_SUBAGENT_REASK_MAX_TOKENS=4096`; SSOT
[`config.ts`](../../packages/ant-cli/src/agents/common/subagent/config.ts)).

## Report compaction / decompaction

`ANT_SUBAGENT_MAX_REPORT_CHARS` is not the child's exploration budget but the
**parent-child interface size** (the report stays resident in the parent's
tool_result and is re-billed every subsequent round). Three-stage scheme:

1. **Child self-bounding (primary mechanism)** — `explore-system.md` announces a
   numeric budget via `{{reportBudgetChars}}`; the child compresses itself.
2. **compaction (safety net)** — on overflow, not a blind cut but
   [`compactReport.ts`](../../packages/ant-cli/src/agents/common/subagent/compactReport.ts):
   a lead (lead-with-answer) + **a heading outline of the entire full text (with
   char offsets)** + a drill-down notice. If there are <2 headings, fall back to
   head+tail. Compaction is a recoverable delivery compression, so it does
   **not** produce `[partial]`/`state:'partial'` (partial is reserved for round
   exhaustion / timeout).
3. **decompaction** — the full text is preserved in
   [`reportStore.ts`](../../packages/ant-cli/src/agents/common/subagent/reportStore.ts)
   (process-local, FIFO 30, same doctrine as the registry — loss on resume is a
   graceful miss), and the parent reads the full text via the
   **`subagent_report(id, offset?, maxChars?)`** tool (bundled with every preset
   that exposes explore; not included in the child set), jumping to a section or
   paging sequentially. The chat card metadata persists the full text, so human
   drill-down (overlay) is also lossless.

## Async pipeline (SSOT: `agents/common/subagent/`)

```
parent tool_use: explore ─▶ handlers/explore.ts ─▶ seam.launch() → launch-ack (immediate)
                                      │ registry entry {promise, ownerKey, delivered}
                                      ▼
                    SubagentRunner (reuses callLLMWithToolLoop, silentChatCards,
                    own maxRounds/timeout, never-throw → error-shaped report)
                                      │ settle {report, usage, modelId}
        ┌─────────────────────────────┘
        ▼ DRAIN — at every tool-round boundary
  createToolNode (factory level, shared by the 5 tool-node loops) or
  callLLMWithToolLoop.betweenRounds (decompose) / inline in the direct loop:
  append a "[SUBAGENT REPORT <id>]" block to the tool_result user message
  + foldSubagentUsage → explicit channel delta (defends against the
  unreturned-channel-drop class)
        ▼ JOIN — phase-end barrier
  parent tries to emit its final response (<done>/seal) while pending exist →
  done is withheld, await joinAll(timeout) → inject reports → re-enter the same
  node (1 super-step)
```

- **ownerKey** = `${jobId}:${workerScopeKey}` (`worker-N#task-K#pC` | `_main_`) —
  isolation between parallel task workers. On task completion,
  `checkTaskStatus` (serial+worker, code+design) drops leftover entries via
  `clearOwner` (blocks cross-task misdelivery caused by the shared serial
  `_main_`).
- **Join sites**: code execute done branch (router unchanged — reuses the
  no-tools+no-done re-entry rule), design execute done branch (precedes
  drainFinalize), planner execute finalization (`_subagentJoinRedo` channel +
  router self edge), ask agent finalization (same pattern), decompose
  `beforeFinalReturn`, inline in the direct loop.
- **Report handling at plan seal (sage-causing-rover C1/C2)**:
  - design plan **at seal time**: `drainSettledReportsAtSeal` — collects only
    **settled** reports non-blockingly (`collectCompleted`, no `joinAll`), then
    re-runs the plan LLM once in-node to fold in the findings and re-seal.
    **pending** children are not awaited; execute takes them over under the same
    ownerKey (existing contract preserved). code plan seal still does not join,
    as before.
  - design plan **fallthrough** (no `<plan>`, no toolCalls):
    `joinOwedReportsIntoHistory` returns the joined history and the plan node
    re-runs the loop **within the same node invocation** (code twin parity). The
    old delta-return was a collect-then-discard defect: `routeAfterPlan` saw the
    `toolCalls: []` cleared by the tool node and mis-routed to execute — after
    `collectCompleted` had already deleted the registry entry — so the injected
    NODE_PLAN was never read.
- **cycleSeq drift sweep (C3)**: transient task re-entry changes the ownerKey by
  INCRing `cycleSeq`. When `TaskWorker` picks up, it sweeps leftover entries of
  previous cycles via `clearOwnerByTaskPrefix` — orphaned acks converge via the
  pairing scan to a single LOST.
- **Accepted trade-off (C4)**: when execute reaches checkTaskStatus via a breaker
  path (no response / recursion drain / no-output), `clearOwner` drops entries
  without a join (`⚠️ Dropped N undelivered` log fingerprint). On abnormal
  termination paths the reports are stale, so this is intended behavior.
- **Depth-1**: explore is absent from the child's tool list (first line) + the
  seam strips `subagent: undefined` from childCtx (second line). Children are
  fully silent in chat (noop reporter + `silentChatCards`).
- **RAC**: code child reads pass through the same `computeRacScope`+`decideRacGate`
  closure as the parent — the 2-site symmetry of the RAC read gate (decompose
  inline + code tool node) is preserved invariant.

## Failure semantics (runner never throws)

| Mode | Report | Notes |
|---|---|---|
| LLM/tool error | `Exploration failed: … re-issue or read directly` (`error`) | Parent LLM decides recovery |
| Timeout / round exhaustion | `[partial] …` (`partial`) | Truncation does not belong here — see the compaction section above (`done` is kept) |
| **Degeneration (repetition loop)** | Three-line defense: (1) the final round keeps tools + `toolChoice:'none'` (no stripping — deleting the declarations is what caused GLM degeneration, sage-causing-rover RCA), (2) an in-stream repetition breaker (`StreamRepetitionTracker`, `core/utils/textRepetition.ts`) cuts the round early (~a few hundred tokens instead of the token cap), (3) **one corrective re-ask** — on top of the accumulated evidence (`finalMessages`), a corrective note + `toolChoice:'none'` + reduced cap (`ANT_SUBAGENT_REASK_MAX_TOKENS`=4096), within the single deadline (`subagentTimeoutMs`). On success: `[partial]` (non-exhaustiveness stated); on re-degeneration: failure notice (`error`) + the raw text is preserved in the store/card | The re-ask is not a verbatim retry — it states the failure reason (lapis-oaring-drain lesson) |
| Job stop | `[partial] aborted` (`aborted`) | `shouldAbort=isJobAborted` round polling + stream signal |
| Resume after crash/interruption | Orphaned launch-ack detected in history → inject `[SUBAGENT REPORT <id> — LOST]` | The marker is the pairing SSOT (self-idempotent). **The ack body must NOT contain the marker literal** |
| Concurrency exceeded | launch rejected (error tool_result) | |

### Delivery instrumentation — `subagent_drain` (sage-causing-rover secondary finding)

Every delivery seam (`createToolNode` drain / `maybeJoinSubagents` join / design
plan seal-drain) records a `subagent_drain` event in `log-{jobId}.json`
(`drainTrace.ts`): `{site, ownerKey, deliveredIds, deliveredStates,
orphanCount, pendingCount, phase}`. If report non-delivery recurs, the mechanism
can be identified from the session bundle alone. Mapping to console log
fingerprints:

| Console fingerprint | site |
|---|---|
| `📨 [Tool] Drained N subagent report(s)` | `tool-drain` |
| `🔀 [Subagent] Join delivered N report(s)` | `join` |
| `🔀 [DesignPlan] N subagent report(s) settled at seal time` | `seal-drain` |
| `⚠️ [checkTaskStatus] Dropped N undelivered …` | (C4 drop — no event) |

The `subagent_report` tool now preserves **every** non-empty report in the store
(FIFO 30 as the leak guard), and the miss message does not assert a cause
(it includes "may still be running" — the old "already completed" assertion
misled the parent in sage).

The Registry (`registry.ts`) is **single-process runtime state** holding promise
handles, not a mirror of Redis SSOT (same class as jobAbort.ts — unrelated to
the Unified Distributed System principle). No checkpoint schema change: the
durable protocol is the in-conversation ack↔marker pairing.

## Tokens / billing / model

- Child usage is only buffered in the registry entry — folded at the
  **drain/join sites (node context)** via `accumulateTokenUsage({modelId})`,
  then returned as an explicit channel delta. `currentPhaseTokenUsage` (the
  parent-context gauge) is deliberately not recorded — the child is a separate
  conversation, and adding it to the ring would distort it. A worker ring
  (`sub-N`) was not introduced (user-confirmed).
- Child model: `createLLMClient(_, _, {jobType, nodeType:'subagent'})` —
  `llmModels[job].subagent ?? llmModels[job].default` (BE-only slot, not exposed
  in the picker).

## Chat / UI contract

- `ChatStatusType`: `subagent_running` (progress — pending-card channel,
  refresh-tolerant spinner) + `subagent_report` (terminal — **persists the
  report body as metadata**, same pattern as plan cards). Registered in
  `LLMResponseService.PROGRESS_STATUS_TYPES` +
  `TOOLS_WITH_DEDICATED_STATUS('explore')`.
- Emit: `ChatAPIClient.subagentStart/Progress/Complete` — folded into a single
  launch card by cardId. There are no cards for the child's internal tool calls.
- FE: `SubagentCard` (spinner / per-state terminal, clickable only when a report
  exists) → on click, `openReportEditorTab` (uiSlice) mints a main-panel
  **editor tab**: `editor:report:{cardId}` (`makeReportEditorTabId`),
  `kind:'virtual'` / `readOnly:true` / `status:'ready'` (exempt from streaming
  purge) / `source:'report'`, body in `tab.content`. Rendering shares
  `VirtualDocumentViewer` (markdown pipeline) with the plan/design previews.
  There is no separate overlay component and no `chatSlice` open flag — the tab
  array is the only state. Do not add subagent_* to the
  `aggregateChatStatuses` FAMILIES.
- Tab action policy has a single source, `getEditorTabActionPolicy`. **Pin/unpin
  is real-tab only** (it is a migration between the path-keyed dedicated slot
  and the shared preview slot, so both store actions guard on
  `kind !== 'real'`). A virtual tab's `pinned:true` is merely a "not the preview
  slot" marker, so no pin toggle is exposed — and closing must not be
  suppressed either (the only exception is a virtual tab that is still
  streaming — the buffer sync recreates/refocuses it).
- Lifecycle: feature/project switches clear `editorTabs` via
  `applyIdentityTransition`. Chat clear / hard reset (`events_cleared`) closes
  all virtual tabs because the backing cards disappear (real file tabs are not
  chat-backed and are preserved).

## Prompt SSOT

- Delegation strategy: [`jobs/shared/injections/explore-delegation.md`](../../packages/ant-cli/src/core/prompt/templates/jobs/shared/injections/explore-delegation.md)
  — a single partial, `{{> }}`-included from the 19 node templates where explore
  is exposed (bypasses the resolver — deterministic wiring).
- Child system: [`jobs/shared/subagent/explore-system.md`](../../packages/ant-cli/src/core/prompt/templates/jobs/shared/subagent/explore-system.md).

## Regression guards

`packages/ant-cli/tests/subagent/` — registry (isolation / double-drain /
ceilings / joinAll), runner (never-throw / partial / truncation),
explore-handler + catalog pin (depth-1, read-only child set, exposure across the
4 jobs), drain-and-orphan (marker pairing / self-idempotence / **no marker
literal in the ack**), drain-toolnode (report placement / token delta survives
even a hookUpdates-ignoring buildReturn), token-fold (per-model attribution /
undeclared-channel guard / no gauge contact), tool-loop-options (drain/join
hooks / abort / bounded extension), join-and-chat-status (router flag / card
body), tool-loop-final-round (final round keeps tools + `toolChoice:'none'` +
in-stream breaker), runner-reask (corrective re-ask limited to once /
re-degeneration fallback), design-plan-join (C1 in-node consumption / C2
non-blocking seal-drain / C3 prefix sweep).
Adapter mapping: `tests/llm/tool-choice-and-stop.test.ts` (tool_choice across
the 3 providers + OpenAI `stop`); breaker heuristics:
`tests/utils/textRepetition.test.ts`. FE:
`packages/ant-ui/tests/chat/subagent*.test.tsx`.
