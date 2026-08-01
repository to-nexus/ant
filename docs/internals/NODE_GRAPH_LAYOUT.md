# Node Graph Layout — Agent Graph Directory Normalization Rules

> **Scope**: every LangGraph StateGraph under `packages/ant-cli/src/agents/{agent}/graph/{job}/`.
> **Purpose**: enforce that task type, phase, and domain responsibilities cohere consistently along directory axes.
> **Related documents**: [14-code-job.md](./14-code-job.md), [17-code-verification-task.md](./17-code-verification-task.md), the `Node Graph Layout — Task Type Blind Phases (R1)` section of [`.cursorrules`](../../.cursorrules).

---

## 1. Why These Rules

- As a LangGraph graph grows, `task.type === '...'` branches, domain state fields, carry-over logic, and hooks/handlers scatter across phase nodes, routers, parallel, and tool handlers.
- It doesn't end with "cleaning up verification once" — every task type (error / setup / ui / design-system / test-code / doc / feature) produces the same mutations.
- Therefore we fix, as rules (R1~R5), **which smell must go to which directory**. The same rules apply to future graphs.

---

## 2. The 8-Axis Layout

Every agent graph (`agents/{agent}/graph/{job}/`) follows the 8 axes below.

| # | Folder/file | Responsibility | Existence condition |
|---|---|---|---|
| ① | `graph.ts` · `state.ts` · `routing.ts` · `runner.ts` | Graph assembly, state types, edge predicates, entry | Required for every graph |
| ② | `nodes/{name}/` | Phase nodes (graph.addNode targets), 1 node = 1 directory. `nodes/_common/` is exclusively for phase-shared state-aware helpers (§2.4) | Required for every graph |
| ③ | `routers/` or `routing.ts` | Edge predicates. **Pure functions, no state mutation** | Required for every graph |
| ④ | `parallel/` | Orchestration (worker/queue) | As needed |
| ⑤ | `session/` | Checkpoint/resume **logic only**. Does not include LLM prompt adapters (the SessionContextBuilder family) — those belong inside the consuming node (`nodes/{name}/`) or in `utils/`. **Cross-importing another job graph's `session/` is also forbidden** (R5) — each job owns its own `session/` SSOT. Direct `session.updateArtifacts` calls also cohere inside this folder (axis ⑤ SSOT) | As needed |
| ⑥ | `config/` | Constants/environment | As needed |
| ⑦ | `tasks/{taskType}/` | **task.type-specific cross-phase modules** (0..N) | Required whenever a task.type branch arises |
| ⑧ | `utils/` | **Pure helpers only** (no domain logic) | As needed |

> **Off-axis SSOT**: the cross-agent Tier strategies (`Breadcrumb / Boundary / Collapse / Compact` — operation-per-strategy + Tier facade) live in `packages/ant-cli/src/core/executionTier/`. They are not one of the agent graph's 8 axes, but phase nodes access them via `getExecutionTier(state)` (R1 + D11). The matrix is in [18-session-redesign.md §5.1.1](./18-session-redesign.md).
>
> **Off-axis functional helpers — `common/graph/nodes/plan/`**: holds the single-round LLM+tools stream helper (`runPlanWithTools`), the plan↔tool loop re-entry helper (`runPlanToolLoopPhase`), and `<plan>` extraction (`extractPlanText`) shared by the plan nodes of the code and design jobs. **It exports functional utilities only — a `PlanStrategy` interface or `createPlanNode(strategy)` factory is deliberately NOT created** (code: a 5-stage entry/shortcut/RAG/llm/outcome pipeline; design: lean per-doc — the two structures are so different that an abstraction layer would be awkward for both). Unlike its sibling directories `triage/`, `detect/`, `resolve/`, it is not a reusable phase-node factory — state this in the directory README. The plan↔tool loop has no round cap — runaways are caught by LangGraph's `recursionLimit`.

### 2.1 Standard Internal Structure of `tasks/{taskType}/`

