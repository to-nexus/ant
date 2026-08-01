# 18. Session Redesign (Three Orthogonal Axes + 5-Tier Execution)

> **Status**: §3 Phases B–E implemented (2026-04-20). This document is the **architecture SSOT** for the session redesign, written in the `docs/internals/` tone. Any design/wiring change after that point updates this document first.
> **Code baseline**: `8277b313`

---

## 0. One-Line Summary

The **product set of three orthogonal axes** — Context (structure) × Mode (intent) × Complexity (scale) — is routed into **5 tiers**. Session storage is split into **2 files**: `feature.jsonl` (prompt-context SSOT) + `trace.jsonl` (UI-render SSOT). The previous `jobConversation` Inter-Job Context Bridge (28-context-management.md §2) has been **fully replaced** by this redesign.

---

## 1. The Three Orthogonal Axes

| Axis | Values | Decider | Decision point |
|---|---|---|---|
| **Context** (structure) | T1 Artifact / T2 user_turn / T3 Breadcrumb | Structural (file storage layer) | At `feature.jsonl` append time |
| **Mode** (intent) | `generate` / `refactor` / `explain` | **Detect node** (`ResolvedAction.mode`) | Just before Triage |
| **Complexity** (scale) | `oneshot` / `exploratory` / `task` | **Decompose node** (LLM 3-way classification) | Single decompose LLM call |

Design constraints:
- The three axes are **not interchangeable**. No axis implies another. (E.g. `explain` can be `task`, and `generate` can be `oneshot`.)
- Heuristics/overrules are **excluded**. The MVP trusts the LLM classification only (D10).
- Tier internals are uniform — executions landing in the same tier cell use the **same pipeline + same prompts** (D11). Prompts do not if/else-branch on runtime observations like `taskQueue.size` or touched counts.

---

## 2. Mode × Complexity Matrix → 5 Tiers

### 2.1 5-Tier definition

| Tier | Name | Mode | Complexity | Path | Characteristics |
|---|---|---|---|---|---|
| 0 | Reflex | `explain` | oneshot + 0–1 tools | `direct` (read-only) | Minimal cost, read-only tools only |
| 1 | One-shot | all | oneshot | `direct` | 1–2 step ReAct |
| 2 | Exploratory | all | exploratory | `direct` (ReAct) | Up to `ANT_DIRECT_MAX_STEPS` (=10) steps |
| 3 | Task | all | task | `decompose → plan → execute` | Existing full pipeline (per-mode Breadcrumb/Boundary branching lives only inside the tier constructors) |
| 4 | Plan | — | — | `design` / `plan` (separate job types) | Mode×Complexity not applied (D5) |

> **Terminology**: the literal `'task'` is the name that replaced the earlier `'todo'`. Renamed on 2026-04-21 to disambiguate from `TaskStatus='todo'` (the Kanban card state). `'todo'` literals in existing `feature.jsonl` lines are mapped to `'task'` at read time in `FileSessionAdapter.normalizeLegacyComplexity`.

### 2.2 Classification matrix (Decompose prompt output shape)

| Mode | Complexity | `<tasks>` | `<directHints>` |
|---|---|---|---|
| `explain` | oneshot | `[]` | `{ "explorationScope": "..." }` |
| `explain` | exploratory | `[]` | `{ "explorationScope": "..." }` |
| `explain` | task | 1 explain task (priority 200) | `{}` |
| `generate`/`refactor` | oneshot | `[]` | `{ "targetFiles": [...] }` |
| `generate`/`refactor` | exploratory | `[]` | `{ "explorationScope": "..." }` |
| `generate`/`refactor` | task | full breakdown | `{}` |

### 2.3 Metadata policy matrix (feature.jsonl records)

