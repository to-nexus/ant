# Design Job

## Overview

The Design Job is the architect agent's LangGraph graph that takes a user's directive and generates design documents. It shares the same resume architecture as the Code Job, but performs document generation (execute) instead of code generation.

## Differences from the Code Job

| Item | Code Job | Design Job |
|------|----------|------------|
| Execution nodes | plan -> execute -> tool | plan -> execute -> tool |
| plan role | Generates planText via LLM+tools (5 stages: entry/shortcut/RAG/llm/outcome) | Generates a sealed `<plan>` via LLM+tools (lean per-doc; applies only to intentGroup ∈ {design-spec, design-system-design}. ui-design / game-art-design are dispatcher-only fallback) |
| Verification loop | enforce -> plan (violations) | None |
| Task types | setup, feature, testgen, error, verification | doc |
| Output | Source code files | Design documents (MD, JSON) |
| Unique attributes | - | workType, documentType |
| Shared helpers | Both jobs use `runPlanWithTools` / `runPlanToolLoopPhase` / `extractPlanText` from `agents/common/graph/nodes/plan/`. Each node body is implemented separately (structural differences are large — no adapter/strategy interface is introduced) | Same |

## workType

Decided at `detect`; determines the document-generation strategy.

| workType | Condition | Output files |
|----------|------|----------|
| `system-design` | Only PRD/directive, no UI input | system-design.md, api-contract.md, etc. |
| `ui-design` | `visual/ui/figma/figma.json` populated **or** a description directive | `visual/ui/ant/{ui-tokens,ui-assets,ui-spec}.json` |
| `spec` | Explicitly designated as spec mode | spec documents |

## UI Design Pipeline Mode (Intent-Based)

The pipeline mode for the `ui-design` workType is determined by `resolvedAction.intent`. The `isFigmaPipeline(intent, figmaPopulated)` helper owns the branch decision.

| Intent | Condition | Methodology | Tool set |
|--------|------|--------|----------|
| `gen-ui-figma` | `visual/ui/figma/figma.json` populated + MCP available | Figma MCP structured-data extraction → output to `visual/ui/ant/ui-*.json` | `TOOL_SETS.uiDesignFigma` |
| `gen-ui-desc` | Directive + PRD | Author UI documents directly from a textual description | `TOOL_SETS.uiDesign` |
| `rev-ui` | Modify existing UI documents | by-desc variant (directive) — common entry point for non-Figma modes | `TOOL_SETS.uiDesign` |

When the Figma intent (`gen-ui-figma`) is synthesized, the description variant is ignored. If free-form visual material (html/css/png) is needed, place it directly under `visual/ui/handoff/` for the code job's multimodal channel to use (handoff is additional context for the code job, not a design-job decompose input). For the detailed pipeline, see [25-design-pipeline.md](25-design-pipeline.md).

## documentType (System Design)

decompose determines the document structure based on the project environment + two orthogonal fields emitted by the LLM (`services` provider, `consumedApis` consumer).

| environment | services | consumedApis | documentType | Output |
|---|---|---|---|---|
| frontend | empty | empty | `unified` | `fe-system-main.md` |
| frontend | empty | non-empty | `contract-first` | `fe-system-main.md` + `api-contract-{c}.md` per consumer |
| backend | empty | empty | `unified` | `be-system-main.md` |
| backend | non-empty | any | `contract-first` / `msa-contract-first` | `be-system-{s}.md` + `api-contract-{s}.md` per service (+ `api-contract-{c}.md` per consumer) |
| fullstack | empty | empty | `contract-first` | `api-contract-main.md` + `fe-system-main.md` + `be-system-main.md` |
| fullstack | non-empty | any | `msa-contract-first` | `fe-system-main.md` + `api-contract-{s}.md` + `be-system-{s}.md` per service (+ `api-contract-{c}.md` per consumer) |

**Field semantics (provider ⊥ consumer)**:

