# Code Job

## Overview

The Code Job is the architect agent's LangGraph graph that takes a user's directive and generates source code. It operates in the flow task decomposition -> planning -> code generation -> verification, and supports task-level interruption/resumption.

### Intents and Mode — rev-code Retired (2026-07)

The code-family intents are the 4 of `gen-code-sys` / `gen-code-spec` / `gen-code-directive` / `explain-code`. `rev-code` (refactor mode) was retired — the code job's target is always the single codebase, so the rev/gen axis ("new document vs editing an existing document") doesn't exist, and generate/refactor were treated identically at every layer: tiers, tool sets, and task shape. The code job's mode is effectively a 2-value **write (`generate`) vs read-only (`explain`)** (the `Mode` type itself keeps 3 values for design/plan rev-* intents).

Treatment of existing code is decided by **workspace presence**, not by intent:

- When `hasCodebase=true`, code gen intents get `codebaseSlot('context', {auto:true})` dynamically injected (`CODEBASE_CONTEXT_INTENTS`), and the `codebase-channel` + [`existing-code-discipline`](../../packages/ant-cli/src/core/prompt/templates/jobs/code/base/injections/existing-code-discipline.md) partial (behavior preservation / minimal blast radius / interface preservation) is injected into decompose (via the existing-code-check wrapper), plan (base.md include), and execute (AutoInjectionResolver).
- **Fresh-build clarify gate**: when existing code is present but the directive demands "start over from scratch" without specifying how the existing code should be treated, decompose's existing-code-check asks extend vs replace via `<clarify>` (reusing the existing decompose clarify plumbing, gated by `clarifyActive`).
- Legacy compatibility: `rev-code` in persisted state is normalized to `gen-code-directive` by `LEGACY_INTENT_ALIASES` (`@ant/shared/actions.ts`) at the entry points of `deriveFromIntent`/`resolveToRAC`.

Regression guards: [`tests/prompt/existing-code-discipline.test.ts`](../../packages/ant-cli/tests/prompt/existing-code-discipline.test.ts), [`tests/core/rac.test.ts`](../../packages/ant-cli/tests/core/rac.test.ts) (alias), [`tests/prompt/injection-resolution-matrix.test.ts`](../../packages/ant-cli/tests/prompt/injection-resolution-matrix.test.ts) (presence injection + retired mode trigger).

## Graph Node Flow

### Sequential Execution (ANT_TASK_CONCURRENCY = 1)

```
__start__ -> resolve -> [4-way router]
    +-> triage -> detect -> decompose -> plan (sequential loop)
    +-> revise -> plan
    +-> plan (direct, plain resume)
    +-> decompose (resume after interruption post-detectEnv)

plan -> [router]
    +-> tool -> plan (plan exploring)
    +-> execute (planText ready)
    +-> checkTaskStatus (batch split complete, done=true)

execute -> [router]
    +-> tool -> execute (tool-call loop)
    +-> checkTaskStatus (done=true)
    +-> execute (self-loop retry)

checkTaskStatus -> [router]
    +-> enforce -> plan (violations + retries remaining)
    +-> learn -> [router]
        +-> plan (next task)
        +-> __end__
```

### Parallel Execution (ANT_TASK_CONCURRENCY > 1)

After decompose, flow branches to the `parallelOrchestrator` node. The TaskOrchestrator manages N TaskWorkers, each of which runs an independent Worker Subgraph.

The Worker Subgraph spreads `CodeGraphChannels` to keep channels in sync with the main graph. When adding a new channel, add it only to `CodeGraphChannels` (`graph.ts`) and Workers pick it up automatically. Details: see "Worker Subgraph Channel Definitions" in [11-agent-architecture.md](11-agent-architecture.md).

`TaskWorker.executeTask` wraps once more with `runInTaskScope(task.id, …)` inside `runInWorkerScope(workerId, …)` so that every chat event automatically carries a `worker-N#task-K` identifier. Even when a long-lived worker executes tasks serially across barrier cohorts, FE sections stay separated per task and time-ordered, preserving chronology. For identifier/ordering conventions, see "Worker Scope · Task Scope · Section Ordering" in [31-chat-system.md](31-chat-system.md).