| Mode | Complexity | T2 (user_turn) | T3 (breadcrumb) | Boundary |
|---|---|---|---|---|
| `explain` | all | recorded | ❌ (T1 untouched) | ✅ for `task` only |
| `generate`/`refactor` | oneshot | recorded | ❌ | ❌ |
| `generate`/`refactor` | exploratory | recorded | `touched ≥ 3` → mini-BC | ❌ |
| `generate`/`refactor` | task | collapse (at boundary) | ✅ bubble-up | ✅ `auto_job_complete_todo` (on-disk literal kept for legacy compatibility) |
| `ask`/`inline-ask` | — | **not recorded** (never enters feature.jsonl) | ❌ | ❌ |

**Hard Reset** is a separate event independent of the axes — it is not an in-place collapse that appends a boundary line; instead it **physically unlinks** every session file in the `sessions/` tree (`feature.jsonl` · `trace.jsonl` · `architect/*.json` · `planner/*.json` · debug/runtime leftovers) via `clearCanonicalDirectory`. The next job starts from a completely empty state.

---

## 3. File Structure & SSOT Separation

### 3.1 Directory layout

```
{featurePath}/sessions/
├── feature.jsonl            ← NEW: context SSOT (T2 + T3 + boundary)
├── trace.jsonl              ← NEW: UI chat-render SSOT (all events)
├── architect/
│   ├── code.json            ← existing — resume checkpoint only (jobConversation field removed in legacy cleanup)
│   ├── design.json
│   └── learn.json
├── planner/
│   └── plan.json
└── creator/
    └── visual.json
```

### 3.2 Responsibility MECE

| File | Responsibility | Lifecycle | Consumer | Writer |
|---|---|---|---|---|
| `feature.jsonl` | Context SSOT for LLM prompt injection | Persistent (append-only, Collapse marking) | `resolve` node → `featureContextBuilder` | `FileSessionAdapter.appendUserTurn/Meta/Breadcrumb/Boundary` |
| `trace.jsonl` | UI chat-render SSOT | Persistent (append-only) | UI (`/trace` HTTP GET) | tool node / direct node / learn node |
| `architect/code.json` etc. | Resume checkpoint (session state) | Updated on job completion/failure | LangGraph runner (resume path) | `FileSessionAdapter.save/updateArtifacts` |

**Only user_turn is duplicated in both files.** feature.jsonl stores `text + mode`; trace.jsonl links via `text + sourceRef`.

### 3.3 Route mapping

| HTTP endpoint | File | Connected to |
|---|---|---|
| `GET /api/projects/:id/features/:feature/trace` | `trace.jsonl` | Activity view |
| `GET .../breadcrumbs` | `feature.jsonl` breadcrumb lines | Timeline view |
| `GET .../user-turn-meta` | `feature.jsonl` user_turn + user_turn_meta | Turn header badges |
| `POST .../context/reset` | `clearCanonicalDirectory(sessions/)` + Redis/Kanban cleanup | Hard Reset button (chat header 🗑️) |
| `DELETE .../chat/messages` | `collapseTraceOnly` (cleans UI chat only) | Sweep button (chat header 🔄) |
| `POST .../chat/decompose-choice` | session state | Spec Clarify 3-way response |

---

## 4. JSONL Schema Examples

### 4.1 feature.jsonl line types