- `services` (provider) — the backend service boundaries this project owns. Each entry produces a `be-system-{s}.md` + `api-contract-{s}.md` pair. Ignored under `gen-sys-fe`.
- `consumedApis` (consumer) — external API hosts this project consumes (CONSUMER snapshot). Each entry produces only `api-contract-{c}.md` (no accompanying be-system). Meaningful for all system-design intents.
- `services ∩ consumedApis` — on a name collision, provider wins; the consumer entry is dropped with a warning.
- Downstream code jobs include all `api-contract-*.md` in refs via wildcard, so the provider/consumer distinction is limited to prompt-side semantics at the decompose stage (`External Contract Discovery` in `api-contract-guide.md` covers both cases).

## Graph Node Flow

### Sequential Execution (ANT_TASK_CONCURRENCY = 1)

```
__start__ -> resolve -> [4-way router]
    +-> triage -> detect -> [intent router]
         +-> isFigmaPipeline(intent): figmaExplore -> decompose
         +-> otherwise: decompose
    +-> revise -> plan
    +-> plan (direct)
    +-> decompose (resume after interruption post-detectEnv)

plan -> [router]
    +-> tool (plan↔tool tool loop, _activePhase='plan' + tool_use present)
    +-> execute (sealed <plan> or dispatchOnly fallthrough)

execute -> [router]
    +-> tool -> [router]  (tool-call loop, _activePhase unset)
    +-> checkTaskStatus (done=true)
    +-> execute (retry, done=false)

tool -> [router]  (branches on _activePhase)
    +-> plan (_activePhase='plan' → plan↔tool loop)
    +-> execute (otherwise → execute↔tool loop)

checkTaskStatus -> [router]
    +-> plan (next task)
    +-> learn -> __end__
```

### figmaExplore Node

A Figma-mode-only node. Runs after `detect` and before `decompose`. Without any LLM call, it programmatically invokes the Figma MCP adapter directly to explore the design structure and produce matrices (Variation, Component State) and a nodeSummary. The result is stored in `state.figmaExplorationResult` and consumed later by decompose and execute. For the detailed algorithm, see [25-design-pipeline.md](25-design-pipeline.md).

### Parallel Execution (ANT_TASK_CONCURRENCY > 1)

After decompose, flow branches to the `parallelOrchestrator` node. It uses the same TaskOrchestrator/TaskWorker pattern as the Code Job.

```
decompose -> parallelOrchestrator -> learn -> __end__
```

The Worker Subgraph spreads `DesignGraphChannels` to keep channels in sync with the main graph. When adding a new channel, add it only to `DesignGraphChannels` (`graph.ts`) and Workers pick it up automatically. Details: see "Worker Subgraph Channel Definitions" in [11-agent-architecture.md](11-agent-architecture.md).

## Key Node Characteristics

### plan

Has two behaviors, branched by intentGroup:

- **`design-spec` / `design-system-design`**: runs a lean LLM+tools plan↔tool loop to produce `<plan>{...}</plan>` JSON. The plan result is sealed into `state.planText` and injected at the top of execute's `runtimeContext` (`# Sealed Plan (from plan node)`). The tool set is the read-only `TOOL_SETS.designPlanExplore` (`designPlanFigma` when Figma is active) — file-write / download_asset are not exposed (writing/downloading is execute's responsibility).
- **`design-ui` / `design-game-art`**: keeps the existing dispatcher-only behavior. Pops from the taskQueue, sets currentTask, handles only the kanban / workflow / task_start logging, and routes immediately to execute. Once `variants/{ui-design,game-art-design}/` prompts are added in the future, only the entry guard needs lifting to join the LLM+tools flow.

Re-entry branch: when `state._activePhase === 'plan' && NODE_PLAN.length > 0`, one round of the plan↔tool loop is executed. The plan↔tool loop itself has no round cap — runaway is caught by LangGraph's `recursionLimit`.