## Key Nodes

### resolve

Loads initial state and decides the resume branch. Restores taskQueue, resolvedAction, directive, etc. from the session.

### triage

The shared Triage node. Intent classification, work-status determination, choice presentation.

### detect

Analyzes user intent and produces the `resolvedAction` (RAC). The explicit path builds it directly from metadata; the infer path has the LLM return an `InferredAction`, then converts via `resolveToRAC()`. Consumed by prompt construction and the ModeController.

### decompose

Decomposes tasks based on the directive and resolvedAction. Assigns type, priority, exclusive, and parallelGroup to each task.

#### TechTier Determination

decompose asks the LLM to output tech-stack information via a `<techTier>` tag alongside the task decomposition. The prompt templates (`code/nodes/decompose/variants/default/base.md` + `techTier-rules.md`) define the observation priority and constraints.

**Dual path — Preset vs Inferred:**

```
UI BasisWizard → ActionMetadata.basis → detect → RAC.basis.techTier (preset)
                                                       ↓
                                          injected into the decompose prompt
                                                       ↓
                                LLM preserves preset fields + infers empty fields
                                                       ↓
                                           mergeTechTier(preset, inferred)
                                                       ↓
                                              RAC.basis.techTier (final)
```

When the user sets a techTier preset in the UI (BasisWizard for the `gen-code-directive` intent), the pre-decided fields are injected into the decompose prompt and the LLM uses those values verbatim. Only unset fields are inferred.

**LLM response → TechTier conversion flow:**

```
LLM output <techTier>           code parsing            mergeTechTier(preset, inferred)
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ stack            │───>│ parsed           │───>│ RAC.basis        │
│ language         │    │   .stack         │    │   .techTier      │
│ framework        │    │   .language      │    │     .stack       │
│ frontend{ … }    │    │   .framework     │    │     .frontend    │
│ backend{ … }     │    │   .frontend      │    │     .backend     │
└──────────────────┘    │   .backend       │    └──────────────────┘
                        └──────────────────┘
```

> Fullstack jobs pass each runtime's framework independently via the `frontend` / `backend` sub-objects (given the FE/BE runtime split, the framework must not collapse into a single value). Single-stack jobs omit the two sub-objects and use only the top-level `framework`.

| TechTier field | Determination source | Normalization |
|---|---|---|
| `language` | LLM constrained response (enum given) | `resolveLanguage()`: `javascript` → `typescript`, `golang` → `go` |
| `framework` | LLM constrained response (examples given, null allowed) | `resolveFramework()`: `Next.js` → `nextjs`, etc. |
| `stack` | LLM constrained response | Direct mapping to `frontend` / `backend` / `fullstack` |
| `runtime` | System-derived (no LLM judgment) | `resolveRuntime(stack, language)`: `frontend→browser`, `backend+go→go-api` |
| `packageManager` | Currently unset in code decompose | Can be set by `CodebaseAnalyzer.analyzeAsTechTier()` |

**LLM observation priority** (when there is no preset):

1. Presence of design documents — the document-name prefix decides tier scope
2. Design document content — explicitly stated tech stack
3. directive/PRD — consulted only when design documents are absent

**TechTier access**: read RAC.basis.techTier via the `getTechTier(state)` helper. Use this helper instead of legacy direct access to `state.techTier`.

### plan

Pops a task from the taskQueue, sets it as currentTask, and generates planText. Provides the LLM with keyword search and RAG results to formulate an implementation plan.

**Task-level resume**: if `interrupted === true` and a valid planText exists, plan generation is skipped (canSkipPlan).

### execute

The LLM generates code through tool calls (read_file, write_file, search, etc.). When `conversationHistory` is restored, work continues on top of the previous conversation.

### tool

Batch-executes execute/plan tool calls and appends results to the conversation history. The Code job applies `CodeCommandPolicy` (Go build blocking, verification loop guard, etc.) to `RUN_COMMAND`. For the tool catalog, handler architecture, and orchestrator details, see [19-tool-system.md](19-tool-system.md).