```
tasks/{taskType}/
├── index.ts        # exports { hooks: TaskHooks }
├── model/          # (optional) phase-unaware domain state·outcome·snapshot·errors
│   ├── Session.ts
│   ├── snapshot.ts
│   ├── outcome.ts
│   ├── errors.ts
│   └── is.ts
└── hooks/          # phase adapters. Import model only; no imports between hooks
    ├── plan.ts
    ├── tool.ts
    ├── command.ts
    ├── check.ts
    ├── router.ts
    ├── orchestrator.ts
    ├── decompose.ts
    ├── conversations.ts
    └── scheduling.ts
```

- **Deep implementation** (verification): full model + hooks.
- **Shallow implementation** (test-code, doc, feature): only the hooks needed (e.g. `scheduling.ts` + `conversations.ts`). A model is optional.
- **Common entry**: `tasks/_shared/registry.ts` provides two entry points — `hooksIfActive(state)` (state-based) / `hooksForTaskType(taskType)` (ctx-only).

### 2.2 Standard Internal Structure of `nodes/{name}/`

For phase node directories, the principle is **1 graph.addNode target = 1 directory**, with the following file conventions inside.

| File | Role | Existence condition |
|---|---|---|
| `index.ts` | Node function body — the `(state) => Partial<State>` passed to `graph.addNode` | Required |
| `tools.ts` | State-aware tool-set selector — `export async function getTools(state): Promise<ToolDefinition[]>` | When the node consumes tools + needs state/environment-based filtering |
| `buildMessages.ts` · `buildSystemPrompt.ts` | Per-node prompt adapter — consumes `core/prompt`'s PromptBuilder | As needed |
| `parts/` | Phase-invariant pipeline sub-steps | As needed |

**tools.ts conventions**:
- The filename must be `tools.ts`. Per-node custom naming like `toolDefinitions.ts` / `getXxxTools.ts` is forbidden.
- The export is a **single entry point**: `export async function getTools(state): Promise<ToolDefinition[]>`. It receives each job's GraphState (e.g. `ArchitectGraphState`, `DesignGraphState`). If a node requires multiple options (`useSourceFileTool`, etc.), accept them as a second options argument, but the signature name stays `getTools`.
- All state/runtime-based filtering (figma gating, whether reference tools apply, explain-mode branching) coheres entirely inside `tools.ts`. The call site (index.ts) must be a single line: `const tools = await getTools(state, opts)`.
- Any pattern that selects tools inline is extracted into `tools.ts` on sight.

### 2.3 The `nodes/{phase}/helpers.ts` Anti-Pattern

When the following concerns are mixed in `nodes/{phase}/helpers.ts` / `utils.ts`, axes ② / ⑤ / ⑧ have collapsed into one file. Disperse on sight.

- Direct `saveCheckpoint` / `session.updateArtifacts` calls → `session/{file}.ts` (axis ⑤ SSOT)
- Pure parsers / sanitizers → `utils/` (axis ⑧)
- State-aware phase-shared helpers (kanban / token tracking / workflow instrumentation) → `nodes/_common/` (§2.4)
- Phase-only default / fallback factories → a separate file within that phase directory (`nodes/{phase}/defaults.ts`, etc.)

If only a phase-local single helper remains, keeping it as `helpers.ts` is acceptable.

### 2.4 `nodes/_common/`

When a **phase-shared helper (state-aware)** that is not a phase node is needed, put it in `nodes/_common/`. Pure functions go in `utils/`.

- The underscore prefix explicitly marks **"non-phase-node internal"** — the folder name alone distinguishes it from `graph.addNode` targets.
- Decision criterion: if it references state / runtime ports (session, llm, registry, orchestrator), it goes to `_common/`; if it is pure string/type conversion, it goes to `utils/`.
- Representative examples (code graph):
  - `_common/`: `invokeLLMWithTools.ts`, `runToolCallsAndCollect.ts`, `errorHandler.ts`
  - `utils/`: `parseReActResponse.ts`, `violationFormatter.ts`, `responseCleaners.ts`, `codeMetrics.ts`

---

## 3. Rules R1 ~ R5

### R1 (phase blind) — **Invariant**

Phase nodes (`nodes/`), routers, parallel, and common/tool handlers know neither `task.type` nor semantic comparisons of `task.priority`. Task-specific logic must be injected via `tasks/{taskType}/hooks/` hooks.