Uses the shared helpers (`agents/common/graph/nodes/plan/`). The same stream / `<plan>` extraction logic as code is shared as functional utilities only — an adapter/strategy interface is deliberately not introduced (structural differences are large; for the full policy see the directory README and [NODE_GRAPH_LAYOUT.md](./NODE_GRAPH_LAYOUT.md) §2).

### execute

Generates design documents via XML streaming. Multi-turn conversation based on `conversationHistory`, including tool calling. Completion is determined the moment the LLM emits `<done>true</done>`. If `done=false`, it re-enters itself and continues the LLM response. Files are written to disk immediately.

**Tool-loop safety net retirement**: execute's call-budget safety net (`_callLimitReached` / `MAX_NO_OUTPUT_CALLS=15` / `DOCGEN_MAX_CALLS=25`), the `call_budget_exhausted` terminal kind, and the `call_limit` interruption reason are all retired (for the same reason as the code job's Safety Net D/E retirement — false-positive generators). Infinite loops are caught by LangGraph's `recursionLimit` as the ultimate backstop, and unproductive streaks are conveyed to the LLM only as advisory soft/hard warnings (no deterministic gate). The design job plan node's tool-loop round cap (`PLAN_TOOL_LOOP_MAX`) was retired in the same pattern.

**ui-spec append anchor**: when a `forceAppend=true` chapter adds a new section to a large `ui-spec.json`, the insertion point (`appendAnchor`) is computed live from disk state at execute-turn time. The SSOT is `extractLastSectionKey(content)` in [`packages/ant-cli/src/agents/architect/graph/design/_shared/anchor.ts`](../../packages/ant-cli/src/agents/architect/graph/design/_shared/anchor.ts). It used to be pre-computed at decompose time, but in new-build scenarios the target file was empty and the anchor stayed permanently pinned to null — resolved by switching to live computation.

### decompose

For system-design, performs LLM-based task decomposition (documentType + targetFiles + profiles). For ui-design, decomposes tasks after LLM-based UI complexity analysis. Explain mode creates a single explain task (no LLM call).

#### TechTier Setup

All 3 of the Design Job's decompose functions set RAC.basis.techTier (via `getTechTier(state)`). Unlike the Code Job, the Design Job separates graph-level TechTier from per-task TechTier.

| workType | graph-level TechTier | per-task TechTier |
|---|---|---|
| system-design | Representative profile from the `profiles` map + stack derived from the intent | `resolveTaskTechTier()`: targetFile → profiles map lookup → `buildTechTier()` |
| ui-design | `state.profile` + stack=`frontend` (always) | None (single tier) |
| spec | `state.profile` + stack derived from the intent | None |

**system-design's profiles map**: the LLM outputs a `profiles` field as JSON in the decompose response. Keys are in `{tier}-{name}` format (`be-main`, `fe-main`, `be-auth`, etc.) and values are `{ language, framework }`. `resolveTaskTechTier()` uses this map in a 2-step lookup — each DesignTask's `targetFile` → tag → profiles — to build the per-task `techTier`.

**per-task TechTier consumption**: `ModeController.detectFrameworkAugmentation()` and `systemDesignPrompt.detectUsedTemplates()` consult `currentTask.techTier` to deterministically inject framework augmentation (nextjs, go-api).

## UI Design Document Dependency Chain

UI documents are generated chapter by chapter. tokens and assets run in parallel; only spec depends on both.

```
ui-tokens.json (no dependencies)
ui-assets.json (no dependencies, parallel with tokens)
    -> ui-spec.json (references ui-tokens + ui-assets)
```

Each chapter task generates only its own scope. `lastSectionNumber` tracks the previous section number, and the last section is recorded in the JSON's `_meta.lastSection`. When appending, the full file is not put into the prompt — only `previousChaptersSummary` (a list of key names) is injected, and the LLM drills in via `read_file` when needed.

## State Restoration