### checkTaskStatus

Records timing and tokenUsage for the completed task and saves a checkpoint. Resets planText and conversationHistory to prevent contaminating the next task.

### enforce

Re-enters plan together with the violations list. Activated when `checkTaskStatus` finds violations and retries remain.

### learn

Performs cleanup after task completion. Responsible for shutting down server processes, infrastructure teardown (`stopInfrastructure`), etc.

### revise

On resume, when a new directive (overrideDirective) exists, the LLM decides whether to adjust the existing task queue. The decision is `continue` or `modify` (tasksToRemove + tasksToAdd).

## Infrastructure Startup (Final Verification)

When the project depends on external services (DB, Redis, MQ, etc.), the only flow is for the LLM to start the infrastructure directly using the `run_command` tool during the verification task.

The LLM completes the following steps **before** emitting `<done>true</done>`:

1. **Discover**: read project config files to identify build/run commands and infrastructure definitions
2. **Infrastructure**: run `docker compose up -d --wait`. Read the compose file's service definitions and map them to the app's environment variables
3. **Build**: run the build/compile command (the PRIMARY verification criterion)
4. **Runtime**: on build success, run the dev/start server once to verify the full stack

The `learn` node calls `stopInfrastructure()` to clean up the Docker services that were started.

## Error Diagnostics System

The multi-language error parsers in the `diagnostics/` directory parse build/test failure output and split it per file.

- `verification` task = **diagnosis + fan-out only**. The plan tool-loop runs build/test directly to isolate root causes, and whenever 1+ fix items are found, it unconditionally fans out into per-target error sub-tasks. Verification itself never attempts a fix (the execute phase is effectively never invoked — immediately `done:true` after fan-out).
- `error` task = **fix only**. A 1-entry sub-task spawned by fan-out takes the `prePlanText` fast-path, skips the plan stage, and enters execute to fix a single file.
- `test-code` task: generates test code after all feature tasks complete