```jsonc
// user_turn — user's original directive
{
  "type": "user_turn",
  "ts": "2026-04-20T09:12:03.421Z",
  "jobId": "job-a1b2c3",
  "turnId": "t-4f5e6d7c",
  "jobType": "code",
  "text": "Add dark mode toggle to the settings page.",
  "mode": "generate"
}

// user_turn_meta — complexity classification patch (appended by learn after decompose)
{
  "type": "user_turn_meta",
  "ts": "2026-04-20T09:12:45.108Z",
  "jobId": "job-a1b2c3",
  "turnId": "t-4f5e6d7c",
  "jobType": "code",
  "complexity": "task",
  "decidedBy": "llm",
  "reason": "multi-file feature spanning UI + theme context"
}

// breadcrumb — bubbled-up work-trace anchors
{
  "type": "breadcrumb",
  "ts": "2026-04-20T09:18:22.910Z",
  "jobId": "job-a1b2c3",
  "turnId": "t-4f5e6d7c",
  "jobType": "code",
  "mode": "generate",
  "scope": "modification",
  "anchors": {
    "specs": ["docs/ui-spec.md"],
    "paths": ["src/components/settings", "src/theme"],
    "files": ["src/components/settings/Toggle.tsx"]
  },
  "summary": "settings page: dark mode toggle wiring",
  "stats": { "created": 2, "modified": 5, "touched": 7 },
  "traceRangeRef": {
    "startTs": "2026-04-20T09:12:45.108Z",
    "endTs": "2026-04-20T09:18:22.000Z"
  }
}

// boundary — context boundary (at todo completion)
{
  "type": "boundary",
  "ts": "2026-04-20T09:18:23.001Z",
  "jobId": "job-a1b2c3",
  "turnId": "t-4f5e6d7c",
  "jobType": "code",
  "reason": "auto_job_complete_todo"
}

// Hard Reset does not append a boundary — instead it physically deletes every
// session file in the `sessions/` tree. See §2.3 for details.
```

### 4.2 trace.jsonl line types (summary)

| `type` | Fields | Writer |
|---|---|---|
| `user_turn` | `text`, `sourceRef` (`feature.jsonl#<turnId>` \| `ask-only`) | orchestrator `recordUserTurn` |
| `assistant_thinking` | `text` | direct/execute LLM streaming |
| `tool_call` | `tool`, `args`, `result`, `error?` | `ToolOrchestrator` (TraceAppender) |
| `file_write` | `path`, `operation: create\|update\|delete`, `content?`, `diffBefore?`, `diffAfter?`, `error?` | `FileOperationHandler` (SSOT emitting chat SSE + trace simultaneously) |
| `run_command` | `cmd`, `stdout`, `stderr`, `exitCode` | run_command tool handler |
| `job_status` | `phase`, `progress?`, `message?` | LLMResponseService |
| `assistant_message` | `text` | LLMResponseService (finalize) |
| `choice_presented` | `cardId`, `cardType`, `prompt?`, `payload?` | triage/decompose-clarify/eval-save etc. |
| `choice_resolved` | `cardId`, `choiceSelected`, `resolvedLabel`, `answer?` | choice route handler |

Common fields: `ts`, `jobId`, `turnId`, `jobType`, `collapsed?: true`.

Full type definitions: [`packages/ant-shared/src/session-log.ts`](../../packages/ant-shared/src/session-log.ts).

---

## 5. Runtime Mechanisms

### 5.1 Collapse vs Compact (orthogonal)

> **2026 update**: the auto-boundary (`reason: 'auto_job_complete_todo'`) is retired. This recovers from a regression where the automatic cut zeroed out the immediately-preceding work context for the next job. The only remaining boundary kind is Hard Reset (`reason: 'user_reset'`). At the same time, breadcrumbs were added to Compact's condensation targets — the earlier "breadcrumbs are never condensed" policy is retired.

| | Collapse | Compact |
|---|---|---|
| **Trigger** | At Hard Reset (`user_reset` boundary) append time (write) | At resolve-node read time (user_turn + breadcrumb combined tokens > `FEATURE_CONTEXT_THRESHOLD`) |
| **Target** | All user_turn / meta / breadcrumb lines before the Hard Reset | Old user_turns outside the window + breadcrumbs before the window cutoff |
| **Means** | Marking `collapsed=true` (file preserved) | LLM summary (MECE Agreements/Artifacts/Open items) → separate `FeatureContext.summary` field. Breadcrumbs condense into the `Artifact` category |
| **Cost** | I/O only (no LLM) | 1 LLM call (graceful degradation: returns raw form on failure) |
| **Implementation** | `FileSessionAdapter.appendBoundary` (+ Sweep-only `collapseTraceOnly` / Job-tab-X-only `collapseByJobId`) | `core/context/featureContextBuilder.ts#compactFeatureContext` |