- Any occurrence of an `if (task.type === '...')` / `task.type === '...'` comparison expression, anywhere, is an **R1 violation**.
- Semantic priority comparisons like `task.priority === N` / `task.priority < N` / `task.priority >= TASK_PRIORITY.X` are also forbidden in phase code (Three-Axis SSOT — see `CLAUDE.md` + [`41-task-priority-band-system.md`](41-task-priority-band-system.md)). Priority is legal only as the sort comparison in `TaskQueue.push()`.
- Migrate any such condition into `tasks/{taskType}/hooks/`. **No exceptions.**
- Contexts without state (tool handlers, etc.) call `hooksForTaskType(ctx.currentTaskType)`.
- **Fake state casts like `{ currentTask: { type: '...' } } as any` are forbidden**. They are an R1 bypass and a review-reject target.
- **Routers are pure predicates** — state mutation like `state.llmResponse = ...` is forbidden. Routers only read the `Partial<State>` returned by phase nodes. Router mutation easily harbors latent task.type logic and thus becomes an R1 bypass path, so it is forbidden. (This absorbs the earlier draft rule R7.)
- **Scheduling classification dispatch** is unified at one place: `hooksForTaskType(t.type)?.scheduling?.classify?.(t)`. classify's input is the whole BaseTask, and each bundle reads only its own type's discriminator (`task.band` for feature, `task.type` for design-system/verification/setup, `task.priority` for design-job doc). **Decompose's `deriveBandFromPriority` is the only phase site for priority → semantic conversion** — no other phase compares against any priority window. (The R1 extension of the Three-Axis SSOT.)

**Verification commands**:
```bash
rg "task\.type === '[a-z-]+'" \
  packages/ant-cli/src/agents/architect/graph/code \
  --glob '!packages/ant-cli/src/agents/architect/graph/code/tasks/**'
# Expected: 0 matches

# Three-Axis SSOT — guarantee zero semantic priority comparisons in the phase layer.
# The only exceptions are decompose responseParser (the single priority → band
# mapping site) and tasks/_shared/batchSplit/process.ts (parent − 1 sort clamp).
rg -n "\.priority\s*[<>!=]=?\s*(\d+|TASK_PRIORITY|windowFor|basePriorityFor|VERIFICATION_PRIORITY)\b" \
  packages/ant-cli/src/agents/architect/graph/code/parallel \
  packages/ant-cli/src/agents/architect/graph/code/routers \
  packages/ant-cli/src/agents/architect/graph/code/nodes/plan \
  packages/ant-cli/src/agents/architect/graph/code/nodes/execute \
  packages/ant-cli/src/agents/architect/graph/code/nodes/checkTaskStatus \
  packages/ant-cli/src/agents/architect/graph/design/nodes \
  packages/ant-cli/src/agents/architect/graph/common
# Expected: 0 matches
```

#### R1-carve-out (static type predicates allowed)

The phase layer (phase `nodes/`, `routers/`, `parallel/`, common/tool handlers) is **conditionally allowed** to **directly import** the type predicates from `tasks/{type}/model/is.ts` (`isDocTask` / `isErrorTask` / `isVerificationTask` / `isSetupTask` / `isUiTask` / `isFeatureTask` / `isDesignSystemTask` / `isTestCodeTask` / `isExplainTask`). **All** of the following must hold.

1. The predicate is a **pure function** — zero state / ctx / runtime dependencies. It performs only a `task.type` literal comparison.
2. The `task.type === '...'` literal comparison exists **only inside the predicate's implementation file** and does not leak into phase files. (Phase files expose only the predicate call.)
3. It is a **"static per-type fact"** that would need no state context even if extracted into a hook (e.g. skip-planning, router discrimination, tool filter gating).

If any of the 3 conditions is violated, it must be migrated into `tasks/{type}/hooks/`. In particular, once "conditional logic + state references" start mixing near the predicate call, it is not a carve-out — it is a missing hook.

**Regression guard**: `packages/ant-cli/tests/regression/staticPredicateCount.test.ts` pins the count of predicate references in the phase layer. Any increase fails CI, forcing re-examination against the 3 conditions above.

