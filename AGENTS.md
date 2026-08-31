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

| You want to…                          | Read                                                |
|---------------------------------------|-----------------------------------------------------|
| Understand the system in 5 minutes    | [docs/concepts/architecture.md](docs/concepts/architecture.md) — user-facing explanations of agents, jobs, tiers live alongside it |
| Set up, build, test                   | [CONTRIBUTING.md](CONTRIBUTING.md) · [docs/develop.md](docs/develop.md) |
| Add a new agent / job / phase node    | This file, then [docs/internals/](docs/internals/) — incident-driven rationale, enforcement greps, test names |
| Touch the universal / custom-agent runtime | [Universal Runtime](#universal-runtime--one-jobtype-file-defined-jobs), then [docs/internals/44-universal-job.md](docs/internals/44-universal-job.md) |
| Touch the pipeline scheduler (cron, chaining, approval gates) | [docs/internals/46-pipeline-scheduling.md](docs/internals/46-pipeline-scheduling.md) |
| Author or edit a prompt template      | [Prompt Engineering](#prompt-engineering)           |
| Touch the LangGraph state machine     | [LangGraph State Management](#langgraph-state-management) |
| Make a change that crosses BE↔FE      | [Cross-Package Contracts](#cross-package-contracts-antshared) |
| Touch a security boundary (paths, origins, child processes, resource budgets) | [`docs/internals/security-posture.md`](docs/internals/security-posture.md) — the seven-axis SSOT |
| Self-host, design input, custom prompts | [docs/guides/](docs/guides/)                      |
| Run the custom-agent + MCP example end-to-end | [examples/README.md](examples/README.md) — not product code, never loaded at runtime |

If a rule here contradicts the code, the **code is authoritative** for runtime
behaviour — please file an issue so the document gets fixed.

---

## Architecture in One Page

Ant is a **modular monolith** packaged as four independent processes
(`ant-api` 4100 / `ant-realtime` 4101 / `ant-job` / `ant-preview` 4102) that
communicate **exclusively via Redis** — Pub/Sub, Key-Value, BullMQ. There is no
direct HTTP between processes. The backend is hexagonal: `composition/` entry
points, `core/` domain logic, `agents/` LangGraph graphs, `infrastructure/` and
`periphery/` adapters.

A job flows: HTTP request → BullMQ enqueue → `JobWorker` spawns `job-runner.ts`
as a child → `orchestrator.ts` routes to a LangGraph agent graph → state
broadcasts over Pub/Sub → completion publishes to `job:status:updates`. Jobs are
interruptible and resumable; checkpoints live at
`{featurePath}/sessions/{agent}/{jobType}.json`.

Process table, entry points, and the job-type → agent → output matrix are in
[docs/develop.md](docs/develop.md); the narrative walkthrough is in
[docs/concepts/architecture.md](docs/concepts/architecture.md) and
[docs/concepts/jobs.md](docs/concepts/jobs.md). Read those before changing
topology; the rules below are what binds when you write code.

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
- Tenant resolution is always enforced. Cloud mode authenticates every request
  (JWT); local mode resolves the single `local:local` tenant WITHOUT an HTTP
  auth gate — `ServerConfigurator.setupAuthentication` early-returns, because
  local mode is a single-developer trust boundary. Never widen that fork beyond
  auth-tenant resolution.

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
[`docs/internals/NODE_GRAPH_LAYOUT.md`](docs/internals/NODE_GRAPH_LAYOUT.md).

---

## Three-Axis Task Modeling — type / band / priority

Task classification is split across **three orthogonal axes** observed by
different actors:

| Axis            | Observer       | Decides                                             | Domain                                 |
|-----------------|----------------|-----------------------------------------------------|----------------------------------------|
| `task.type`     | LLM            | "What action mode is this task in"                  | `feature` / `error` / `verification` / `ui` / `design-system` / `test-code` / `doc` / `setup` / `explain` |
| `task.band`     | Orchestrator   | Scheduling position by dependency order             | feature: `'foundation'` / `'platform'` / `'integration'` / `undefined` · setup: `'root'` (project/framework/workspace-level, priority 100) / `undefined` (package setup) |
| `task.priority` | TaskQueue      | Sort order in the queue                             | Integer — sort comparison only         |

**`task.priority` may be compared only inside `TaskQueue.push()`'s sort
callback.** Phase nodes, routers, parallel scheduling, classification, and
type decisions MUST NOT compare priority semantically. The single legal
priority-to-meaning translation lives in
`decompose/responseParser.ts::deriveBandFromPriority` — a **strict reverse lookup
over the `TASK_PRIORITY` window map** in `code/state.ts`, so the band→window
forward map and the priority→band reverse lookup cannot drift. Strict means
window-exact: `setup.root` is `100..100` (the unique workspace-level setup, which
dequeues first — `101+` is band-absent package setup), feature bands are
`foundation 220..259` / `platform 260..299` / `integration 600..649`, and the
adjacent `design-system 200..219` window never derives a feature band.
Everything downstream reads `task.band` (feature / setup) or `task.type`
(everything else) — never the integer.

`band` is carried only by `FeatureTask` (`FeatureBand` = foundation / platform
/ integration) and `SetupTask` (`SetupBand` = `'root'`) via discriminated
union — `{ type: 'verification', band: 'root', ... }`, `{ type: 'feature',
band: 'root', ... }`, and `{ type: 'setup', band: 'foundation', ... }` are all
compile errors.

A `band:'root'` setup owns ONLY root-level artifacts (workspace manifest +
member glob + shared config + infra in a monorepo; the lone manifest + tooling
config in a monolith) and creates **no** member directory or name. Every other
member is created and named by its own band-absent setup — the workspace glob
discovers it. This is the structural fix for stranded "husk" package
directories (two setups naming the same boundary differently).

---

## Task Description Authorship — `BaseTask.description`

The fourth task axis is **content**: `description` is the LLM-authored
per-task scope of work — the work statement plan/execute receive, the Kanban
card body, and (when no plan is sealed) the ENTIRE execute instruction.

**Assigning the job-level user directive (`state.directive` /
`state.overrideDirective`) to `task.description` is FORBIDDEN.** The directive
reaches every prompt on its own channel (`# User Directive` / `{{directive}}`);
copying it into tasks makes every task identical, erases the decompose LLM's
per-task reasoning, and double-injects the same text under contradictory
framing. Also forbidden: a second field carrying per-task scope alongside
`description` (the historical `DesignTask.sectionScope` split), and two render
sites for the same field in one prompt.

Legal producers: the decompose/revise LLM verbatim, or a deterministic helper
that *names* the unit of work without pasting the directive
(`specDecompose.buildRevisionScope`, `prdSync` task factories). Floor:
non-empty after trim (`isTaskDescriptionAuthored` in `@ant/shared/task.ts`),
enforced at task creation — code decompose retries with framing
(`MissingTaskDescriptionViolation`), design ui/system/game-art throw into
their repair round, spec synthesizes `buildFullSpecScope()`. Never enforced in
`TaskQueue.from` (checkpoint restores must not throw).

`sectionScope` survives only as a local variable in design
`execute/intent/system.ts` (catalog-computed section assignment) — it is not a
task field.

```bash
rg -n "description:\s*(state\.)?(override)?[dD]irective\b" packages/*/src --type ts  # Expected: 0
```

Regression guard: `tests/policy/task-description-authorship.test.ts`.

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
see [`docs/internals/17-code-verification-task.md`](docs/internals/17-code-verification-task.md).

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

`state.executionTier?: ExecutionTierId` is derived — decompose writes it once,
after the LLM emits `<executionTier>N</executionTier>`. Phase nodes read it only
through the `getExecutionTier(state)` facade (`executionTier.breadcrumb(...)` /
`.boundary(...)`), and must never inspect `mode` / `complexity` literals
themselves (`if (state.resolvedAction?.mode === 'explain' && …)`). Mode dispatch
lives in exactly one place: `Tier3Task`'s constructor.

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
[`docs/internals/36-output-tag-matrix.md`](docs/internals/36-output-tag-matrix.md).

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

`read_file` / `list_files` enforce a RAC whitelist for **explicit** pipelines.
The policy SSOT is
`code/nodes/decompose/racGate.ts` — `computeRacScope` (returns a scope only when
`source === 'explicit'` ∧ `hasExplicitFields` ∧ `refs ∪ context` non-empty; infer
pipelines get `undefined` and may discover freely), `decideRacGate`, and
`isWithinRacWhitelist`. It is applied at exactly two symmetric sites: decompose's
inline tool dispatch, and the shared code `tool` node that serves plan and
execute. Two families stay RAC-**orthogonal** and are always reachable: paths
under `codebase/` (classified via `normalizeToCodebasePath`) and the
`assets/{service,game,gen}/**` pools. Never push this gate into the common
`readFile` / `listFiles` handlers — design and planner jobs have no RAC to honor.

### The user's selection outranks the directory allowlist

A file's **location must never decide whether the job is told it exists.** Four
layers used to re-derive "is this a real file I may use?" from a directory
allowlist, and an attached screenshot lost at every one of them
(`near-loading-brace`). The owners now key off the user's selection or the bytes:

| Question | Owner | Keyed on |
|---|---|---|
| Did the user's slots survive an inferred RAC? | `inferRacWithTools` (`metadata` input → `mergeWithMetadata`) | the FE's `actionMetadata`, additively — inference may ADD, never REPLACE |
| Which UiSource wins a merge? | `pickUiSource(paths, preferred)` + `filterToUiSource` | the source the USER selected outranks the static `ant > figma > handoff` |
| Is this artifact existence-only? | `loadResolvedArtifacts` content sniff → `ResolvedArtifact.kind` | the bytes, in any directory |
| Does it ride along past `task.include`? | `ridesAlongRegardlessOfInclude` | `kind === 'binary'` |
| May the job place it? | `effectiveAssetInventory` | domain pool ∪ attached binaries |

### ❌ Forbidden

- Dropping `actionMetadata.refs` / `context` / `target` / `basis` because the
  turn carries no explicit `intent`. Absent intent means "the user did not pick
  an action", not "the user selected no files".
- Deciding a UiSource verdict **per slot** when a caller-supplied preference is
  in play — `refs` and `context` diverge and the RAC comes out mixed. Decide once
  over refs ∪ context, then filter both.
- A new directory allowlist answering "is this a real/placeable file". Sniff the
  bytes (`ResolvedArtifact.kind`) or ask the RAC.
- A prompt surface that tells the model a real file it was given is not usable
  (the handoff caption's "generate placeholders" vs the `[asset]` stub's "copy
  it" — the model obeyed the wrong one and shipped dead placeholders).

```bash
# The infer path must forward the user's slots — dropping this line is the bug.
rg -n "metadata: state\.actionMetadata" packages/ant-cli/src/agents/common/graph/nodes/detect/index.ts  # Expected: 1
# The stub decision is the sniff; the prefix list governs TEXT only.
rg -n "isStubLoadedPath\(" packages/ant-cli/src --type ts  # Expected: 2 (definition + the one text-branch call)
```

Guards: `tests/detect/metadata-supplement-merge.test.ts`,
`tests/policy/{rac-scope-invariant,asset-surface-boundary,uiSourceExclusivity}.test.ts`,
`tests/prompt/attachment-injection-gate.test.ts`.
Rationale: [`docs/internals/47-attachment-awareness.md`](docs/internals/47-attachment-awareness.md).

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

## Universal Runtime — One JobType, File-Defined Jobs

Custom agents/jobs (the **workspace** project kind) execute on one generic
runtime. The invariants below exist because each was violated once and cost a
debugging session.

### ❌ Forbidden

- **Minting a JobType for a custom job.** A new JobType costs hand-copied
  unions in 5+ places; a custom job is *data*, not a code path.
- Forking `customJobRef` or `UniversalTurnMeta` onto a second channel — one
  env var each (`ANT_CUSTOM_JOB_REF`, `ANT_UNIVERSAL_TURN_META`), turn meta as
  one JSON rather than a CSV per axis.
- **Inferring credential-ness from a value's shape** (the deleted bare-ALL-CAPS
  heuristic) — it cannot tell a key name from a legitimate literal, and it
  silently killed job starts.
- A `process.env` fallback in credential resolution, or `...process.env` into a
  stdio MCP child — either turns a definition into an exfiltration vector.
- Treating checklist items as tasks: no TaskQueue, no kanban cards, no
  `billableTaskCount`.
- Offering a path in the `@ctx:` picker that the tool sandbox cannot resolve.
  The attachable set is DERIVED from the agent plane
  (`resolveUniversalAgentPlanePath` — artifacts ∪ `pipeline-runs` ∪ `_agents`,
  never `sessions`); adding a mount without teaching that resolver, or the
  reverse, re-creates the attachable-but-unreadable bug.
- Grafting an account-scoped root (agent definitions) into the project file-tree
  endpoint. It is cached per project × feature for 24h and the account-scoped
  write funnel cannot bust that key — the `_agents` subtree is a picker-side
  client merge.
- Re-judging the project × jobType gate anywhere other than the truth table,
  or letting a definition error crash the worker child instead of answering 400
  at accept.
- Silently ignoring a removed yaml key — an author concludes the knob works.
- **A per-turn pre-classification LLM pass** (intent, tier, or anything else)
  before the agent call. Unpinned turns resolve deterministically:
  explicit → inherited (clarify continuity) → `general` (there is no catalog
  default); the Intent Catalog rendered into the agent prompt — each intent's
  `infer.md` criterion — is what informs in-turn self-selection. This was
  built twice and removed twice — the latency/cost of a non-streaming call
  per turn buys nothing an informed prompt doesn't.

### ✅ Correct

- `jobType='universal'` for every custom job; the definition rides
  `customJobRef = "{agentId}/{jobId}"`.
- Capability extension has exactly TWO declaration channels: `mcp.servers`
  (MCP servers, stdio/http) and `apis` (declared REST API connections for
  systems with no MCP server — baseUrl + `${secret:}` headers + optional
  method/path `allow`; the runtime synthesizes `api__{name}__get` /
  `api__{name}__request` in-process). Both share the credential store, the
  approval gate, and result spooling. API *knowledge* (endpoints, fields,
  sequences) is never declared — it is prose in `base/`, intent `prompt.md`,
  and `on-demand/**` docs (paths-only index rendered into the system block —
  the bodies never inline, so the channel costs no prompt budget). No
  per-endpoint tool schemas, no OpenAPI→tools import.
- An `apis` entry takes one of two mutually exclusive forms: external
  (`baseUrl` + `headers`) or `self: true`, which targets Ant's own API and
  carries NEITHER — the runtime resolves the origin from `ANT_API_URL` and the
  bearer from the token minted at accept. It is the only `apis` form a builtin
  agent may declare (same reason MCP is forbidden there: a shipped definition
  assumes no install URL and no registered credential).
- **A definition's `allow` list is not a security boundary** — the definition is
  user-editable, so the pin is never scoped per definition. For a self entry the
  boundary is `createSelfApiScopeGuard`, mounted after authentication on `/api`
  (ant-api) and on the realtime server. A `scope: 'self-api'` token reaches
  **`/definitions` and nothing else** — the scoped-template family — whose two
  resources carry deliberately OPPOSITE polarity:
  - `/definitions/agents` — **allow-except**: the whole resource is authoring,
    minus `promote` / `editors` (authority spread) and `import` /
    `files/upload` (they skip `gateDefinitionSave`).
  - `/definitions/pipelines` — **deny-except**: most of that resource is
    OPERATIONAL, so only the authoring shapes are listed (`GET|POST` on the
    root, `GET|PUT|DELETE` on `:id`, `GET :id/permissions`,
    `POST preview-fires`, `GET activatable-projects`) and everything else —
    present or added later — is refused. `enable` / `disable` / `activate` /
    `deactivate` / `run-now` / `promote` / `editors` / `approvals` / `runs` are
    a person's decisions; a job drafts, a person publishes. Never invert this
    polarity: an allow-except list here would admit every route added after it.
  A `:id` rule must exclude its resource's reserved literals (`preview-fires`,
  `activatable-projects`, `approvals`, `runs`) — Express disambiguates them by
  registration order, the guard matches independently, so
  `GET /definitions/pipelines/approvals` would otherwise ride the `:id` shape.
  The realtime server has no `/definitions` surface, so the same guard refuses
  the claim there wholesale — a job-minted token must not open its owner's SSE
  stream or `/bridge/*`. Absence of the claim is an ordinary session, never a
  pin. Minting stays in the process holding the JWT private key (C-001).
- **Definition writes have one funnel**: `PUT /definitions/agents/:agentId/file` →
  `gateDefinitionSave` → `loadCustomJob`. A job authors definitions by calling
  it (the builtin `agent-builder`), never by writing the files directly — which
  is also why `run_command`'s containment check runs on every plane, not only
  where the `codebase/` prefix rule applies. Pipelines are the same shape one
  resource over — `POST|PUT /definitions/pipelines` under the same pin — but no
  builtin holds that half. `agent-builder` authors what an agent DOES and
  FILTERS calendars and cross-intent run order out (doc 44), and its `allow`
  names only the agents resource; the agent that composes a finished agent's
  intents into a schedule is **authored by the user through agent-builder**, in
  their own scope. The pin admits it because `declaresSelfApi` reads the
  definition, not the scope — a user-scope agent declaring a self entry gets
  the same token a builtin would.
- **HTTP groups name a KIND, not an owner.** `/api/definitions/**` is the
  scoped-template family (`user` | `org` | `builtin` roots, closest-wins,
  promotable, project-independent, one shared `orgAclStore.ts`) and holds
  `agents` + `pipelines`; `/api/credentials/**` holds `{org, user}`-keyed secret
  stores. A resource joins the family it belongs to — **"the bare name was free"
  is not a reason to mount at the root**, and that ad-hoc rule is exactly how a
  template ended up spelled `/api/account/agents` in one place and
  `/api/pipelines` in another. `/api/agents` is the PUBLIC canonical job-agent
  catalog and is a different concept from a custom agent definition. The full
  table, including what is still bare, is in
  [docs/reference/api.md](docs/reference/api.md#grouping-rule--by-kind-not-by-owner).
- `decideProjectJobGate` (`core/customAgents/universalContainer.ts`) is the one
  bidirectional truth table; enforcement is HTTP 400 at job-accept.
- `${secret:KEY}` (`MCP_SECRET_REF_PATTERN`) is the only credential marker;
  everything else is a literal. `validateMcpServers` in `@ant/shared` is the one
  rule set, with three failure shapes (throw / 400 / form-disable).
- `buildStdioChildEnv()` allowlist for stdio children; `McpConfigError` →
  `config_invalid`, never `process_crash`.
- Phase-node blindness applies here too: the universal graph must not learn
  `task.type` or execution tiers — it has neither.

```bash
rg -n "process\.env" packages/ant-cli/src/core/customAgents/McpCredentialResolver.ts  # Expected: 0
rg -n "ExecutionTier|executionTier" packages/ant-cli/src/agents/universal            # Expected: 0
# The attachable set has ONE owner; the gate and the band both go through it.
rg -n "resolveUniversalMergedPath" packages/ant-cli/src/core/scheduling packages/ant-cli/src/agents/universal  # Expected: 0
# The pin is one rule, mounted whole-surface on each cookie/bearer server — never re-judged per route.
rg -n "createSelfApiScopeGuard\(" packages/ant-cli/src                              # Expected: 3 (definition + api mount + realtime mount)
rg -n "ANT_THREAD_ID|threadPaths|getAgentThreadPath" packages/*/src                  # Expected: 0
```

Guards: `tests/customAgents/{custom-agent-loader,builtin-agents,universal-container,universal-tool-policy,universal-prompt-injection,universal-checklist,universal-turn-context,universal-mcp-runtime,mcp-credential-store}.test.ts`.
Full rationale: [`docs/internals/44-universal-job.md`](docs/internals/44-universal-job.md);
MCP orchestration & capability-server contract:
[`docs/internals/45-mcp-orchestration.md`](docs/internals/45-mcp-orchestration.md).

---

## Authorization Answers Whose, Never How Much

**An authenticated route is not a budgeted one.** Every gate on
`/jobs/:jobId/continue` — access, approval, membership, credit, canonical-project,
pipeline-ownership — proved WHOSE session it was, and none of them bounded the
work: the handler then read that session, unshifted another directive, and wrote
it back with a raw `fs.writeFileSync()`, outside the byte budget every reader
enforces. The same split produced `chat/job-error` (no schema, no cap, no rate
limit) and a job-history scan that parsed 5,000 session files into one response.

Three rules; each later one is why the one before it kept failing:

- **Each authenticated route carries its own field caps, request rate, and
  response-materialization budget.** A per-item cap is not a per-request bound.
- **A seam is adopted by FILE, not by call name.** `atomicWriteFile(` was the
  guard, so three writers reached the same session files by a different shape and
  no test failed. Enforce the offense as "this path reached a write that is not
  the seam", whatever that write is spelled.
- **Seam adoption is enforced in TYPE space, not by name greps.** Four audit
  rounds keyed the guard on names (literal paths → call names → variable names)
  and each round a differently-spelled caller slipped past — names are
  re-spellable by construction. The closed form is a branded type with a single
  mint (`boundActionMetadata` → `BoundedActionMetadata`) that every consumer
  signature between an ingress and a durable/broadcast/env sink requires: a new
  typed ingress fails `pnpm typecheck`, not a regex. Greps survive only for what
  the compiler cannot see — brand fabrication (`as BoundedActionMetadata`, a
  finite spelling) and the `any` trust boundaries (HTTP `req.body`, queue/env
  replay), each of which pairs with a RUNTIME re-check calling the same mint.
  An open-shaped object (`.passthrough()`) is budgeted by its **whole serialized
  size**, never by field enumeration — an unknown field is outside a field-cap
  model by definition.

### ❌ Forbidden

- Writing a session JSON by any route other than `writeSessionBounded()` — raw
  `fs.write*`, or a hand-rolled tmp+rename. A read-modify-write passes
  `{ expect: sessionWriteGuardOf(text) }` built from the bytes it already read;
  it does not re-read, and it does not add a lock.
- Passing action metadata to a durable/broadcast/env consumer as a raw object —
  the consumers take `BoundedActionMetadata`, and the only mint is
  `boundActionMetadata()` (typed 413 / typed job failure on over-budget).
- REFUSING an append to bound a JSONL log. Readers already serve only the newest
  window, so the fix is retention (trim to that window — observably lossless),
  never a rejection that stops chat working. The ONE exception is a single line
  over `JSONL_LINE_MAX_BYTES`: appended, it swallows the whole tail window and
  every bounded reader returns zero lines (the log goes blank), so refusing that
  line — before append AND broadcast — is the only observably-lossless outcome.
- THROWING when an enumeration budget runs out on a display-only path. Degrade
  (less folder compression, a `truncated: true` sibling key); never fail a request
  that would otherwise have succeeded.
- Registering a cross-pod lock on one side only. The API process and the job-runner
  child append to the same logs on the same mount.
- Capping a field that is serialized into a durable line by its per-field length.
  Cap the SERIALIZED value — a join or a `JSON.stringify` amplifies past it.
- A guard that enumerates the routes someone remembered. Enumerate the SET.

### ✅ Correct

- `writeSessionBounded()` sheds in a fixed order — snapshots → conversations →
  diagnostics → oldest `runs[]` — and only then refuses, leaving the previous valid
  file untouched. The resume core (`taskQueue` / `currentTask` / `completedTasks` /
  `interruption` / `jobId`) is never shed.
- Count and reserve in ONE step: `StateStorePort.reserveSlot` (Redis ZSET + Lua).
  A read-then-compare admits N callers past an N-1 cap — SSE slots (M-005),
  pipeline concurrent runs (L-031), and uploads all share that shape.
- Asymmetric lock failure where the two operations have asymmetric stakes: an
  append is best-effort (never lose a line to a slow lock), a whole-file rewrite
  requires the lock (never race one silently).
- A per-account share of any pod-local ceiling, released on the same
  `finish`/`close`/`aborted` the pod counter uses — a second lifetime is a second
  leak.
- The chat.jsonl append seam owns two field-agnostic invariants: no single line
  past `JSONL_LINE_MAX_BYTES` (typed refusal, no SSE echo of a line no reader
  could return), and a streaming heal that drops pre-cap oversized lines without
  materialising them when retention finds zero complete lines in the window.

```bash
# The write seam is a property of the file, not of one call name.
rg -n "fs\.(writeFile|writeFileSync)\(\s*sessionPath" packages/ant-cli/src  # Expected: 0
# Every chat POST carries both gates.
rg -c "chatRateLimiter" packages/ant-cli/src/periphery/adapters/http/routes/chat.routes.ts  # Expected: >= 5
# The actionMetadata brand has ONE mint; a cast is the only spelling that bypasses the compiler.
rg -n "as (unknown as )?BoundedActionMetadata" packages/ant-cli/src --type ts  # Expected: 1 (the mint)
```

Guards: `tests/policy/contained-io-adoption.test.ts`,
`tests/policy/resource-admission.test.ts`, `tests/http/resource-admission.test.ts`,
`tests/security/session-namespace-bounds.test.ts`. Rationale:
[`docs/internals/security-posture.md`](docs/internals/security-posture.md) Axis 7.

---

## An Authenticated Route Is Not an Approved One

**Account approval is an identity verdict, so it bounds the whole authenticated
surface — never a list of routes.** `UserRecord.approvalStatus` used to be six
hand-placed pre-flight calls at compute-start handlers (job start/learn/resume/
continue, chat, team create). That blocked starting agent work and nothing else:
a `pending` account still created and deleted projects, uploaded files, booted
preview/deploy children, attached a GitHub PAT, wrote agent definitions, drove a
live IDE pod, opened every SSE stream, and minted a 90-day desktop token. The
list WAS the bug — it grows by whatever the next author remembers.

### ❌ Forbidden

- Re-judging approval inside a route handler. The surface guard has already
  answered; a second owner drifts (the `teams.routes.ts` copy had already
  diverged to a different fail-open posture than the other five).
- Re-listing the public paths as approval exemptions. The guard keys on
  `req.user`, which `createJwtAuthMiddleware` sets only for non-public requests,
  so the exemption is DERIVED from `PUBLIC_PATHS`. A second copy drifts.
- Putting an approval claim in the JWT. The cookie lives days and the desktop
  token 90; an admin approving would not take effect until re-login, which is
  precisely the operator workflow.
- A process-local TTL cache of the verdict. It re-introduces a second answer
  source for a decision whose whole point is immediacy — a `denied` account
  keeps working for the TTL.
- Mounting on ONE plane. Express is not the only way in: the `/ide/*` proxy is
  served before `setupAuthentication` and never calls `next()`, and the bridge
  WebSocket upgrade bypasses Express entirely.

### ✅ Correct

- `createRequireApprovedAccount()` mounted whole-surface on every server that
  authenticates a cookie or bearer, plus the `/ide/` proxy lane; `checkApproval`
  stays the single read of the port and the single fail-open posture.
- Fail-OPEN on a repository error. Redis is the whole system's dependency, so a
  blip that flipped this closed would convert an outage into a total lockout of
  every approved user, reported under a misleading pending code.
- `/admin` exempt: it carries a strictly stronger env-authoritative gate
  (`isSuperAdminEmail`), and `setUserApproval` can stamp a super admin `denied`
  while `syncSuperAdmins` only re-approves at boot — gating it bricks the
  operator out of the screen that undoes the mistake.
- FE: one state-driven branch (`selectShowApprovalGate`) replaces the app shell,
  and `selectIsAuthBlocked` parks every protected fetch, so the screen does not
  sit in front of a 403 storm.

```bash
# One rule, mounted on each plane that admits an identity — never re-judged per route.
rg -n "createRequireApprovedAccount\(\)" packages/ant-cli/src  # Expected: 5 (definition + api + ide + realtime + preview)
# The port read has ONE owner; its callers are the three planes, not handlers.
rg -n "checkApproval\(|getUserApproval\(" packages/ant-cli/src/periphery/adapters/http/routes/*.routes.ts  # Expected: 0
```

Guards: `tests/policy/resource-admission.test.ts` (mount order + the SET, read
from the codebase so a fifth server cannot skip it),
`tests/billing/approval-capability-seam.test.ts` (the guard's decision table),
`tests/auth/lifecycle-guard.test.ts` (FE truth table + branch ordering).

---

## Untrusted Content and the Control Plane Are Different Origins

**A browser origin that serves user-authored content MUST NOT also answer a
cookie-authenticated control-plane API.** `ant-preview` does both jobs — it serves a
public deploy's build output and a user's own dev server, and it exposes
`/projects/*`, which starts previews and writes a feature's `.env`. On one origin,
script inside a deployed SVG or HTML page runs same-origin with that API and drives
it with the viewer's session. The session cookie is `HttpOnly`, which does not
help: the browser attaches it anyway.

### ❌ Forbidden

- Mounting any control-plane route on the content listener (`this.contentApp`).
- "Fixing" this with an SVG/HTML filter, a blanket CSP, or by stripping cookies on
  the proxy hop to the upstream. None of them addresses the sink, which is the
  browser's own origin model.
- Comparing origins by **hostname**. `isSelfOrigin` compares scheme + host + port;
  a hostname-only test silently re-merges the two listeners.
- Accepting a cookie-authenticated state change whose `Sec-Fetch-Site` is
  `same-site` (that is precisely the content listener) — only `same-origin` /
  `none`, or an exact-match registered frontend origin.
- Admitting a request on `Sec-Fetch-Mode: navigate` / `Sec-Fetch-Dest`. A GET
  navigation carries no `Origin`, and in a split-host deployment its
  `Sec-Fetch-Site` is `same-site` — indistinguishable from attacker content. The
  `/ide/*` iframe is admitted by a short-lived capability minted through a
  CSRF-guarded POST instead; see
  [`docs/internals/23-cloud-ide.md`](docs/internals/23-cloud-ide.md).

### ✅ Correct

- Content on `ANT_PREVIEW_CONTENT_PORT`, control plane on `PORT`; the process
  refuses to boot if they are equal.
- `createSameOriginGuard()` after cookie-parser on every server that authenticates
  by cookie. `Authorization: Bearer` callers are exempt — a bearer token is not
  ambient.
- Body parsers mount AFTER authentication: an unauthenticated request must not make
  the process parse a 50 MB body before it is told 401.

```bash
rg -n "contentApp\.(get|post|put|delete)\('/(projects|admin)" packages/ant-cli/src  # Expected: 0
rg -n "sec-fetch-(mode|dest)" packages/ant-cli/src/periphery/adapters/http/middleware/sameOriginGuard.ts  # Expected: 0
```

Guards: `tests/http/preview-origin-split.test.ts`, `tests/http/same-origin-guard.test.ts`,
`tests/http/ide-gate-admission.test.ts`, `tests/cors/cors-matrix.test.ts`. Rationale: [`docs/internals/security-posture.md`](docs/internals/security-posture.md) Axis 5.

---

## Child Process Boundaries — env profile, credential scope, OS identity

Preview, deploy and code-job children run **user-authored code**, and their
stdout/stderr is streamed back to the requester. Three separate rules, each violated
once:

1. **Env profile.** `composeChildEnv()` (preview/deploy) honours
   `ANT_PREVIEW_ENV_PASSTHROUGH`; `composeCommandChildEnv()` (code-job
   `run_command`) honours nothing. An operator naming a host variable so a dev
   server boots did not consent to it reaching every LLM-chosen command and its
   chat transcript.
2. **Namespace denial is by NAME, never by value shape.** The credential-marker
   list is a name test, and a live credential need not look like one —
   `ANT_REDIS_URL` carries the data plane with no `TOKEN`/`SECRET`/`AUTH` in it. The
   inherited/passthrough path refuses the whole `ANT_*` namespace plus bare
   connection-URL names. Project `.env` overlays are a different channel and are
   unaffected. Do **not** add value-shape heuristics (see the universal-runtime
   section for why that was deleted once already).
3. **Credentials are scoped to the step that needs them.** A user's PAT reaches the
   `--ignore-scripts` dependency-FETCH pass only; the lifecycle pass re-runs the
   install without it. Installs that cannot use `GIT_CONFIG_*` at all
   (python/rust/java) never receive it.

Every user-authored `spawn()` also spreads `childSpawnIdentity()`, so a deployment
that grants the privilege runs those children under their own UID — a same-UID child
can read `/proc/<service-pid>/environ` whatever the composed env says.

```bash
rg -n "composeChildEnv\(\)" packages/ant-cli/src/periphery/adapters/command  # Expected: 0 (command profile)
```

Guards: `tests/policy/credential-isolation.test.ts`, `tests/preview/installCommand.test.ts`.

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

## Writing Tests & Regression Guards

The suite is large (≈640 files / ≈6,900 cases, ~35s) and that size is fine —
it runs fast and 70%+ of commits touch it. What degrades it is a specific
authoring habit: turning each incident into a new file that pins prose rather
than behavior. These rules exist to stop that.

### Where tests are gated

| Surface | Gate |
|---|---|
| `packages/ant-cli/tests/**` | `pnpm test:cli` + `pnpm typecheck:tests` (CI) |
| `packages/ant-ui/tests/**`, `src/**/__tests__/**` | `pnpm --filter @ant/ui test` (CI) |
| `packages/cloud/tests/**` (ant-cloud) | `pnpm test:cloud` (ant-cloud PR CI) |
| `tests/e2e-mock/**` | `pnpm test:e2e` — needs a live mock server, excluded from `test:cli` by design |

**The build does NOT run tests** and no `prebuild` hook should be added — CI is
the only gate. Test sources are excluded from `packages/ant-cli/tsconfig.json`
because it ships into the runtime image; `tsconfig.test.json` is what
typechecks them. Never add test globs to the shipped config.

`pnpm typecheck:tests` is **blocking in CI** — keep it at zero. It was added
after tests went un-typechecked long enough to accumulate 185 errors across 57
files (stale import paths, task literals missing required fields, `interface X
extends BaseTask` from before that type became a union, spies with too-small
declared arity, and fields already deleted from the types).

### ❌ Forbidden

- **Pinning prompt prose.** `expect(rendered).toMatch(/ONE store instance/)`
  locks an English sentence, so improving the wording fails the build. Assert
  the **gate** instead: does this partial get injected when the gate is on, and
  not when it is off? If the rule can't be expressed as a gate truth table, it
  isn't a contract — don't test it.
- **Testing a gitignored file.** `CLAUDE.md` / `.cursorrules` are gitignored, so
  a test asserting their prose `it.skip`s in CI and on every fresh clone — it
  looks green while checking nothing. Doc-prose sync is not a test's job.
- **A new file per incident.** Add a row to the existing policy test for that
  axis. Codename-named files (`regression-<codename>.test.ts`) fragment one
  invariant across many near-duplicate regexes that then drift.
- **Duplicating a rule in CI shell and in a test.** One owner. Prefer the test —
  it can strip comments and reason about structure; a `grep -vE` heuristic can't.
- **`expect(true).toBe(true)` as a soft skip**, or asserting a constant against
  its own literal. If the case needs env state, stub it (`vi.stubEnv` +
  `vi.resetModules()` + re-import) so the path actually executes.
- **Reaching into another package** (`import … from '../../../ant-ui/src/…'`).
  FE behavior is owned by the ant-ui suite, BE by ant-cli.

### ✅ Correct

- Table-driven policy tests: one file per axis, one row per case.
- Tombstones (asserting a deleted file stays deleted) are valid **in the
  deletion commit**. They accrue no signal afterwards — prune them once the
  removal is a year old and nothing references the symbol.
- Fixtures a test generates belong in `.gitignore`, not in git. A tracked file
  that a test rewrites on every run produces a spurious diff forever.
- When a test and the source disagree, decide which is stale before editing.
  A test pinning a retired model id or a renamed field is usually the stale
  one — but confirm against the commit that changed the behavior.

---

## Prompt Engineering

Rules for authoring Handlebars prompt templates under
`packages/ant-cli/src/core/prompt/templates/`.

### Enforcement status (read first)

Not all policies below are equal. Some fail a build when broken; some are
only reviewer judgement. Treat that difference as load-bearing — a rule with
no automated guard is a **guideline**, not a contract, and must not be cited
as if it were one.

| Policy | Enforced? | Guard |
|--------|-----------|-------|
| MECE / locality / partition gates | ✅ CI | `domain-branching-locality`, `domain-vocab-locality`, `domain-overlay-locality`, `domain-surface-boundary`, `asset-surface-boundary`, `basis-partial-invariant`, `motion-locality`, `service-virtualization`, … |
| WHAT / HOW split (§1) | ⚠️ Guideline | reviewer judgement (transitional — legacy violations tolerated) |
| FPOP (§4) | ⚠️ Guideline | reviewer judgement only — no CI lock |
| SBS (§5) | ⚠️ Guideline | soft sanity grep only — not a build gate |
| Artifact-language ladder (§3) | ⚠️ Guideline | prompt prose; only the inverse is gated — `builtin-agents` (shipped definitions stay Latin-script) |

The policies below are four orthogonal failure-mode axes: **specificity =
activation scope** (SBS, FPOP "Universal over Specific"), **single home /
collectively-exhaustive partition** (MECE, WHAT/HOW), **falsifiable constraints**
(FPOP "Observable", "Constraints over Instructions"), and **self-contained
runtime** — a prompt must not reference internal vocabulary the model was never
given (acronyms, decision IDs, incident codenames). That last axis and "no rule
without a guard" are unenforced: conscious guidelines, not contracts.

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

Prompt **source shipped with Ant** is English only — everything under
`core/prompt/templates/**` and the builtin agent definitions under
`core/data/agents/**`. No project-specific examples (`Hero.tsx`, `page.tsx`),
no platform-specific terms (`React`, `Tailwind`, `Next.js`). Use generic,
platform-neutral wording (`component`, `container`, `element`).

Ant supports frontend / backend / fullstack across multiple languages.
Prompts must not assume a stack.

**This rule does not reach user-authored universal definitions**
(`.ant/agents/**`). Those are one team's data, read and maintained in the agent
settings screen by the person who owns them, and full of proper nouns with no
English form — so their prose follows the requester's language. The universal
runtime states the precedence once, in
`templates/jobs/universal/nodes/agent/rules.md` (Output Channel): an explicit
user instruction → the definition's stated convention → the language of the file
being revised → the language of the user's request. Rungs 2 and 3 above 4 are
what keep an existing file from flipping language on its own. Structural tokens
(ids, yaml keys, paths, tool names, `${secret:}` refs) never localize.
⚠️ Guideline, not a contract — it is prompt prose and pinning it would violate
the no-prose-pinning rule. What IS guarded is the inverse: shipped definitions
carry no non-Latin script (`tests/customAgents/builtin-agents.test.ts`).
Do not re-derive the authored language from `state.language` — it is a binary
ko/en UI locale and cannot express any other language.

### 4. FPOP — First-Principles Observation Prompting — guideline (not CI-enforced)

State observation targets and constraints as **principles**, not as concrete
examples or methods: principles over examples, what over how, observable over
assumed, universal over specific, constraints over instructions, and an explicit
⚠️ reminder for a blind spot the model reliably misses. Concretely — "each
container decides its direction independently", not "the footer is a column";
"if it is not observed, do NOT add it", not "add an overlay".

### 5. SBS — Scope-Bound Specificity — guideline (soft sanity grep only)

**A fragment's required abstraction level is bounded by its activation scope.**
Gated templates (techTier / intent / taskType / mode / role / artifact-presence)
MUST be specific along the gate's axis; always-on templates MUST stay universal.
`basis/techTier/framework/nextjs.md` MUST name "Next.js" — the gate is the entire
reason the file exists, so citing "Universal over Specific" against a gated file
to strip its discriminator is itself an SBS violation.

Run both checks on every paragraph: is it specific along **this file's** gate
(if not, lift it to a less-gated location), and is it specific along **any other**
axis (if so, that is scope creep — lift it out). A compliant paragraph is
specific exactly along the gate and generic everywhere else. Corollary: if you
cannot tell which variant a paragraph came from with the path hidden, the variant
is SBS-empty.

---

## Cross-Package Contracts (`@ant/shared`)

`@ant/shared` is the single source of truth for every type that crosses BE↔FE —
job classification (`JobType`, `DecomposableJobType`), task queue state
(`BaseTask`, `KanbanData`, `TaskStatus`), SSE payloads (`WorkflowRealtimeState`),
interruption metadata, detection types (`InferredAction`, `Mode`, `IntentGroup`),
and RAC / tier types (`ResolvedActionContext`, `TechTier`, `ResolvedArtifact`).
The full inventory is [docs/reference/shared-types.md](docs/reference/shared-types.md).

Adding a shared type is a **contract change**: land it with both BE and FE
consumers in the same PR where possible, and add a regression test in
`packages/ant-cli/tests/` that exercises the new shape. `@ant/shared` also ships
runtime code (canonical paths, the action-config matrix, tier matrices) — after
editing that, run `pnpm --filter @ant/shared build`.

---

## Where to Read Next

The regression-grade rationale behind every rule above — incident-driven
invariants, enforcement greps, and the test that guards each one — lives in
[`docs/internals/`](docs/internals/). Read it before touching the graph, the
prompt builder, or any SSOT function. See the [Quick Map](#quick-map) for
everything else.