For a feature.jsonl that already contains legacy `auto_job_complete_todo` boundaries, `loadSinceBoundary` ignores that reason, so context is restored automatically (no migration needed).

### 5.1.1 Per-tier strategy matrix (operation-per-strategy + Tier facade)

> **2026 update**: of the tier facade's original 4 channels (breadcrumb/boundary/collapse/compact), **boundary and collapse are retired** and removed from the facade interface. The remaining channels are `breadcrumb` (single FullBreadcrumb dispatch; the `mode='explain'` / `touched=0` guards are built into writeBreadcrumb) + `compact` (ThresholdLLM or NoopCompact) — two in total.

| Tier | Breadcrumb | Compact |
|---|---|---|
| 0 Reflex (`explain` × oneshot) | Full → auto-skipped (`mode=explain`) | Noop |
| 1 OneShot (any × oneshot) | Full (emitted if touched>0) | ThresholdLLM |
| 2 Exploratory (any × exploratory) | Full (emitted if touched>0) | ThresholdLLM |
| 3 Task — `generate`/`refactor` | Full (bubble-up) | ThresholdLLM |
| 3 Task — `explain` | Noop | ThresholdLLM |
| 4 Plan — `generate`/`refactor` | Full (bubble-up) | ThresholdLLM |
| 4 Plan — `explain` | Noop | ThresholdLLM |

The earlier matrix's "Mini-BC (touched ≥ 3)" gate is retired — the judgment was that even small changes (touched 1–2) provide enough navigation-pointer value for the next job.

**D11 invariant**: the "mode branching" in the table above happens **only in two places** — the `Tier3Task`/`Tier4Plan` constructors. Verification:

```bash
rg "mode === '(explain|generate|refactor)'|complexity === '(oneshot|exploratory|task)'" \
  packages/ant-cli/src/core/executionTier/tiers/ \
  --glob '!Tier3Task.ts' --glob '!Tier4Plan.ts'
# expect: 0
```

**Retired-symbol grep verification** (all must match 0):

```bash
rg "MINI_BREADCRUMB_TOUCHED_THRESHOLD|DEFAULT_BREADCRUMB_WINDOW" packages/ant-cli/src
rg "AutoCompleteBoundary|ExplainOnlyBoundary|AutoBoundaryBase" packages/ant-cli/src
rg "atBoundaryCollapse|AtBoundaryCollapse" packages/ant-cli/src
rg "MiniBreadcrumb|miniBreadcrumb" packages/ant-cli/src
rg "BoundaryStrategy|CollapseStrategy" packages/ant-cli/src
```

### 5.1.2 BC-write gate (`learn` node outer policy)

**The BC-write decision uses the turn-level signal (`turnTouchedAny`)**. Residual `state.violations` from a verification/error tail (=`taskFailed`) is for `interruption` marking only and does not affect BC writing. Any turn that changed even a single piece of code gets a BC recorded, even if its last task was a verification.

| Gate | SSOT | Effect |
|---|---|---|
| `isLastTask` | `nodes/learn/index.ts` | Once per turn boundary |
| `turnTouchedAny = touchedForLearn.all.size > 0` | `core/context/breadcrumb.ts#collectTouchedFilesFromChatLog` (chat.jsonl `file_*` SSOT) | The fact that code changed anywhere within the turn |
| `taskFailed = state.violations.length > 0` | — | **Not used for BC writing** (interruption marking only) |