**Background**: direct phase use of `isDocTask` / `isErrorTask` etc. was accepted, but to prevent unbounded expansion this clause permits it only narrowly. This clause is the SSOT for that decision.

### R2 (model phase-blind)

`tasks/{taskType}/model/` does not know phases.

- It does not import `nodes/`, `routers/`, or `parallel/`.
- Dependency direction: `hooks/ → model/`, `nodes/ → hooks/`.
- The model consists solely of pure domain objects (Session, Snapshot, Outcome, Errors).

### R3 (utils pure)

No domain logic in `utils/`.

- If a domain noun like "Session" / "Tracker" / "Outcome" / "Classification" appears in a filename, it is misplaced.
- Migration target: `tasks/{type}/` or `tasks/_shared/`.
- `utils/` holds only reusable pure helpers like `codeMetrics.ts`, `responseCleaners.ts`.

### R4 (state SSOT)

When the urge to add a new field to state arises, first ask: "does this belong inside `tasks/{taskType}/model/`?"

- State keeps **only cross-task common fields**.
- Task-type-specific information coheres as `task.{field}` (e.g. `task.batchSplitCount`). The VerificationSession class is retired (vast-curling-perch verify cleanup) — the gate cache / passed Set / install observation / attempts counter are all replaced by the LLM's conversation history + the priorErrorTasks prompt injection.
- Verification responsibility coheres per behavior, not per task type. `tasks/_shared/verify/` is the SSOT, shared by the verification task type and Tier 2 self-verify tasks (`selfVerifyOnDone:true`). Branch predicate: `requiresVerification(task)`. Phase mode channel: `state._verifyEntered` (single writer: `markVerifyEntered.ts`).
- Adding 1 new field ⇒ aim to remove at least 1 existing field ("No Axis N+1").

### R5 (cross-job promotion)

When a cross-job shared task domain emerges, promote it to `common/graph/tasks/{taskType}/`.

- Conversely, resumeState fields used by only one job stay in that job's TaskResumeState only. (E.g. `CodeTaskResumeState.verification` must not leak into the design job.)

---

## 4. Smell → Migration Target (Quick Decision Table)