runner.ts loads the session and restores state before graph invoke:
- taskQueue, completedTasks, completedTasksDetails
- resolvedAction (including basis.techTier)
- figmaConfig, figmaExplorationResult, figmaAvailable, figmaFileKey, figmaStartNodeId
- planText, conversationHistory
- directive, overrideDirective, chatSource
- jobTiming, tokenUsage, tokenUsageByModel

### Interruption & resume — task granularity (official contract)

Design resume operates at **task granularity**, not worker-conversation
granularity:

- Completed tasks (`completedTasks` / `completedTasksDetails`) and their
  already-written document sections are never re-executed — the interrupt
  checkpoint's `taskQueue` holds only in-flight + pending tasks.
- An interrupted in-flight task **restarts from call index 0 with an empty
  conversation**. `DesignTask.resumeState` is declared as a future seam but is
  never populated: `captureWorkerSnapshots` exists only in the code job's
  orchestrator hooks, and the design graph has no snapshot-capture site. Do
  not read `resumeState` on design paths expecting mid-task conversation
  recovery (oat-choosing-horse RCA, 2026-08-02).
- `SessionState.runningTasks` is populated only by the periodic orchestrator
  checkpoint (60s interval) while workers are live; graceful interrupts
  requeue in-flight tasks into `taskQueue` and empty it. The runner's
  `persistedRunning` read exists solely for the hard-kill orphan case.

## Plan Observability

### planText Lifecycle

| Stage | Location | state.planText |
|---|---|---|
| Entry | `plan/index.ts` (fresh entry) | Empty string or leftover from the previous task (reset in the next stage) |
| `<plan>` emit | `plan/finalizeOutcome.ts:finalizePlanOutcome` | Set to `outcome.planText` |
| Execute injection | `execute/intent/spec.ts:75-79` / `execute/intent/system.ts:375-379` | Prepended at the top of runtimeContext as `# Sealed Plan (from plan node)` |
| Task completion | `graph.ts:checkTaskStatus` (sequential) / `parallel/workerGraph.ts:189-193` (parallel) | Reset to `''` (guaranteeing fresh planning for the next task) |
| Session resume | `runner.ts:113-115` | Restored from the session file (goes straight to execute when resuming mid-task) |

Seeing `planText: ""` in the final state of the session file (`sessions/architect/design.json`) is **normal state serialized after the last task completed and was reset**. In-progress snapshots (checkpoints) do contain the sealed plan.

### Log File Mapping

Per-file responsibilities under `{featurePath}/sessions/debug/`:

| File | Writer | Content |
|---|---|---|
| `plans/plan-{jobId}.json` | `plan/finalizeOutcome.ts:savePlanForDebug` | Per-task sealed `<plan>` JSON bodies (accumulated as an array) |
| `prompts/prompt-{jobId}.json` | `core/utils/promptLogger.ts:logPrompt` | Metadata at execute-prompt build time — `injectedVariables.planText` indicates by length whether the sealed plan was injected |
| `logs/log-{jobId}.json` | `core/utils/executionLogger.ts:logPhaseComplete` | Structured phase events (table below) |
| `chat.jsonl` (workspace root) | `core/streaming/strategies/CommonRenderStrategy.ts` | User-visible SSE events — the `statusType: "plan"` card carries the `<plan>` JSON body verbatim |

### Phase Events (`log-{jobId}.json`)

Emitted via `logPhaseComplete({ phase, elapsedMs, details })`. Three kinds occur in the design plan stage:

| `phase` | Trigger condition | Key `details` fields |
|---|---|---|
| `design-plan-sealed` | `<plan>` extraction succeeded for `intentGroup ∈ {design-spec, design-system-design}` | `taskId`, `intentGroup`, `planTextLen`, `planParsed`, `candidatesCount`, `decisionSelected`, `outlineSectionCount` |
| `design-plan-fallthrough` | A plan-loop round emitted neither `<plan>` nor a tool call → entering execute with empty planText | `taskId`, `intentGroup`, `reason`, `nodePlanHistoryLen`, `recursionCount` |
| `design-plan-dispatch-only` | plan-LLM skipped for `intentGroup ∈ {design-ui, design-game-art}` (`dispatchOnly` path) | `taskId`, `intentGroup`, `reason: 'intent-group-not-plan-llm-enabled'` |