The gate is factored into the pure function `evaluateBcGate` in [`nodes/learn/bcGate.ts`](../../packages/ant-cli/src/agents/architect/graph/code/nodes/learn/bcGate.ts), which also emits a one-line `📝 [Learn] BC eval — …` diagnostic log — the first SSOT to grep when a "zero BCs" report comes in. The 4 internal skip reasons (`mode='explain'` / `touched=0` / missing session / missing context) remain inside [`writeBreadcrumb`](../../packages/ant-cli/src/core/executionTier/strategies/breadcrumb.ts), and a silent failure of `appendBreadcrumb` itself is separately identified via the `⚠️ [Tier] appendBreadcrumb failed (jobId=…, turnId=…, touched=…)` warn — regression coverage is locked by the two files [`learn-bc-gate.test.ts`](../../packages/ant-cli/tests/graph/learn-bc-gate.test.ts) + [`silentSkipDiagnostics.test.ts`](../../packages/ant-cli/tests/core/executionTier/silentSkipDiagnostics.test.ts).

### 5.2 Breadcrumb Bubble-up (T3)

`core/context/breadcrumb.ts#buildBreadcrumb`:

| Touched count | Anchor shape |
|---|---|
| `≤ BREADCRUMB_THRESHOLDS.SMALL` (10) | `files[]` verbatim (max 10) |
| `≤ BREADCRUMB_THRESHOLDS.MEDIUM` (50) | Promoted top-level `paths[]` patterns (max 5) |
| `≤ BREADCRUMB_THRESHOLDS.LARGE` (200) | `specs[]` + top-level `paths[]` (≤ 3 / ≤ 5 each) |
| `> LARGE` | Promoted to `initial_creation` scope, `summary`-centric |

Scope determination: `mode === 'refactor'` → `refactor` takes precedence / `touched > LARGE` → `initial_creation` / otherwise → `modification`. The touched SSOT is the **`file_write` lines in `trace.jsonl`**.

### 5.3 Runtime Escalate (direct → decompose promotion)

The `shouldEscalate(state, touchedFiles)` gate inside the direct node's ReAct loop:

- Condition: `touched.size > PROMOTION_TOUCHED_THRESHOLD` (=3) **or** LLM `<needsEscalation>true</needsEscalation>` tag
- Cap: **once per job** (`state._promotedThisJob` flag) — on re-promotion, `routeAfterDirect` safely falls back to `learn`
- Triple guard: `_promotedThisJob` / LangGraph `recursionLimit` / `recursionCount` tracking
- Implementation: [`nodes/direct/shouldEscalate.ts`](../../packages/ant-cli/src/agents/architect/graph/code/nodes/direct/shouldEscalate.ts), `routeAfterDirect` at [`code/routing.ts`](../../packages/ant-cli/src/agents/architect/graph/code/routing.ts)

### 5.4 Spec Clarify (owned by Decompose)

When a `generate/refactor + todo` request has no spec, Decompose emits `<specClarify>` → exits via LangGraph `__end__` → the UI renders a 3-way choice card:

| action | Effect |
|---|---|
| `redirect_to_design` | Current code job → failed, design job enqueued with the same directive |
| `proceed_without_spec` | Records `_specClarifyBypassed=true` → resumes with `isResume: true` |
| `cancel` | `markUserStopped` + failed + idempotency lock release |

Trigger condition (4-way AND): `mode ∈ {generate, refactor}` ∧ `complexity === 'task'` ∧ no spec ∧ no system-design. The design-redirect responsibility formerly handled in Triage has been **fully moved** to Decompose (the `triage_scope_cleanup` change).

---

## 6. Key Constants (SSOT)

All exported from [`packages/ant-shared/src/session-log.ts`](../../packages/ant-shared/src/session-log.ts).