The **always-fan-out policy** of `processDiagnosticBatchSplit`: a top-level `implementation.{modify,create,delete}` is automatically converted into per-target batches[]. If `batches[]` already exists, it is respected as-is. The split-threshold environment variables (`ANT_VERIFICATION_SPLIT_ERRORS` / `ANT_VERIFICATION_SPLIT_FILES`) and the `forceByRepeat` branch were retired (with verification's responsibility polarized to fan-out rather than fixing, threshold gating itself became meaningless). The hard cap on split cycles is guaranteed by `MAX_BATCH_SPLIT_CYCLES = 10`.

> **The full set of verification-task responsibilities/invariants/anti-patterns** lives in [17-code-verification-task.md](./17-code-verification-task.md) (SSOT — the 12-responsibility matrix: Session, gates, commandGuard, snapshot, terminal, etc.).

## Deep-think Fan-out (feature / ui)

For directives whose solution decompose doesn't know (Tier 2 / 3 — no design ref), the deep-think responsibility is delegated to the plan node. When the plan tool-loop finishes thinking and decides the work must split into N physically separated children, it emits `batches[]` in the `<plan>` body. `processDiagnosticBatchSplit` fans out using the same infrastructure.

| Parent type | Policy `kind` | Sub `subType` | Children plan-loop | parentReasoning |
|---|---|---|---|---|
| `verification` | `requeue-parent` | `error` | **skip** (`acceptsPrePlanText:true` — identity-shortcut) | n/a (diagnostics) |
| `error` | `drop-and-replace` | `error` | **skip** (`acceptsPrePlanText:true` — identity-shortcut) | n/a (diagnostics) |
| `test-code` | `drop-and-replace` | `test-code` | **maintained** — `prePlanText` surfaces as plan-tool-loop INPUT (`nodes/plan/injections/parent-pre-plan.md`); the LLM cross-checks against sibling exports and then emits `planText` | n/a |
| `feature` | `drop-and-replace` | `feature` | **maintained** — same INPUT contract. The plan layer detects drift when the predicted exports in the parent-emitted `parentReasoning` diverge from the actual sibling output | Parent's cross-batch decisions (names/signatures/contracts) — replicated identically to every batch |
| `ui` | `drop-and-replace` | `ui` | **maintained** — same INPUT contract | Same — ui children refine via the plan-tool-loop, then execute |

**Tier 2 escalate**: when a single Tier 2 task stamped with `selfVerifyOnDone:true` emits `batches[]` at plan, the `isTier2EscalateCandidate` branch in `process.ts` activates automatically and takes the same fan-out path (`drop-and-replace` + supplemental Final Verification). Children are not stamped with `selfVerifyOnDone` — the gate responsibility is taken over by the newly added FV.

**Lineage cycle defense**: `process.ts` carries `batchSplitCount = parent + 1` to child sub-tasks. When a child fans out again, the accumulated count increases along the parent lineage, so `MAX_BATCH_SPLIT_CYCLES` is guaranteed even at grandchild depth. This is the key safety net blocking unbounded expansion, especially for all non-`error` children (those that keep the plan-tool-loop: feature / ui / test-code) — since they don't take the identity-shortcut, a child may well emit `batches[]` again.

**parallelGroup consistency**: a child's `parallelGroup` inherits the parent's group as its base (or a new `{type}-batch-{ts}` is created if absent). This conservatively serializes scenarios where file overlap with sibling tasks in the same queue as the parent is possible. File overlap among the child batches is checked separately by `computeBatchFileOverlap`; if overlap exists, the group is cleared and the tasks are demoted to `exclusive:true`.

**Meaning of parentReasoning**: used only in feature / ui fan-out. The "big picture spanning this set of batches" decided by plan — shared API names, contracts, types, integration points. It is serialized identically into every batch's `prePlanText` JSON to prevent signature drift among sibling children (one child using `connect()`, another `connectWallet()`). In code, this is the `parentReasoning` field of the JSON emitted by `featureBatchShape`.

## Cache Invalidation Scope

`VerificationSession._passed` is selectively invalidated based on the impact scope of an edited file. `decideInvalidationScope()` (`agents/common/tool/handlers/invalidationScope.ts`) observes the path and diff to decide the scope, and the `tool` node's `verificationInvalidated` side-effect handler passes that scope to `Session.onFileChanged` to drop only the affected gates.

| Edit target | scope | Rationale |
|---|---|---|
| Test files (`*.test.*`, `tests/**`, etc.) | `test` | Irrelevant to type/build caches |
| Static assets (`.css`, `.md`, images, fonts, etc.) | `build` | Affects bundling only |
| Source code (`.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`) | `all` | Types, build, and tests all need re-verification |
| Manifest `package.json` — devDependencies-only change | `test` + install | Only the test toolchain changes |
| Manifest `package.json` — dependencies / peerDependencies change | `all` + install | Runtime import graph changes |
| Manifest `package.json` — scripts / engines / exports / packageManager, etc. | `all` + install | Build pipeline / type resolution may change |
| Manifest `package.json` — no field changes | `test` | Harmless change such as formatting |
| Lockfile (`pnpm-lock.yaml` / `package-lock.json` / `yarn.lock` / `cargo.lock` / …) | `build` + install | Dependency version pinning — type cache preserved, only build/test re-verified |
| Other manifests (`pyproject.toml` / `Cargo.toml` / `go.mod`, etc.) | `all` + install | No diff parser → conservative fallback |
| Unknown extension / path | `all` | Conservative fallback |

**Conservatism principle**: when the diff is absent or classification fails, always fall back to the safe side with `scope:'all'`. Narrowing is a cache optimization, not a precondition for correctness.

At runtime, because `commandGuard` observes `Session.passed()` first as an independent condition, unless invalidation actually drops the `_passed` bit via `Session.onFileChanged`, re-running an already-passed gate is deterministically blocked with `[Policy] ALREADY PASSED` even across retry/reverify boundaries. This applies the FPOP Constraints-over-Instructions principle: the observable Session state is the SSOT, rather than relying on the prompt's stochastic hint (`cachedPassedSteps`).

## State Restoration

runner.ts loads the session and restores state before graph invoke:
- taskQueue, completedTasks, completedTasksDetails
- resolvedAction (including basis.techTier)
- referenceRequests
- planText, conversationHistory
- directive, overrideDirective, chatSource
- jobTiming, tokenUsage, recursionCount

The plan phase's RAG result (`PlanCodeContext` — files / filePaths / directoryTree / gitDiff) is a plan-local value generated once at task entry and is not stored in state. On resume, the next plan node performs RAG afresh. Execute only fetches the modify/create paths from plan.json on demand via the `read_file` tool.

## Split Injection

During parallel execution, only the pool paths listed in a task's `include` field (the single injection SSOT) are pre-injected. `include` is authored directly by the decompose/revise LLM and validated against the RAC intersection by `createTaskQueue`. Examples:
- `include = ['architecture/system/fe-system-main.md']` -> only that FE design document
- Cross-tier task -> add `architecture/system/api-contract-*` paths to include
- `include` unset -> zero pre-injection; needed docs are fetched on demand via execute `read_file` (passing the RAC scope gate)

The plan node injects only the file-path list from the RAG result. Actual file reading is done with the execute `read_file` tool.

## UI Design Document Consumption

This is the mechanism by which the Code Job consumes UI documents produced by the Design Job (ui-tokens.json, ui-assets.json, ui-spec.json).

### Loading

The `resolve` node calls `ArtifactService.loadParsedUiContext()`. It reads the three files from the `visual/ui/ant/` directory and parses them into a `ParsedUiDocs` structure:

```typescript
interface ParsedUiDocs {
  tokens?: string;              // full ui-tokens.json (string)
  tokensTokenEstimate?: number;
  assets?: string;              // full ui-assets.json (string)
  assetsTokenEstimate?: number;
  specSections: Map<string, UiSpecSection>;  // logical split of ui-spec.json
  specToc: UiSpecTocEntry[];                 // section table of contents
  specTotalTokens: number;
}
```

### Section Splitting

`UiDocParser.parseJsonSections()` splits the single `ui-spec.json` file into logical sections **in memory**. No separate files are created on disk.

Split rules:
- The `_meta` key is excluded
- If a top-level key's value is a "container" (all children are non-array objects): create a `{parentKey}-{childKey}` section per child (e.g. `pages-events`, `modals-connectModal`)
- Other leaf objects use the key as-is for the section ID (e.g. `layout`, `meta`)

### Per-Task Injection

`ArtifactPipeline` handles per-task document selection + compaction:

1. The pool is a RAC subset — `loadResolvedArtifacts(resolvedAction, featurePath)` loads only `refs ∪ context` (the `state.artifacts Post-RAC SSOT`).
2. `resolveArtifacts(pool, { taskType, include }, { threshold })` — filter by path-prefix matching against `task.include` + compaction.

The selection rule is a single SSOT — `task.include` matching is everything; there is no taskType default branching:

| Condition | Selection result |
|-----------|---------------|
| `taskType === 'verification'` | Empty array (defensive guard) |
| `include` specified | Pool artifacts matching the include path-prefixes (role inherited from the pool's RAC annotations) |
| `include` unset/empty | Empty array (no taskType default rules — explicit empty injection) |

`include` is authored directly by the decompose/revise LLM (RAC-validated). For UI paths, uiSource-gated guidance applies (`visual/ui/ant/spec/<section>` etc.); for spec-driven tasks, the prompt guides the LLM to include the active spec (`ArtifactPoolView.activeSpecRefFilename()`). The old automatic derivations `packages`/`uiSections`/`artifactPolicy` were removed.

### Document Authority

- **ui-tokens.json**: SSOT — the sole source of visual values
- **ui-assets.json**: SSOT — the sole source of asset paths
- **ui-spec.json**: Primary — the primary reference for layout. Details on which the spec is silent follow framework best practices

### Post-RAC template flags (Gate / Contract / Background)

Templates in post-RAC phases (decompose/plan/execute) branch on **3-category flags**. Which category to use is judged by "what does this block's copy enforce?" — not by the role the artifact happens to have today.

| Category | Naming | Criterion | Representative use-sites |
|---|---|---|---|
| **Gate** | `hasUi`, `hasSystemDesign`, `hasSpec`, `hasSources` | The block must fire identically regardless of ref/context | decompose's `design-system` task-creation branch, plan's TOKEN/ASSET/LAYOUT inventory, execute's visual-source hint |
| **Contract** | `hasUiRef`, `hasSystemDesignRef`, `hasSpecRef`, `hasSourcesRef` | The block's copy explicitly states "IMMUTABLE / MUST conform" | plan base's "API Contract IMMUTABLE" (`hasSystemDesignRef`) |
| **Background** | `hasUiContext`, `hasSystemDesignContext`, … | The block is explicitly "reference material" | No current use-site (helper preserved only) |

**Gate-first principle**: when in doubt, Gate is the default. Contract only when the block's copy explicitly says "IMMUTABLE/MUST".

Why does it have to be this way? The intent matrix ([`@ant/shared/action-config-matrix.ts`](../../packages/ant-shared/src/action-config-matrix.ts)) assigns different roles to the same artifact kind per intent:

- `gen-code-sys`: UI=ref / SYS=ref
- `gen-code-spec`: UI=**context** / SYS=context (SPEC is ref)
- `rev-ui`: UI=ref

Gating on `hasUiRef` alone produces a **regression where UI guidance goes silent** under `gen-code-spec`. The token inventory and the design-system task ladder have the correct semantics of "active whenever a UI document exists", regardless of intent, so they must branch on Gate (`hasUi`). This invariant is protected at runtime by [`tests/role-flag-intent-matrix.test.ts`](../../packages/ant-cli/tests/role-flag-intent-matrix.test.ts).

For the full conventions and prohibitions, see the **Post-RAC Template Condition SSOT** section of `.cursorrules`.

## Visual Source Authority

The priority and conflict-resolution rules for all of the Code Job's visual sources (UI Design Documents, Figma MCP) are defined in the single document `visual-source-authority.md`. The `ModeController` always injects this document for frontend projects (`detectedEnv !== 'backend'`), regardless of whether a uiDoc exists.

## Figma MCP Supplementation

The Code Job can connect directly to the Figma Desktop MCP to supplement design information. It shares the same infrastructure as the Design Job's MCP integration (`MCPTransport`, `FigmaMCPAdapter`), but the purpose and scope of use differ.

### Availability Detection (resolve node)

Two-stage detection:

1. **figma.json validation**: load `visual/ui/figma/figma.json` (canonical); the `detectFigmaSource` helper decides in a single path through `migrateFigmaConfig` → `isFigmaDataPopulated` → MCP availability
2. **MCP connection check**: local uses `checkLocalMCPAvailability()`, cloud uses `BridgeMCPTransport.isAvailable()`

Detection results are stored in `ArchitectGraphState`:
- `figmaAvailable: boolean` — whether MCP connection is possible
- `figmaFileKey: string` — file key extracted from the Figma URL
- `figmaStartNodeId?: string` — starting node extracted from the URL's `node-id` parameter

When `fileKey` extraction fails, `figmaAvailable = false` is set to prevent runtime errors at tool-call time.

### Available Tools

| Tool | Condition |
|------|------|
| `figma_get_design_context` | Always (frontend task + figmaAvailable) |
| `figma_get_screenshot` | Always (frontend task + figmaAvailable) |
| `figma_get_variable_defs` | Only when there are no UI documents (Scenario C) |
| `figma_get_metadata` | Only when `figmaStartNodeId` is absent (for node discovery) |

### fileKey Auto-Injection

`fileKey` is removed from the tool schema (`removeFigmaFileKeyFromSchema`) so the LLM never provides it. The tool handler auto-injects `state.figmaFileKey` at runtime.

### Scenario Matrix

| Scenario | UI Docs | Figma MCP | Strategy |
|----------|---------|-----------|------|
| A | O | O | UI docs primary, Figma supplements gaps |
| B | O | X | UI docs only |
| C | X | O | Figma primary — fetch tokens, layout, screenshots directly |
| D | X | X | Plan hints + framework best practices |

### On-demand Access (feature tasks)

For `feature` tasks, UI documents are not eagerly injected; the LLM fetches them via `read_file` when needed. The prompt provides the artifact paths (`visual/ui/ant/ui-tokens.json`, etc.).

### Redis Dependency (Cloud mode)

In cloud mode, `BridgeMCPTransport` uses Redis Pub/Sub. `orchestrator.ts` creates a Code-Job-dedicated Redis client, passes it as `deps.redis`, and calls `quit()` on job completion.

## Verification Cycle Details

The code job's verification cycle (fields, reset rules, gates, policies, snapshot, terminal, composeBundle composition, invariants, anti-patterns) has its SSOT in [17-code-verification-task.md](./17-code-verification-task.md). This document keeps only the following high-level points:

- **Responsibility polarization**: verification = diagnosis + fan-out; error = fix (see the `Error Diagnostics System` section above).
- **Session SSOT**: diagnostic state is encapsulated in `state.verification: VerificationSession` ([`tasks/_shared/verify/Session.ts`](../../packages/ant-cli/src/agents/architect/graph/code/tasks/_shared/verify/Session.ts)).
- **Gate passage** has the LLM's `verifies` declaration + exit 0 as its SSOT (regex command inference retired).
- **Terminal exit** is guaranteed by the 4 `VerificationTerminalError` typed kinds + the `MAX_BATCH_SPLIT_CYCLES = 10` hard cap + orchestrator `_failedAttempts >= 2` + `recursionLimit`.

> When adding a new verification field, adding a gate, changing commandGuard policy, changing snapshot fields, or adding a terminal kind — first update the responsibility matrix / invariants / anti-patterns sections of 17-code-verification-task.md, and keep only a cross-link in this document.

## Codebase mutation gate

The code job holds two orthogonal permissions that differ per phase:

- **`codebase/` writes** (`allowMutateInCodebase`) — legitimate only in the `execute` phase. The `plan` phase is responsible for producing the sealed `<plan>` JSON, and source mutation is blocked (tool handler `allowMutateInCodebase = (state._activePhase === 'execute')`, FileRenderer `codePhase: 'plan' | 'execute'` branch).
- **`run_command` shell execution** (`allowShellExecution`) — allowed in **both** `plan` and `execute`. The plan tool-loop has legitimate uses: verification gates (build/typecheck/test), test-runner installation (test-code), error diagnosis (error), and API discovery after installing design-prescribed deps (default plan). Wiring is `allowShellExecution: true` (always) — this flag is an orthogonal responsibility to `allowMutateInCodebase`, and plan's sealed-plan-only output responsibility is sufficiently enforced by `allowMutateInCodebase = false` alone.

For the policy SSOT and the matrix against other jobs, see [15-design-job.md "Codebase mutation gate"](15-design-job.md#codebase-mutation-gate). The earlier design that bundled the two permissions into a single flag produced a regression where the code job's verification plan couldn't even run the typecheck gate and silently false-passed (`agile-nodding-pouch`); that separation is the current SSOT.

## Boundaries

- Verification task responsibilities/invariants/anti-patterns (SSOT): [17-code-verification-task.md](17-code-verification-task.md)
- Agent-common patterns: [11-agent-architecture.md](11-agent-architecture.md)
- Job execution/interruption/resume: [10-job-lifecycle.md](10-job-lifecycle.md)
- Tool system (tool catalog, registry, CodeCommandPolicy): [19-tool-system.md](19-tool-system.md)
- Design Job: [15-design-job.md](15-design-job.md)
- Design pipeline details (UI + Game-Art): [25-design-pipeline.md](25-design-pipeline.md)
- Document constraint map (system design/spec/PRD): [36-prompt-document-constraint-map.md](36-prompt-document-constraint-map.md)