| Observed smell | Governing rule | Migration target |
|---|---|---|
| A phase node as a single file `nodes/{phase}.ts` (e.g. design's old `nodes/plan.ts`) | axis ② | Decompose into a `nodes/{phase}/` directory. Split into an `index.ts` body + `tools.ts` + (if needed) `prompt.ts` / `finalizeOutcome.ts` |
| `if (task.type === 'x')` in a phase node | R1 | `tasks/x/hooks/{phase}.ts` |
| A router with mutation like `state.llmResponse = ...` | R1 | The plan node returns `Partial<State>`; the router only reads |
| Domain-named utils like `utils/verificationFoo.ts` | R3 | `tasks/_shared/verify/foo.ts` (shared by verification owners) or `tasks/{type}/hooks/` (task-type-specific) |
| Type-local fields like `_fooTracker`, `_fooAttempts` accumulating on state | R4 | `state.foo?: FooSession` SSOT + `tasks/foo/model/` |
| A tool handler with a fake cast `{ currentTask: { type } } as any` | R1 | `hooksForTaskType(ctx.currentTaskType)` |
| One `TaskResumeState` mixing fields from every job | R5 | `BaseTaskResumeState` + `{Job}TaskResumeState` |
| A verification/error common determination duplicated across phases | R1 + R3 | Write `isVerificationTask(t) \|\| isErrorTask(t)` explicitly at each site — the two types **diverge** in session ownership / command guards / plan entry paths, so do not bundle them behind an alias |
| A state-aware tool selector inlined in a phase node / inconsistently named (`toolDefinitions.ts`, `getXxxTools.ts`, inline in `index.ts`) | axis ② (§2.2) | Extract to `nodes/{name}/tools.ts`, conforming to the single signature `export async function getTools(state): Promise<ToolDefinition[]>` |
| Helper directories directly under `nodes/` that are not `graph.addNode` targets (`nodes/shared/`, `nodes/checkpoint/`, etc.) | axis ② / ⑤ | State-aware helpers go to `nodes/_common/` (§2.4), checkpoints to `session/`, prompt adapters inside the consuming node or `utils/` |
| A job-A file like `design/nodes/X.ts` cross-importing job-B's session such as `code/session/*` | R5 + axis ⑤ | Create the target job's own `session/*.ts` SSOT and call it directly. No `as any` workarounds |
| `saveCheckpoint` / `session.updateArtifacts` hiding inside `nodes/{phase}/helpers.ts` | axis ⑤ | Move to `session/checkpoint.ts`. Wrapper names carry the boundary semantics (`saveDecomposeCheckpoint`, `saveTaskCompleteCheckpoint`, etc.) |

---

## 5. New Graph Authoring Checklist

When creating a new agent/job graph:

- [ ] Create the 4 files `graph.ts` / `state.ts` / `runner.ts` / `routing.ts` (or `routers/`) (axis ①)
- [ ] Phase nodes as `nodes/{name}/` directories (axis ②). Avoid single-file `nodes/{name}.ts`.
- [ ] Phase-shared state-aware helpers in `nodes/_common/` (§2.4). Pure helpers in `utils/`. No ambiguous folders like `nodes/shared/`.
- [ ] Session checkpoint writes go through the `session/checkpoint.ts` SSOT (§2 axis ⑤). Direct `session.updateArtifacts` calls are forbidden outside the session SSOT file.
- [ ] State-aware tool selectors conform to the `nodes/{name}/tools.ts` + `getTools(state)` convention (§2.2).
- [ ] Routers are pure predicates only (axis ③). No state mutation.
- [ ] When a task.type branch arises, migrate it into `tasks/{type}/hooks/` without exception (axis ⑦). R1 compliance.
- [ ] Per-task-type domain state coheres in `tasks/{type}/model/Session.ts`. `state.ts` gets only the single field `state.{type}?: Session` (R4).
- [ ] Only pure helpers in `utils/` (R3). No domain nouns in filenames.
- [ ] If cross-job reuse potential appears, consider promotion to `common/graph/tasks/{type}/` (R5).
- [ ] Before submitting a PR, run all of the `§4 regression guard` commands and confirm 0 results.

---

## 6. Six Principles Against Smell Recurrence

Even if implementers cannot read this whole document, following the 6 principles below preserves the same redesign direction. This is the operational summary of R1~R5, usable as a quick checklist in code review.

1. **No "Axis N+1"** (operational form of R4): when tempted to add a new field to state, first check whether it can be derived from existing fields. Adding 1 new field ⇒ aim to remove at least 1 existing field.
2. **Domain state lives in the task model** (R4): per-task attempts, gates, history, depHash, batch-split, etc. are not added directly to `state.ts` but belong to the Session/Snapshot in `tasks/{type}/model/`. `state.ts` keeps **only cross-task common fields**.
3. **All-or-nothing carry-over boundaries**: every boundary — requeue, retry, split — must go through the same `snapshotFromState + resumeState` SSOT. Missing even one boundary revives the regression. When adding a new boundary, use the existing 3 boundaries (`handleInterruption` / `reportFailure transient` / `plan.processDiagnosticBatchSplit`) as reference and call the same API.
4. **Terminals are typed + single path**: terminal conclusions are unified through typed errors like `VerificationTerminalError` + the single `classifyTerminalError` path. When adding a new kind, add it to `model/errors.ts` together with the corresponding `all defined kinds` test case. The orchestrator handles new kinds automatically with no code change.
5. **Phase nodes, routers, parallel, and tool handlers are blind to every task.type** (R1): do not put `if (task.type === '...')` branches into these axes. If a branch is needed, add a hook in `tasks/{taskType}/hooks/`. **No exception even for verification**.
6. **No `as any` fake state casts** (R1): contexts without state use `hooksForTaskType(taskType)`. Shims like `{ currentTask: { type: ... } } as any` are an R1 bypass and a review-reject target.

---

## 7. References

- **Implementation reference**: `packages/ant-cli/src/agents/architect/graph/code/tasks/` (verification is the deepest; error/setup/ui/design-system/test-code/doc/feature are shallow implementations).