| Constant | Value | Purpose |
|---|---|---|
| `FEATURE_CONTEXT_THRESHOLD` | 12000 (tokens) | Compact trigger threshold (user_turn + breadcrumb combined; BCs are now condensation targets as well) |
| `FEATURE_CONTEXT_WINDOW` | 6 | Number of latest user_turns preserved on Compact (BCs are preserved alongside, keyed on the window-cutoff timestamp) |
| `BREADCRUMB_THRESHOLDS` | `{SMALL:10, MEDIUM:50, LARGE:200}` | Bubble-up boundaries |
| `BREADCRUMB_LIMITS` | `{specs:3, paths:5, files:10}` | Anchor count caps |
| `DIRECT_LOOP_LIMITS` | `{oneshot:2, exploratory:10}` | Direct-node ReAct loop caps (the latter overridable via `ANT_DIRECT_MAX_STEPS`) |
| `PROMOTION_TOUCHED_THRESHOLD` | 3 | Touched threshold for direct → decompose promotion |
| `BREADCRUMB_SUMMARY_TIMEOUT_MS` | 5000 | LLM summary call timeout (triggers the fallback) |

**Retired constants**: `MINI_BREADCRUMB_TOUCHED_THRESHOLD` (BCs are now emitted for every code change), `DEFAULT_BREADCRUMB_WINDOW` (the compact token budget is the single cut criterion).

---

## 7. Code Landmarks

| File | Role |
|---|---|
| `packages/ant-shared/src/session-log.ts` | Full FeatureLine / TraceLine types + constants SSOT |
| `packages/ant-cli/src/core/utils/sessionPaths.ts` | `getFeatureJsonlPath` / `getTraceJsonlPath` |
| `packages/ant-cli/src/core/ports/session.ts` | `SessionPort` (append* / load* / collapse*) |
| `packages/ant-cli/src/periphery/adapters/session/FileSessionAdapter.ts` | Sole implementation. Per-file mutex concurrency safety |
| `packages/ant-cli/src/composition/recordUserTurn.ts` | orchestrator → 2-file user_turn atomic append |
| `packages/ant-cli/src/core/context/featureContextBuilder.ts` | `buildFeatureContext` / `mergeFeatureContext` / `compactFeatureContext` / `hydrateFeatureContext` |
| `packages/ant-cli/src/core/context/breadcrumb.ts` | `buildBreadcrumb` / `buildBreadcrumbSummary` / `collectTouchedFilesFromTrace` |
| `packages/ant-cli/src/core/executionTier/` | 5-Tier Execution Strategy. The decompose LLM emits `<executionTier>N</executionTier>` → parsed by `parseExecutionTierTag` → contract-validated by `validateExecutionTier(parsed, { mode })` (throws `ExecutionTierViolation` on MISSING_TAG / FORBIDDEN_TIER_FOR_MODE, consumed by the decompose retry loop). `Tier0Reflex` / `Tier1OneShot` / `Tier2Exploratory` / `Tier3Task` / `Tier4Plan` facades. Phase nodes access only via `getExecutionTier(state)` (§5.1.1) |
| `packages/ant-cli/src/core/utils/featureBiases.ts` | `recordClassification` / `readClassifications` (misclassification instrumentation, §9) |
| `packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/` | 3-way complexity classification + `<specClarify>` emit |
| `packages/ant-cli/src/agents/architect/graph/code/nodes/direct/` | ReAct loop + `shouldEscalate` |
| `packages/ant-cli/src/agents/architect/graph/code/nodes/{resolve,learn}/index.ts` | feature.jsonl consumption/production |
| `packages/ant-cli/src/agents/architect/graph/code/routing.ts` | `routeAfterDecompose` 4-way / `routeAfterDirect` |
| `packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/decompose/variants/default/rules.md` | Complexity Classification + Spec Clarify sections |
| `packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/plan/base.md` | `{{#if featureContext}}` injection block |
| `packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/direct/variants/default/{base,rules}.md` | WHAT/HOW split |
| `packages/ant-cli/src/periphery/adapters/http/routes/feature-log.routes.ts` | `/trace` `/breadcrumbs` `/user-turn-meta` `/context/reset` |
| `packages/ant-ui/src/domain/store/slices/featureLogSlice.ts` | UI Zustand slice |
| `packages/ant-ui/src/presentation/components/chat/feature-log/` | `TraceActivityView` / `BreadcrumbTimeline` / `useFeatureLogSync` |