### Diagnostic Workflow

Recommended order when analyzing a new design job trace:

1. **grep `logs/log-{jobId}.json` for `design-plan-`** — one line shows the plan stage's outcome (sealed / fallthrough / dispatch-only) and candidate count.
2. **`plans/plan-{jobId}.json`** — if sealed, inspect the actual JSON to compare candidates / check the decision rationale.
3. **The `execute-spec` or `execute-systemDesign` entry in `prompts/prompt-{jobId}.json`** — verify that `injectedVariables.planText` matches the length seen in step 1 (plan→execute handover integrity).
4. **`chat.jsonl`** — from the user's perspective, check the time distribution across thinking → `statusType: "plan"` → file_create.

If the hypothesis is that the `plan→execute` handover broke, compare steps 1 and 3 first (the `planTextLen` in step 1 must equal the `planText` length indicator in step 3).

## Codebase mutation gate

The Design job's outputs are documents under **artifact paths** — `architecture/`, `plan/`, `assets/`, `visual/`, `meta/`, `sessions/`, etc. Mutating source code under `codebase/` is the responsibility of the **architect/code job's `execute` phase only**. Shell command execution (`run_command`) is a separate orthogonal responsibility, with legitimate use only in the **architect/code job (all phases)**.

| Job / phase | `codebase/` mutate | `run_command` | Artifact mutate | Enforcement location |
|---|---|---|---|---|
| architect/design — plan / execute | Blocked | Blocked | Allowed | `allowMutateInCodebase = false` + `allowShellExecution = false` ([tool/index.ts](../../packages/ant-cli/src/agents/architect/graph/design/nodes/tool/index.ts) buildContext) + `RUN_COMMAND` unregistered in the design tool registry + FileRenderer XML guard (`jobType: 'design'`) |
| architect/code — plan | Blocked | **Allowed** | Allowed | `allowMutateInCodebase = false` (`_activePhase === 'plan'` branch) + `allowShellExecution = true` (always) + FileRenderer (`codePhase: 'plan'`) |
| architect/code — execute | Allowed | Allowed | Allowed | `allowMutateInCodebase = true` (`_activePhase === 'execute'`) + `allowShellExecution = true` + existing FileRenderer guard |
| planner — plan (PRD/planning) | Blocked | n/a (tool unregistered) | Allowed | planner tools ([planner/graph/plan/nodes/tools.ts](../../packages/ant-cli/src/agents/planner/graph/plan/nodes/tools.ts) `isCodebasePathArg` guard) + FileRenderer (`jobType: 'planner'`) |

**`codebase/` mutate and `run_command` are two orthogonal responsibilities.** They are not bundled into one flag (this separation was introduced after the `agile-nodding-pouch` silent false-pass regression — the code job's verification plan couldn't even run the typecheck gate and auto-completed with an empty plan). The code job's plan is responsible for producing the `<plan>` JSON, but the *process* of producing it has legitimate uses — build / typecheck / test gates (verification task), test-runner installation (test-code task), error diagnosis (error task), API discovery after installing design-prescribed deps (default plan) — which is the rationale for `allowShellExecution = true` (always).

The blocking mechanism operates along three axes:

1. **Tool handler (codebase writes)** ([codebaseGate.ts](../../packages/ant-cli/src/agents/common/tool/handlers/codebaseGate.ts) `rejectCodebaseMutate`) — `edit_file` / `delete_file` / `mkdir` / `create_file` are rejected when the resolved path is under `codebase/`.
2. **Tool handler (shell execution)** ([codebaseGate.ts](../../packages/ant-cli/src/agents/common/tool/handlers/codebaseGate.ts) `rejectRunCommand`) — since the effective target path of `run_command` cannot be inferred from args, it is rejected outright as a binary gate. Fires only in design / planner ctx.
3. **FileRenderer XML tags** ([FileRenderer.ts](../../packages/ant-cli/src/core/streaming/strategies/common/FileRenderer.ts) processFile) — `<file>` / `<append>` / `<edit>` / `<delete>` artifact tags pointing at `codebase/` are rejected. The same policy applies to design / planner / code-plan alike. (This guard covers the `codebase/`-write responsibility and is unrelated to shell.)

Rejection messages guide the LLM toward a recovery path — use an artifact path, or describe the change in a spec/plan document — in an FPOP-friendly tone with no "You MUST" admonitions. A blocked attempt combines with the R5 self-check on the next turn and naturally converges to task completion (`<done>true</done>`).

Regression guards: [tests/architect/mutate-gate.test.ts](../../packages/ant-cli/tests/architect/mutate-gate.test.ts) (two-flag matrix), [tests/architect/regression-design-spec-mutate-leak.test.ts](../../packages/ant-cli/tests/architect/regression-design-spec-mutate-leak.test.ts) (design execute → codebase mutate blocked — formerly named `total-drying-apron`), [tests/architect/regression-agile-nodding-pouch.test.ts](../../packages/ant-cli/tests/architect/regression-agile-nodding-pouch.test.ts) (the code job's verification plan passing `run_command`).

## R5 — artifact-mutation-then-no-done self-check

The execute termination trigger (`<done>true</done>`) depends on LLM output. When the sealed plan's `decision` is prescriptive (e.g. "rename X to Y"), the model may misinterpret the task-completion condition as "executing the decision", risking an infinite loop where it never emits done and keeps attempting codebase changes that get blocked by the R1/R6 guards.

To break this autonomously, the execute node, at the end of a turn:

1. **Detects artifact-mutation intent**: mutation intent is determined when, in this turn, (a) a `<file>`/`<append>`/`<edit>`/`<delete>` succeeded on an artifact path, or (b) a pending `edit_file`/`delete_file`/`create_file`/`mkdir` tool call points at an artifact path. The detailed truth table has its SSOT in [execute-mutation-intent-detector.test.ts](../../packages/ant-cli/tests/design/execute-mutation-intent-detector.test.ts).
2. **Sets flags when `<done>` was not emitted**: `state._pendingDoneCheck = true`, `_doneCheckEscalation` count incremented. Both are official channels in [graph.ts](../../packages/ant-cli/src/agents/architect/graph/design/graph.ts) `DesignGraphChannels`.
3. **Changes the next turn's trailing message**: `buildSelfCheckTrailingMessage` in [selfCheck.ts](../../packages/ant-cli/src/agents/architect/graph/design/nodes/execute/intent/selfCheck.ts) returns a self-check phrase per escalation stage (1st: a gentle request for a decision / 2nd: the same meaning in a firmer tone). Shared by the spec / system-design variants.

The self-check message asks **only for the task-scope decision**; codebase-blocking guidance is provided separately by the R1/R6 rejection messages (MECE). FPOP-compliant — no tool-name listings / "You MUST" / system-behavior explanations.

## Boundaries

- Agent-common patterns: [11-agent-architecture.md](11-agent-architecture.md)
- Tool system (tool catalog, registry, orchestrator): [19-tool-system.md](19-tool-system.md)
- Code Job: [14-code-job.md](14-code-job.md)
- Prompt templates: [13-prompt-system.md](13-prompt-system.md)
- Design pipeline details (UI + Game-Art): [25-design-pipeline.md](25-design-pipeline.md)
- Document constraint map (system design/spec/PRD): [36-prompt-document-constraint-map.md](36-prompt-document-constraint-map.md)
