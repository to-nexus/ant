# AGENTS.md

This file is the public source of truth for AI coding agents (Cursor, Claude
Code, GitHub Copilot, Codex, etc.) and human contributors who want to know
**what is binding** when modifying this codebase.

It is the contributor-friendly distillation of our internal SSOT policies.
The deep, regression-grade rationale lives in [`docs/internals/`](docs/internals/);
the user-facing concepts live in [`docs/concepts/`](docs/concepts/).

> **For setup instructions** see [CONTRIBUTING.md](CONTRIBUTING.md). This
> document is about *what to write* once you are set up.

---

## Quick Map

| You want to…                              | Read                                                |
|-------------------------------------------|-----------------------------------------------------|
| Understand the system in 5 minutes        | [docs/concepts/architecture.md](docs/concepts/architecture.md) |
| Run the project locally                   | [docs/getting-started/quickstart.md](docs/getting-started/quickstart.md) |
| Add a new agent / job / phase node        | This file, then `docs/internals/`                   |
| Author or edit a prompt template          | [Prompt Engineering](#prompt-engineering)           |
| Touch the LangGraph state machine         | [LangGraph State Management](#langgraph-state-management) |
| Make a change that crosses BE↔FE          | `@ant/shared` types + this file's "Cross-package contracts" |

---

## Architecture in One Page

Ant is a **modular monolith** packaged as four independent processes that
communicate exclusively via Redis (Pub/Sub, Key-Value, BullMQ).

| Process       | Port | Entry point                                       |
|---------------|------|---------------------------------------------------|
| `ant-api`     | 4100 | `composition/server.ts`                           |
| `ant-realtime`| 4101 | `infrastructure/realtime/start-realtime-server.ts` |
| `ant-job`     | —    | `infrastructure/worker/start-job-worker.ts`        |
| `ant-preview` | 4102 | `infrastructure/preview/start-preview-server.ts`   |

Inter-process communication is **always** Redis. There is no direct HTTP
between processes.

### Backend internal layout (hexagonal)

```
src/
├── composition/    Entry points (server, job-runner, orchestrator)
├── core/           Domain logic, prompt engine, types, ports
├── agents/         LangGraph agents (architect, planner)
├── infrastructure/ Adapters: queue, worker, realtime, IDE, preview
├── periphery/      External adapters: HTTP, auth, git, LLM, memory
├── cli/            CLI runtime
└── utils/          Shared utilities
```

### Job lifecycle

1. API receives an HTTP request → enqueue to BullMQ.
2. `JobWorker` dequeues → spawns `job-runner.ts` as a child process.
3. The child runs `orchestrator.ts` → routes to a LangGraph agent graph.
4. The graph executes nodes (LLM calls, file I/O, tools); state broadcasts
   via Redis Pub/Sub.
5. Job completion publishes to `job:status:updates`.

| Job type     | Agent     | Output                  |
|--------------|-----------|-------------------------|
| `code`       | architect | Source code             |
| `design`     | architect | Design docs (MD, JSON)  |
| `learn`      | architect | Vector DB index         |
| `plan`       | planner   | PRD                     |
| `ask`/`inline-ask` | architect | Chat response     |

Jobs support interruption and resumption. Checkpoints are saved to
`{featurePath}/sessions/{agent}/{jobType}.json`.

---

## Unified Distributed System Principle

**Ant is always a distributed system. There is no separate "local mode"
implementation.** Local and Cloud differ only in where the infrastructure
runs and in two narrow fork points (auth tenant resolution and Figma MCP
transport — desktop is local-only by nature). The data plane — Redis,
BullMQ, Pub/Sub, separate processes on individual ports — is identical.

### ❌ Forbidden

- `if (mode === 'local') / if (mode === 'cloud')` branches that produce
  divergent business logic.
- In-memory `Map` / `Set` that mirrors Redis SSOT state (job-completion
  flags, user-stopped flags, kanban snapshots) as a "fallback".
- Code paths that assume Redis or BullMQ might not exist.
- Skipping authentication based on mode.

### ✅ Correct

- A single code path that uses Redis, BullMQ, and Pub/Sub unconditionally.
- `StateStore` (Redis) is always available — never `undefined`, never behind
  `if (stateStore)`.
- Authentication is always enforced. Local uses the `local:local` tenant.

If it doesn't work without Redis, **fix it — do not add an in-memory fallback.**

---

## Node Graph Layout — Phases Are Task-Type Blind (R1)

**Phase nodes, routers, parallel orchestrators, and common tool handlers MUST
be blind to `task.type`. Task-specific logic lives only in
`tasks/{taskType}/hooks/`.**

### ❌ Forbidden

- `if (task.type === 'verification')` (or `'error'`, `'feature'`, etc.)
  inside `nodes/`, `routers/`, `parallel/`, `common/tool/handlers/`.
- `{ currentTask: { type: '...' } } as any` to sneak task-type logic into
  state-less contexts.
- Domain state fields (`_verificationTracker`, `_fooHistory`, etc.) on
  `state.ts` — they belong in `tasks/{type}/model/Session.ts`.
- Routers mutating state — routers are pure predicates.

### ✅ Correct

- `hooksIfActive(state)?.{hook}?.(...)` at phase-node call sites (state
  available).
- `hooksForTaskType(ctx.currentTaskType)?.{hook}?.(...)` at tool-handler / 
  orchestrator call sites (no state, just ctx).
- Each task type owns `tasks/{type}/index.ts` exporting `{ hooks: TaskHooks }`
  and registers itself in `tasks/_shared/registry.ts`.

The full 8-axis layout and rules R1–R5 live in
[`docs/internals/node-graph-layout.md`](docs/internals/node-graph-layout.md).

---

## Three-Axis Task Modeling — type / band / priority

Task classification is split across **three orthogonal axes** observed by
different actors:

| Axis            | Observer       | Decides                                             | Domain                                 |
|-----------------|----------------|-----------------------------------------------------|----------------------------------------|
| `task.type`     | LLM            | "What action mode is this task in"                  | `feature` / `error` / `verification` / `ui` / `design-system` / `test-code` / `doc` / `setup` / `explain` |
| `task.band`     | Orchestrator   | Scheduling position within the feature type         | `'foundation'` / `'integration'` / `undefined` |
| `task.priority` | TaskQueue      | Sort order in the queue                             | Integer — sort comparison only         |

**`task.priority` may be compared only inside `TaskQueue.push()`'s sort
callback.** Phase nodes, routers, parallel scheduling, classification, and
type decisions MUST NOT compare priority semantically. The single legal
priority-to-meaning translation lives in
`decompose/responseParser.ts::deriveBandFromPriority` — that helper attaches
`band` to feature tasks based on the priority the LLM emitted; everything
downstream reads `task.band` (for features) or `task.type` (for everything
else).

`band` is type-bound to `FeatureTask` via discriminated union — attempting
`{ type: 'verification', band: 'foundation', ... }` is a compile error.

---

## Tier × Verification Matrix (Code Job)

The 5-tier execution model is a job-neutral SSOT in
`core/executionTier`. Code jobs follow this matrix at decompose time:

| Tier | Meaning              | Writes  | Tasks at decompose | Verification |
|------|----------------------|---------|--------------------|--------------|
| 0 Reflex      | Read + text answer | Forbidden | 0 | N/A (direct) |
| 1 OneShot     | Limited writes, no verification needed | Allowed | 0 | None (direct) |
| 2 Exploratory | Single unit of work | Allowed | Exactly 1 | Two-cycle: apply → reverify via `_shared/verify/` |
| 3 Task        | Multiple units      | Allowed | ≥ 2 with verification task | Verification task gates via `_shared/verify/` |
| 4 RefsGrounded| Tier 3 + refs-grounded | Allowed | ≥ 2 | Same as Tier 3 |

The verification infrastructure lives in
`tasks/_shared/verify/` as the **single SSOT**. Tier 3/4 dedicated
verification tasks and Tier 2 self-verify tasks share it via `composeBundle`.

For the full background and the runtime-escalation paths used by `batchSplit`,
see [`docs/internals/verification-task.md`](docs/internals/verification-task.md).

---

## Retry Authority — `violation.isRetryable`

**Whether a violation is retryable is decided once, at the violation's source
of truth: `violation.isRetryable: boolean`.** `checkTaskStatus` reads this
flag and routes; it never re-judges via score, retry count, or type lookup.

### ❌ Forbidden

- Scoring violations or applying retry-count penalties inside any phase node.
- "critical type" arrays that override `isRetryable: false`.
- Pre-filtering violations sent to plan ("top-N same-type slice").
- Returning a violation with `isRetryable` left `undefined` — it will be
  dropped by the strict equality check.

### ✅ Correct

- Set `isRetryable: true | false` explicitly at every violation creation
  site (`tasks/*/hooks/check.ts`, `nodes/checkTaskStatus/evaluate.ts`).
- `nodes/checkTaskStatus/index.ts` only does
  `violations.filter(v => v.isRetryable === true)`.
- Grouping, prioritisation, and root-cause selection live in the plan
  prompt, not in phase code.

---

## LangGraph State Management

### Channels must be defined

When using a state field, define it in `channels` first.

```typescript
// ❌ Wrong
(state as any).parsedUiDocs = value;

// ✅ Correct
const graph = new StateGraph<GraphState>({
  channels: {
    parsedUiDocs: null as any, // reducer
    // ...
  },
});
state.parsedUiDocs = value;
```

### Derived channels

`state.executionTier?: ExecutionTierId` is derived. Decompose writes it once
after the LLM emits `<executionTier>N</executionTier>`. Phase nodes read it
through `getExecutionTier(state)` — never inspect `mode` / `complexity`
literals in phase code.

```typescript
// ✅
const executionTier = getExecutionTier(state);
await executionTier.breadcrumb(state, touched);

// ❌
if (state.resolvedAction?.mode === 'explain' && state.complexity === 'task') { ... }
```

Mode dispatch lives in exactly one place: `Tier3Task`'s constructor.

---

## Canonical Tag Rendering

Every canonical `<tag>` emitted by a node — LLM-streamed or back-channel —
**must** be registered in
`packages/ant-cli/src/core/streaming/transformers/SpecialTagTransformer.ts`.
Rendering rules live there only.

### Forbidden

- Emitting a new tag without registering a transformer entry.
- Calling `formatRACForChat` / building tag-formatted text outside
  `SpecialTagTransformer`.
- Adding `insideXxx` flags to `XMLStreamParser` to suppress a tag —
  suppression belongs in the transformer (`{ consumed: true }`).
- Silently swallowing chat-emit failures (`try {…} catch {}` with no log).

### Correct

- New canonical tag → add `this.register({pattern, transform})` in
  `SpecialTagTransformer.initializeTransformers()`. Use a `transform*` method
  for formatted output or a `() => ({ consumed: true })` suppressor.
- Locale-dependent labels live in sibling SSOT modules and are imported by
  the transformer — not hard-coded in node files.

The current registered inventory is documented in
[`docs/internals/output-tag-matrix.md`](docs/internals/output-tag-matrix.md).

---

## state.artifacts is RAC-bound

**`state.artifacts` is always a subset of `resolvedAction.refs ∪ context`.**
Only two functions write to the artifact pool:

1. `loadResolvedArtifacts(resolvedAction, featurePath)` — RAC-based load.
2. `appendOrUpdatePool(pool, task.files)` — design-job intra-job
   self-output.

Phase nodes and resolve must never wholesale-walk `architecture/**`,
`visual/**`, or `plan/**` to populate the pool. If you need a presence flag
that pre-dates RAC (used during triage / detect), use `state.workspaceState`
— that is the SSOT for "does this directory exist on disk".

The `code.decompose` discovery tools (`list_files`, `read_file` with
`scope='artifact'`) enforce a RAC whitelist for explicit pipelines. The
single writer of `discoveryCtx.racScope` is `decompose/index.ts`; the
matching logic lives in `discoveryTools.ts::isWithinRacWhitelist`.

---

## Codebase Channel — Existing-Project Awareness

`codebase` is a first-class workspace resource. Two job groups consume it
with different authorities:

| Job group × workspace                              | RAC slot                              | Pool load |
|----------------------------------------------------|---------------------------------------|-----------|
| code-anchored (`rev-code` / `explain-code` / `gen-learn`) | `codebaseSlot('ref')` (static)       | yes       |
| plan/design × existing project                     | `codebaseSlot('context', { auto: true })` (dynamic) | no   |
| plan/design × greenfield                           | absent                                | n/a       |

The single `codebaseRole` derivation site is
`deriveCodebaseRole(intent, { hasCodebase })` in
`@ant/shared/action-config-matrix.ts`. The single render is the
`templates/jobs/shared/injections/codebase-channel.md` partial, gated on
`{{#if codebaseRole}}`.

`WorkspaceState.hasCodebase` is computed from a disk walk OR'd with the
in-memory index — never memory-only.

---

## UiSource — Three Hard-Exclusive UI Inputs

UI design input is exactly **one** of three sources per RAC. The three values
have different interpretation contracts and must not be mixed.

| UiSource  | Path                  | Meaning                              | Interpretation |
|-----------|-----------------------|--------------------------------------|----------------|
| `ant`     | `visual/ui/ant/`      | Design-job output (tokens/assets/spec) | Schema-based |
| `figma`   | `visual/ui/figma/figma.json` | Figma file URL reference        | Live MCP exploration |
| `handoff` | `visual/ui/handoff/**` | Free-form bundle (HTML/CSS/MD/PNG/JSON) | Observation-only (FPOP) |

The SSOT funnel for the hard-exclusive rule is
`normalizeUiSourceRefs` in `packages/ant-shared/src/canonical.ts`. Every
RAC-creating site goes through it. Mixed RACs throw at the safety nets
(`ArtifactPoolView.uiSource()` / `validateUiSourceExclusivity`).

`figma.json` carries **only the URL + nodeId**. Variable dumps, frame JSON,
and screenshots are never persisted there — the design source is fetched
live via the Figma MCP at prompt time.

---

## Project / Feature Lifecycle

Project and feature lifecycles share three policies:

1. **`repoType` defaults to `'cloud'`.** `repoType: 'local'` is opt-in only,
   set explicitly through the wizard's advanced options. Auto-mapping from
   `userContext` (`local:local` vs cloud) is forbidden — that pattern caused
   path collisions in past regressions.
2. **`deleteProject` runs a 5-step cascade**: cancel jobs → IDE pod
   cleanup → preview pub/sub ack → Redis state cleanup → fs.rm verification.
   Skipping any step risks leaking EFS handles or stale workers.
3. **Cross-process cleanup uses Redis pub/sub** (`ant:lifecycle:cleanup:*`),
   not in-process method calls. Each process must listen for and ack
   cleanup requests.

`renameProject` shares steps 1–4 with `deleteProject` via the
`stopProjectRuntime` SSOT helper.

---

## Code Style

- **TypeScript strict mode**.
- **ESLint + Prettier**. Format on save.
- **Console logs use emoji prefixes** (`📄 [DocGen]`, `🔧 [Tool]`).
- **Comments are lean.** Don't translate the code line-by-line. New
  comments only for non-obvious invariants, external contracts, or trade-offs
  (one sentence). JSDoc for public APIs and `@deprecated` markers — not
  every function. A patch where comments outnumber executable lines is too
  comment-heavy.
- **Imports are absolute or workspace-relative**. Don't reach across
  packages with `../../../`.

---

## Prompt Engineering

Rules for authoring Handlebars prompt templates under
`packages/ant-cli/src/core/prompt/templates/`.

### 1. WHAT / HOW separation

| Prefix       | Role | Content                                    |
|--------------|------|--------------------------------------------|
| `base*.md`   | WHAT | Context, data, current state, dynamic interpolation |
| `rules*.md`  | HOW  | Rules, formats, constraints, prohibitions  |

For new or substantively rewritten files, do not put `⚠️ You MUST` /
`DO NOT` directives in `base*.md`, and do not put `{{{interpolations}}}` in
`rules*.md`.

### 2. Directory layout

```
templates/
├── domain/{d}.md            workspace-level domain identity (service / game)
├── basis/                   tier-gated content + shared partials
├── jobs/{job}/
│   ├── base/{system,user,injections}/   job-level shared blocks
│   ├── domain/{d}.md                    job × domain overlay
│   ├── basis/                           job × tier overlay
│   └── nodes/{node}/
│       ├── {base,rules}.md              default
│       └── variants/{v}/{base,rules}.md variant-specific
├── jobs/shared/nodes/{node}/variants/{v}/{base,rules}.md  cross-job
└── infra/                   infra-level partials (compaction, etc.)
```

Templates are auto-registered as Handlebars partials by `initPartials()` at
server startup. **Files under `templates/basis/**` are intentionally not
registered.** Use `_*-private.md` named partials in `jobs/...` if you need a
private partial inside a basis-adjacent file.

### 3. Language and platform neutrality

All prompt templates are **English only**. No project-specific examples
(`Hero.tsx`, `page.tsx`), no platform-specific terms (`React`, `Tailwind`,
`Next.js`). Use generic, platform-neutral wording (`component`,
`container`, `element`).

Ant supports frontend / backend / fullstack across multiple languages.
Prompts must not assume a stack.

### 4. FPOP — First-Principles Observation Prompting

Every prompt follows six principles:

| Principle                        | ❌ Bad                              | ✅ Good                                  |
|----------------------------------|-------------------------------------|------------------------------------------|
| Principles over Examples         | "Footer is a column"                | "Each container decides direction independently" |
| What over How                    | "Top → flex-start"                  | "Observe cross-axis position"            |
| Observable over Assumed          | "Add overlay"                       | "If not observed, do NOT add"            |
| Universal over Specific          | "React component"                   | "component"                              |
| Constraints over Instructions    | "Do this way"                       | "Do NOT assume"                          |
| Reminders for Blind Spots        | generic list                        | "⚠️ Cross-axis REQUIRED"                 |

### 5. SBS — Scope-Bound Specificity

A prompt fragment's required abstraction level is bounded by its activation
scope. **Gated templates** (techTier / intent / taskType / mode / role /
artifact-presence) MUST be specific along the gate's axis. **Always-on
templates** must stay universal.

`basis/techTier/framework/nextjs.md` MUST mention "Next.js" by name — its
gate is the entire reason it exists. Citing "Universal over Specific"
against a gated file to demand removal of the gate's discriminator is itself
an SBS violation.

For each paragraph in a template, run two checks:

1. **SBS check**: Is this paragraph specific along the file's gate? If no,
   either lift it to a less-gated location or rewrite it to use the gate
   discriminator name(s).
2. **FPOP check**: Is this paragraph specific along an axis other than the
   file's gate? If yes, that's scope creep — lift it out or remove it.

A compliant paragraph passes both: specific exactly along the gate,
generic everywhere else.

---

## Cross-Package Contracts (`@ant/shared`)

`@ant/shared` is the single source of truth for types that cross BE↔FE:

- `JobType`, `DecomposableJobType`, `SessionableJobType`
- `KanbanData`, `BaseTask`, `TaskStatus`
- `WorkflowRealtimeState` — real-time SSE event payloads
- `InterruptionDetails`, `InterruptionReason`
- `InferredAction`, `Mode`, `IntentGroup`
- `ResolvedActionContext`, `TechTier`, `ResolvedArtifact`

Adding a new shared type is a contract change. Land the type with both BE and
FE consumers in the same PR when possible, and write a regression test in
`packages/ant-cli/tests/` that exercises the new shape.

---

## Where to Read Next

- The **regression-grade** rationale for every rule above (incident-driven
  invariants, enforcement greps, test names) lives in
  [`docs/internals/`](docs/internals/). Read it when you're touching the
  graph, prompt builder, or SSOT functions.
- The **user-facing** explanations of agents, jobs, and tiers live in
  [`docs/concepts/`](docs/concepts/).
- The **how-to** guides (self-hosting, design input, custom prompts) live
  in [`docs/guides/`](docs/guides/).

If you find a rule in this file that contradicts the code, the **code is
authoritative** for runtime behaviour, but please file an issue so we can
update the document.