---

## 8. Migration Notes (what was replaced)

| Before (28-context-management.md) | Now (this document) | Status |
|---|---|---|
| `session.state.jobConversation: ConversationEntry[]` | `feature.jsonl` + `featureContext` state channel | **Field removed** (legacy cleanup) |
| `compressHeavyweightEntries` (Trigger 2) | — (heavyweight-boundary concept retired) | **Function deleted** |
| `compactJob` on jobConversation (Trigger 1) | `compactFeatureContext` on `FeatureContext.userTurns` | Function reused, caller replaced |
| `CODE_JOB_COMPACTION_THRESHOLD` / `DESIGN_JOB_COMPACTION_*` | `FEATURE_CONTEXT_THRESHOLD` (12000) | **Constants deleted** (code/design paths only) |
| `jobs/code/base/injections/job-history.md` | `{{#if featureContext}}` block in `plan/base.md`, `direct/base.md` | **File deleted** |
| `jobs/design/base/injections/job-history.md` | (same; design only injects the channel — subgraph prompts unmodified, D5) | **File deleted** |
| `infra/compaction/job-summary.md` | — | **File deleted** |
| `chat.json` (agent-side writes) | `trace.jsonl` | **Agent-side writes removed** (legacy cleanup). The ChatService HTTP layer is slated to be replaced with a trace.jsonl-based implementation |
| `saveToChatFile` / `flushToChatFile` / `getChatSessionPath` | — | **Deleted** |
| `ChatStatusReporter.flush()` | — | Removed from the interface |
| Triage Step 6 "Scope Routing" | Decompose `<specClarify>` | Prompt stage moved (`triage_scope_cleanup`) |

The "Inter-Job Context Bridge" section of **28-context-management.md** has been **fully replaced** by this document. The Plan/Visual (Context Continuity) path's use of `compactJob` is retained — the three orthogonal axes currently apply only to code/design.

**plan/visual's `sessionDigest`** (buildSessionDigest → the `{{#if hasSessionDigest}}` section of the triage prompt) survives. Because code/design no longer populate `state.conversations[SESSION_MAIN]`, triage on those paths always renders without a sessionDigest. plan/visual still use the `conversation` continuity model, so sessionDigest stays active for them. See the appendix in §9 for detailed instrumentation.

---

## 9. Appendix — Injection Status Diagnosis (diagnose_injection)

> **Purpose**: document, in a measurable form, how much "prior context" this redesign actually injects into prompts, and how far the legacy channels (sessionDigest / jobConversation) have been deactivated.

### 9.1 Injection channel inventory (as of 2026-04-20)

| Channel | Current state | Injection site | Cap |
|---|---|---|---|
| `state.jobConversation` → `job-history` partial | **Fully removed** | — (template file deleted) | 0 bytes |
| `FeatureContext.userTurns` | **Active** (code/design resolve) | `plan/base.md`, `direct/variants/default/base.md` — `{{#each featureContext.userTurns}}` | window 6 until Compact triggers |
| `FeatureContext.breadcrumbs` | **Active** (code/design resolve) | Same templates — `{{#each featureContext.breadcrumbs}}` | `DEFAULT_BREADCRUMB_WINDOW` = 5 (each summary tens to hundreds of chars) |
| `FeatureContext.summary` | **Active** (when Compact fires) | Same templates — "Earlier Context (summary)" block | `COMPACTION_MAX_OUTPUT_TOKENS` = 16384 |
| `sessionDigest` (triage) | **code/design: dead / plan/visual: active** | `jobs/shared/nodes/triage/variants/default/base.md` — `{{#if hasSessionDigest}}` | Latest 3 entries × 300/200 chars |

### 9.2 Measurement method

Ant saves every rendered prompt to `{featurePath}/sessions/architect/debug/prompts/*.md` when the `ANT_PROMPT_DEBUG=true` environment variable is set. Start a single job per tier, then measure in that directory:

```bash
# sessionDigest section size
awk '/^## SESSION CONTEXT$/,/^##|^---/' <prompt.md> | wc -c

# featureContext section size
awk '/^## Prior Context/,/^## |^---/' <prompt.md> | wc -c

# jobConversation / job-history residue check (must always be 0)
rg -c '## (Previous Work|Completed Work Boundary|Job History)' <prompt.md>
```

### 9.3 Expected range (analytical upper bounds)

Assuming `user_turn.text` averages 200 chars:

| Tier | Scenario | Expected featureContext injection |
|---|---|---|
| 0/1 Reflex/Oneshot | First request (empty feature.jsonl) | 0 chars (block not rendered at all) |
| 2 Exploratory | Latest 5 turns + 3 mini-BCs | `5 × 200 + 3 × 120 ≈ 1.4 KB` |
| 3 Todo (first run) | Latest 6 turns + 5 breadcrumbs | `6 × 200 + 5 × 120 ≈ 1.8 KB` |
| 3 Todo (Compact fired) | summary + 6 turns + 5 BCs | summary ≤ 64 KB (16384 tokens × 4) + 1.8 KB. Measured average is 2–5 KB |
| 4 Plan/Visual (sessionDigest active) | 3 recent entries | ≤ 900 chars (300+200+200 + separators) |

### 9.4 Observation points

| Metric | Meaning | Normal range |
|---|---|---|
| `## SESSION CONTEXT` section in triage prompts after feature.jsonl | Must be 0 bytes for code/design requests (`sessionMain` is empty) | 0 bytes |
| `## SESSION CONTEXT` on plan/visual requests | Populated by `buildSessionDigest` | 0–900 chars |
| `## Prior Context` block in plan/direct prompts | 0 on the first request, incremental afterwards | Proportional to turn count |
| Compact trigger frequency | Only when accumulated T2 tokens > 12000 | Only after dozens of turns accumulate on a typical feature |
| Legacy "Job History" / "Completed Work Boundary" sections | Fully dead | **Always 0 bytes** (any regression indicates a legacy-cleanup violation) |

### 9.5 Open items

- Whether to redesign triage's `sessionDigest` section around feature.jsonl needs a separate ticket. As long as plan/visual keep the `session.state.conversation` model, the legacy sessionDigest stays as-is.
- When `entries.length === 0`, buildSessionDigest returns `undefined` → the block is never rendered in code/design triage, so the "dead channel" cannot pollute prompts. Pinning this in a regression-detecting prompt snapshot test would be desirable (follow-up ticket).

---

## Boundaries

- **Replaced document**: [`28-context-management.md`](./28-context-management.md) — its §2 "Context Isolation" / "Inter-Job Context Bridge" sections are replaced by this document. The Continuity (plan/visual), `compactRun`, and `retentionPolicy` parts remain valid.
- **Related documents**:
  - [`11-agent-architecture.md`](./11-agent-architecture.md) — LangGraph StateGraph wiring
  - [`12-triage-routing.md`](./12-triage-routing.md) — Detect / Triage intent classification
  - [`13-prompt-system.md`](./13-prompt-system.md) — Handlebars template engine
  - [`14-code-job.md`](./14-code-job.md) — code graph details
  - [`15-design-job.md`](./15-design-job.md) — design graph (Mode×Complexity not applied, D5)
  - [`19-tool-system.md`](./19-tool-system.md) — tool side-effects → trace.jsonl file_write
  - [`31-chat-system.md`](./31-chat-system.md) — ChatService / chat.routes (slated to be replaced with a trace.jsonl-based implementation)
  - [`NODE_GRAPH_LAYOUT.md`](./NODE_GRAPH_LAYOUT.md) — Phase node task-type blindness (R1)
