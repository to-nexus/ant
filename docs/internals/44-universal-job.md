# 44 — Universal Job: File-Defined Custom Agent/Job Runtime

Status: Phase 1 (MVP) landed, plus the MCP credential plane (A16/A13) and the
checklist plane. Owner surfaces: `agents/universal/`, `core/customAgents/`,
`templates/jobs/universal/`, `utils/userConfig/` (credential store),
`periphery/adapters/http/routes/{customAgents,accountAgents,mcpCredentials}.routes.ts`.

Capability-server topology, the server-side contract, and the known runtime
gaps live in [45-mcp-orchestration.md](45-mcp-orchestration.md); the
user-facing view is [concepts/custom-agents.md](../concepts/custom-agents.md)
and the codespace/workspace vocabulary is
[concepts/spaces.md](../concepts/spaces.md).

## Why one JobType, not N

A new JobType costs hand-copied unions in 5+ places and ~115 file touches.
Custom jobs therefore NEVER mint a JobType: everything executes as
`jobType='universal'` and the definition travels as an opaque composite key
`customJobRef = "{agentId}/{jobId}"` on the same channel overrideDirective
uses (HTTP body → zod schema → ExecuteJobParams → JobPayload →
`ANT_CUSTOM_JOB_REF` env → job-runner → orchestrator).
Adding/removing a custom job is a pure file operation.

Per-turn axes ride a **second** single-value channel,
`ANT_UNIVERSAL_TURN_META` — one JSON blob carrying
`UniversalTurnMeta {intents[], context[], plan?}`. One JSON, never
comma-separated lists per axis: a CSV env var per axis is how a third axis
becomes a fourth parse site.

```bash
# The ref must never fork into a second channel:
rg -n "ANT_CUSTOM_JOB_REF" packages/ant-cli/src --type ts
# Expected: JobWorker (write), job-runner (read) only.
# Same for the turn meta:
rg -n "ANT_UNIVERSAL_TURN_META" packages/ant-cli/src --type ts
# Expected: JobWorker (write), job-runner (read) only.
# Tombstone — the thread plane is deleted (one chat per workspace):
rg -n "ANT_THREAD_ID|threadPaths|getAgentThreadPath" packages/*/src
# Expected: 0 hits.
```

## Graph shape (designed from runtime concerns, not copied from ask)

`resolve → agent ⇄ tool → respond` (`agents/universal/graph/`). ask remains a
narrow ant-source Q&A job; universal shares the *infrastructure layers*
(createResolveNode, createToolNode, callLLM stream conventions, subagent seam,
compactRun) — not the graph.

- **Context management is inline in the agent node** (`composeUniversalMessages`):
  session history → `compactRun` (compactTurns + TurnPruner) against a
  model-window-keyed budget (85% trigger — conservative Phase 1; the
  conversation is the job's only working memory, over-pruning = work loss).
- **Session**: `{project}/universal/sessions/{agentId}/{jobId}.json` — the
  exact analog of the canonical `sessions/{agent}/{jobType}.json` layout. The
  universal runtime resolves it with `(agentId, jobId)` from
  `requireActiveCustomJob()` via `getSessionFilePath`; conversation rides the
  `session:main` channel so it persists across runs of the same (agent, job)
  pair. Switching the composer's agent/job chips switches sessions, exactly
  like canonical jobType switching within one feature chat.
- **Chat**: ONE chat per workspace — `{container}/sessions/chat.jsonl` +
  `feature.jsonl`, shared across agent/job switches (mirrors one-chat-per-
  feature). Debug logs land under `{container}/sessions/` too: the token /
  execution loggers resolve their debug-dir owner via
  `resolveDebugAgentName()` (`ANT_JOB_TYPE==='universal'` → the custom
  agentId from `ANT_CUSTOM_JOB_REF`, else `'architect'`), so universal debug
  output lives at `{container}/sessions/{agentId}/debug/{tokens,logs}/`
  without minting the canonical `architect` skeleton in the container.
- **No execution tier, no detect node.** Universal deliberately does NOT use
  the canonical execution-tier system: the tier's reason to exist is a
  *decision* (path routing, task-shape contract, budgets — see
  `docs/concepts/execution-tiers.md`), and universal's graph is linear with
  no task plane, so there is nothing for a tier to decide. An earlier
  iteration had a per-turn detect node LLM-declaring a tier AND intent labels;
  it was removed because the tier had zero behavioral consumers (a classifier
  that routes nothing is a label) and the pass cost one non-streaming LLM call
  of first-token latency on every turn. A per-turn intent classifier was
  prototyped again later and rejected on the same overhead grounds — the
  replacement is deterministic (next bullet). `turnContext` (intents / `@ctx`
  paths / planTurn / provenance) is assembled deterministically in
  **resolve** — the single writer. What replaced the tier's would-be roles:
  the **checklist contract** (below) for multi-deliverable shape, and the
  **plan-consumption gate** (resolve lists `plan/{agentId}/{jobId}/` into
  `state.planDocs`; the agent reads and derives) for refs-grounded work.

  ```bash
  rg -n "ExecutionTier|executionTier" packages/ant-cli/src/agents/universal
  # Expected: 0 hits.
  ```

- **Unpinned turns: default intent, then the rendered catalog — never a
  classifier.** An unpinned turn resolves `explicit → the catalog's
  `default: true` intent → ['general']` (`buildTurnContext` in resolve;
  `defaultIntentOf` in `core/customAgents/intents.ts`, validated at most one
  per catalog). Two consumers make an active intent matter — injection
  inlining (`buildCustomJobSystemBlock`) and the per-intent clarify knob
  (`isClarifyEnabled`) — and both honor a default-activated intent exactly
  like a pinned one, because `default` is a registration-time author
  declaration, not an inference.

  For turns that land on `general`, the authored criteria still reach the
  model: `buildCustomJobSystemBlock` renders an **Intent Catalog** section
  (each intent's id + `description` verbatim + the files it carries, via
  `sanitizeCell` — author text is DATA and cannot restructure the block or
  escape it), and every TOC row keeps its first-line summary. Self-selection
  off the TOC is therefore an informed judgment against the authored
  criteria, not a guess from filenames — that gap (descriptions validated as
  "the matching criterion" but never rendered anywhere) is what this section
  fixes. The `general`-suppresses-inlining rule stands: always-on prose
  belongs in `base/`, and a job that wants one situation always active on
  unpinned turns declares it `default: true` instead.

  **The resolution is announced, and `general` says so.** `turnContext.source`
  names which of the three steps fired — `pinned` / `default` / `unpinned`,
  never `infer`, since no step classifies — and resolve emits a chat card from
  it (`core/customAgents/turnContextChat.ts`, plain markdown on the same
  `chatAPI` path as respond's artifact manifest; no canonical tag is emitted,
  so `OutputTagRegistry` — which scopes tags the LLM may emit — is not
  involved). `unpinned` additionally lists the catalog, so an author sees both
  that no declared intent was active and what the agent was choosing among.
  Without it, a turn that fell through to `general` (mapped injections left on
  the TOC, clarify knob unreachable) was indistinguishable in the transcript
  from one running under the intent the author meant — the input-box
  `@intent:` chips only ever showed what was *pinned*, and are cleared on send.

  Guards: `universal-turn-context.test.ts` (default-intent resolution rows,
  `source` rows, card announcement-gate rows),
  `universal-prompt-injection.test.ts` (catalog rendering + sanitize rows),
  `custom-agent-loader.test.ts` (`default` validation rows).

## Checklist — the universal to-do plane (NOT tasks)

Universal has no TaskQueue; its unit of visible multi-part progress is the
**checklist**, authored by the agent LLM itself via the `<checklist>` canonical
tag (TodoWrite model — the contract is always-on in `agent/rules.md`, creation
is conditional):

- **Creation threshold**: only when the work decomposes into 2+ independent
  deliverables. Single-deliverable / answer-only turns have no checklist and
  the board stays empty. Parser enforces: a NEW checklist with <2 items is
  dropped; an UPDATE may shrink to any size.
- **Full-replace semantics**: every emit carries the whole list
  (`- [ ]` / `- [~]` active / `- [x]` done); the last occurrence in a round
  wins. FIFO — at most one active item (parser normalizes extras; the loop is
  a single sequential LLM).
- **Plan grounding**: `<checklist plan="relative/path.md">` records the plan
  doc the list was derived from — display/restore metadata only, no runtime
  consumer.
- **Wiring**: parse/serialize SSOT `core/customAgents/universalChecklist.ts`;
  registry entry `checklist` (consumed — never rendered to chat; the board is
  its only surface); agent node extracts post-stream into the `turnChecklist`
  channel + broadcasts via `kanbanUpdate.updateUniversalChecklist` (cached in
  `KanbanBroadcaster`, rides every kanban frame + Redis snapshot); respond
  seals it; the runner restores it (`restoredChecklist`) and re-broadcasts at
  start. A pause skips the seal — the checklist can lose one turn (same
  acceptance as universal interruption persistence being a no-op).
- **Checklist items are NOT tasks**: they never enter the task queue, never
  render as kanban task cards (the FE swaps in `ChecklistBoard` for
  workspace projects — tabs read "Checklist / Workflow"), and never count
  toward per-task billing (`billableTaskCount` reads completed *tasks* only).

## Definition loading (D4/D5/D8)

- Loader SSOT: `core/customAgents/CustomAgentLoader.ts`. Merge rules: prose =
  agent base → job base (cap 8k, truncation footer); MCP servers union (job
  wins on name); `tools.builtin` validated **job ⊆ the universal preset**, with
  no agent-level tier to narrow through; `tools.approval` job-declared only.
- **`agent.yaml` carries identity + shared MCP, nothing else.** The two
  validators (`validateAgentYamlDoc` / `validateJobYamlDoc`) **throw** on every
  removed key rather than ignoring it, each with the migration in the message:
  `agent.yaml: tools | description | intents`, `job.yaml: outputs | plan |
  description`, and `workspace` / `models` on either file. Intents and
  injections are job-only for the same reason tool sets are: a duty owns its
  situational rules, a persona does not. A silently-ignored field is how a
  definition author concludes a knob works.
- Prose floor: a job with zero non-empty `base/*.md` across both levels fails
  loud — an agent with no prose is a harness with no purpose.
- Scope roots: `deriveCustomAgentScopeRoots` — user > org
  (`$ANT_CUSTOM_AGENTS_DIR`, readonly) > builtin (shipped samples under
  `core/data/agents`, readonly, always present). Definitions are
  **account/org-owned, never project-owned** — the user root is
  `workspaces/{org}/{user}/.ant/agents`, shared across the account's
  projects. Adding org sync later = one more root.
- **Builtin samples ship as files** (`src/core/data/agents/`, copied to dist
  by the build script like prompt templates / triage jobs; runtime path =
  `WorkspacePathResolver.getBuiltinAgentsPath()`). Because `discoverAgents`
  is deliberately lenient, a malformed shipped sample would silently vanish —
  `tests/customAgents/builtin-agents.test.ts` is the fail-loud gate
  (`loadCustomJob` over every shipped pair + root-wiring rows).
- **Create-collision spans every scope.** `findCreateCollision` *is*
  `findAgentRoot`, so an id owned by ANY root — org and builtin included — 409s
  at creation/import. Pre-existing on-disk collisions still resolve by scope
  priority (whole-directory: the closer agent replaces the farther one
  entirely, jobs included), but *minting* a shadow is refused because silent
  shadowing has no UI story — the author would edit a definition that a
  higher-priority root overrides. Creation (Settings → Agents, or
  `POST /custom-agents`) always targets the user scope; there is no scope
  request parameter. Future: expose `shadows` on `CustomAgentSummary` and a
  copy-to-scope endpoint so a deliberate shadow doesn't start from an empty
  scaffold.
- **Activation is job-runner-child-only** (`activeCustomJob.ts` throws on
  double activation). The API server only lists summaries. Validation
  failures are HTTP 400 at job-accept (`resolveUniversalExecuteContext`),
  never a crash inside the child.

Guard: `tests/customAgents/custom-agent-loader.test.ts`,
`tests/customAgents/builtin-agents.test.ts`,
`tests/customAgents/universal-container.test.ts` (feature-slot + gate truth
tables, container bootstrap, session path shape, thread-plane tombstones).

## Tool policy (D3)

- Allowlist SSOT lives in **core** (`universalToolPolicy.ts`) so the loader
  can validate subsets without a core→agents dependency; the registry factory
  (`presets.ts::createUniversalToolRegistry`) reads the catalog matrix.
  Reconciliation guard: `tests/customAgents/universal-tool-policy.test.ts`
  (also pins schema/handler/display coverage — a ToolName without a
  `toolSchemas` entry is silently invisible to the LLM).
- `search_files` = search_code's ripgrep engine with `filePatternMode:'raw'`
  (no `codebase/` normalization). `search_code` itself stays excluded —
  it is bound to the canonical codebase tree.
- **Path normalization opt-out**: `ctx.pathAutoCorrect: 'none'` skips
  `normalizeToCodebasePath` Rule 4 in `resolveToolPath` and run_command's
  working-dir/write-path policy. Without it every artifact write would be
  silently re-rooted under `codebase/`.
- Sandbox: two-root facade (`createUniversalFileSystem`) — artifacts rw +
  definition dir ro-mounted at `_agent-definition/`. Canonical plane writes
  are impossible under any configuration.
- Known deviation from the plan doc: builtin `http_request` is the existing
  loopback-only probe (SSRF-guarded), not a general HTTP client. External
  mutations go through MCP; revisit if a real need appears.

## MCP connections & the credential plane (A16/A13)

MCP is the ONLY way a custom job gains capability beyond the builtin preset
(`tools.builtin` can narrow the preset, never extend it), which makes the
connection contract a security surface rather than a convenience.

- **Transport-exclusive auth**, validated in `@ant/shared::validateMcpServers`
  (one SSOT, three consumers: loader throw / HTTP 400 / settings form disable):
  `headers` is the only auth mechanism for `http`, `env` the only one for
  `stdio`, and each is **rejected on the other transport**. Two mechanisms per
  transport is two places to forget one.
- **Credential-ness is authored, never inferred.** `MCP_SECRET_REF_PATTERN`
  (`^\$\{secret:([A-Z][A-Z0-9_]*)\}$`) is the one marker that turns a value
  into a store lookup; every other non-empty value is a literal stored verbatim
  in the yaml. A *malformed* reference (anything starting `${secret:` that
  doesn't match) fails validation rather than degrading to a literal — the one
  case where shape does decide something, because it can only be a typo.

  > **Tombstone.** An earlier iteration treated a bare ALL-CAPS value as a
  > credential key name and rejected it with a migration hint. It was removed in
  > `2524da299` because the heuristic could not distinguish a key name from a
  > legitimate literal (`X-Env: PRODUCTION`), so it silently killed job starts
  > on valid definitions. Do not reintroduce shape-based detection as a
  > "safety" check: the failure mode is a definition that cannot run and an
  > error the author cannot act on.

- **Store**: `CredentialsStore` (`utils/userConfig/CredentialsStore.ts`) at
  `workspaces/{org}/{user}/.ant/credentials.json` — AES-256-GCM,
  `iv:authTag:ciphertext`, file mode `0600`, key from `ANT_ENCRYPTION_KEY` or
  `workspaces/.ant/encryption.key`. The `mcp` bucket is keyed by credential key.
  Per-user, not per-project: definitions are account-owned, so their secrets
  must be too.
- **Resolution is store-only.** `McpCredentialResolver` is a port whose sole
  implementation (`StoreBackedMcpCredentialResolver`) reads the store and has
  **no `process.env` fallback**. That is the whole point: with a fallback, a
  definition could name `ANTHROPIC_API_KEY` and exfiltrate it through a server
  it controls. An unregistered key throws with the registration endpoint in the
  message.
- **stdio child env isolation**: `buildStdioChildEnv()` = `STDIO_EXEC_ENV_KEYS`
  (`PATH HOME LANG LC_ALL TMPDIR SystemRoot`) + the resolved declared vars.
  Never `...process.env` — a stdio MCP server is arbitrary code execution on
  Ant's host (accepted under the workspace trust model; cloud leans on pod
  isolation), so it must not inherit provider keys, the JWT secret, or the Redis
  URL.
- **Failure classification**: `McpConfigError` → `InterruptionReason
  'config_invalid'` at the single `job-runner` boundary — non-infrastructure,
  `canResume:false`, and explicitly **never** `process_crash`. A definition
  mistake reported as a crash sends the reader to the wrong subsystem.
- **Write API**: `/api/account/mcp-credentials` — `GET` returns key names and
  `updatedAt` only (values are write-only), `PUT` upserts, `DELETE` removes.
  Rotation touches the store, never the definition file.
- Connect is fail-loud at job start (`runner.ts`), 60s connect/call timeouts,
  tools surfaced as `mcp__{server}__{tool}`. Handlers are registered into the
  **existing** registry singleton — instance identity is a contract, not an
  implementation detail (A1: replacing the singleton made every `mcp__*` call
  resolve to `Unknown tool`).
- **Result spooling** (`runtime.ts`): a non-error result over
  `MCP_SPOOL_THRESHOLD_BYTES` (32 KiB) is written to the artifacts sandbox at
  `mcp-results/{server}/{tool}-{seq}.txt` via `ctx.fileSystem` and only the
  path + byte/line counts + a head preview enter the context; the agent reads
  slices back with `read_file`/`search_files`. This is the short form of the
  cross-tool data plane — without it, moving one system's data toward another
  (or into artifacts processing) forces the model to re-type the entire
  payload. Spool writes emit **no side effects**, so they never fold into
  `_turnToolWrites` or the outputs-contract manifest — they are data-plane
  intermediates, not job outputs. Error results are never spooled (the model
  plans recovery from the error text), and a failed spool write falls back to
  the inline result rather than failing the call.
- Known gap (A5): `McpCallResult.image` is extracted and then **dropped** at the
  registry handler — MCP results are text-only today.

```bash
# The resolver must never learn to read the host environment:
rg -n "process\.env" packages/ant-cli/src/core/customAgents/McpCredentialResolver.ts \
  packages/ant-cli/src/utils/userConfig/StoreBackedMcpCredentialResolver.ts
# Expected: 0 hits.
# The stdio child must never inherit Ant's env:
rg -n "process.env as Record|\.\.\.process\.env" packages/ant-cli/src/core/customAgents/McpConnectionManager.ts
# Expected: 0 hits.
```

Guard: `tests/customAgents/universal-mcp-runtime.test.ts` (dispatch identity +
env isolation rows, both red-verified), `tests/customAgents/mcp-credential-store.test.ts`,
and the FE rows in `packages/ant-ui/tests/components/mcpCredential*`.

## Approval gate (1-8, Phase 1 = fail-closed)

`requiresApproval`: explicit declaration → mutating-builtin default
(`run_command`, `http_request` ⇒ always) → MCP default (always unless the
server annotates `readOnlyHint`). The tool node's `gateCall` REJECTS gated
calls with guidance ("do not retry; tell the user; author may declare
`never`") — silent execution is forbidden. The interactive
pause/approve/resume flow is the Phase-1.5 follow-up; the session field
reserved for it is `pendingApproval`.

A **`@plan` turn** adds a second, orthogonal gate on top: file writes are
confined to `plan/` (`universalToolPolicy.planTurnViolation`) and
`nodes/tool.ts` additionally rejects `run_command`, `http_request`, and any
non-read-only MCP call for that turn. Planning is enforced, not advisory —
otherwise "review the plan first" is a suggestion the model may decline, which
is exactly the failure a plan turn exists to prevent. The plan itself lands at
`plan/{agentId}/{jobId}/` and `resolve` lists it into `state.planDocs` on later
turns (the plan-consumption gate).

## Clarify — blocking questions via end-and-resume

Universal's blocking-question surface is the **`clarify` TOOL**
(`agents/common/clarify/tool.ts` — the canonical-migration seam; canonical's
five `<clarify>`-tag surfaces migrate onto it in follow-up commits). Design
verdicts, each load-bearing:

- **Control tool OUTSIDE the preset planes.** `clarify` is not in `ToolName`,
  not in `UNIVERSAL_BUILTIN_TOOLS`, has no registry handler, and can never be
  named in `tools.builtin`. The preset allowlist is narrowing-only; letting it
  carry clarify would create a second availability owner competing with the
  `clarify:` knob, and `universal-tool-policy.test.ts` pins preset ≡ matrix ∧
  schema ∧ handler coverage. Availability is enforced **by ABSENCE from the
  advertised list** (`buildAdvertisedTools({ includeClarify })`) — no
  strip/proceed-note machinery over emitted calls.
- **Availability = knob × budget.** `isClarifyEnabled` (policy SSOT,
  `universalToolPolicy.ts`): active intents that declare `clarify` AND over it
  (disabled wins); none declare → `clarifyDefault` (`job.clarify ??
  agent.clarify ?? true`). `clarify: false` means "this job is intended
  autonomous/unattended" — the loader's validation message states that
  semantic. Budget: `UNIVERSAL_CLARIFY_BUDGET = 3` pauses per (agent, job)
  session, `clarifyRoundsUsed` sealed/restored alongside the checklist.
- **Sole-call rule.** The pause path runs only when clarify is the round's
  ONLY pending call (tool.ts wrapper). Mixed rounds, unavailable-but-called
  (stale session memory), invalid args, and double-clarify rounds all fall to
  `gateCall`'s instructive rejection while other calls in the round execute
  normally — zero factory changes.
- **End-and-resume, no in-process blocking.** A blocked job would hold a
  worker slot + BullMQ lock for human-timescale waits and die on deploy.
  Instead `clarifyPauseNode` sends the canonical clarify card
  (`choice_presented` / `'clarifying'` — same FE surface, no new component),
  returns with **no tool_result appended**, and `routeAfterTool` routes
  tool→respond. The job completes normally; `session:main`'s tail is the
  dangling assistant `tool_use('clarify')`.
- **Single producer, single closer.** Only respond's seal can persist the
  dangling call (the runner's catch-block save writes pre-graph history).
  The runner's turn admission is the one closer: `findDanglingClarifyToolUse`
  (STRUCTURAL detection — the provider constraint is structural; the seal
  marker is advisory) → `buildClarifyToolResultTurn` injects the next user
  input as that call's tool_result under one framing (`"User replied:\n…"`),
  whatever the content — card answer, partial answer, or unrelated text. The
  model infers non-answers from content.
- **I2-compatible seal shape.** `awaitingClarify: true` is a strict BOOLEAN
  (`JobCleanupManager.shouldSuppressCancelledCardForClarify` checks
  `=== true`); `clarifyToolUseId` / `clarifyQuestion` ride as separate fields
  and are omitted on non-paused seals (stale markers self-clear).
- **No dismiss affordance, by design.** Nothing is running while awaiting —
  there is no live call to interrupt. Typing past the card IS the dismissal
  (canonical behavior inherited: answers merge, card resolves `'skipped'`).

Guard: `tests/customAgents/universal-clarify.test.ts`.

## Prompt injection (1-4)

Two-layer prompt: builtin harness (`templates/jobs/universal/nodes/agent/`,
registered as `TEMPLATE_PATHS.universalAgent`) + the definition as an
**inert** boundary-tagged block (`wrapCustomJobContent` →
`<custom_job_instructions id source="workspace">`), injected via
`PromptBuildConfig.inertSystemAppend` — after merged injections, before
policy (guardrail-first / policy-last invariants hold). Custom prose is never
Handlebars-compiled (no partial access).

The shared `output-tag-policy` injection is **excluded** for the universal
template set (`PromptBuilder.resolveInjections` gates on `inferJob(config)`):
its core claims are false for universal (bare streamed text IS the reply;
there is no `<clarify>` tag — the tag body would be shimmer-suppressed and
discarded, silently losing the question). The invariants universal keeps are
restated for its channel model in `jobs/universal/nodes/agent/rules.md`
(Output Channel) — exclusion + locality over a two-contract shared file.

Guard: `tests/customAgents/universal-prompt-injection.test.ts` (gate truth
table, not prose pinning).

## Streaming & turn identity (A14/A15)

Two defects the WS-D end-to-end surfaced, both structural rather than cosmetic:

- **A14 — `StreamOrchestrator` is turn-scoped, not process-scoped**
  (`graph/runtime.ts`). A universal turn can span many tool rounds, and a
  process-lived orchestrator carried its open-tag state across them, so
  `<reply>` leaked into chat raw after the first round. The lifetime of a
  streaming state machine must match the lifetime of the stream it parses.
- **A15 — the optimistic `user_turn` carries the real jobType.** It was
  hardcoded `'code'`, so a universal project's user messages persisted under a
  jobType the project cannot even run — which then failed to match on reload.
  Optimistic writes must stamp the same identity the durable write will.

## Project type is policy, layout is invariant (D6)

`WorkspaceConfig.projectType: 'canonical' | 'universal'` (absent =
canonical) decides which jobs a project exposes; the universal plane is
ALWAYS namespaced under `universal/` regardless. The gate is
**bidirectional** — truth table: `decideProjectJobGate`
(`core/customAgents/universalContainer.ts`). Enforcement points:

- `/execute` universal branch: 400 `project-not-universal` on canonical
  projects (`resolveUniversalExecuteContext`); 400 `invalid-universal-feature`
  when the `:feature` slot is not the constant.
- `/execute` (+ `/learn`, `/inline-ask`, `/resume`, `/continue`) reverse
  direction: 400 `project-universal-requires-custom-job` when a canonical
  jobType targets a universal project.
- `FeatureCrudService.createFeature`: rejected on universal projects — a
  feature without git is a contradiction, so it is blocked structurally rather
  than degraded into a directory-only feature.
- `deleteProject`'s fs.rm covers `universal/` (sessions + artifacts) without
  a new cascade step; feature-stage steps are naturally no-ops.

The **universal container** `{project}/universal` is the single
featurePath-shaped value: it rides the constant `UNIVERSAL_FEATURE`
(`'universal'`, `@ant/shared`) in the `:feature` URL slot (chat stream, SSE,
feature-log, execute). Resolution seam: `resolveUniversalContainerPath`
(routes/ChatService/SessionPersistence) + `WorkspaceResolver.
getUniversalContainerPath` (JobWorker) + `getUniversalArtifactsPath`.
`ensureUniversalContainer` materializes `artifacts/` + `sessions/` at
execute-accept and at the chat layer's first durable append (the session
adapter's ghost-guard silently drops writes into a missing container).
Artifacts are project-owned (`universal/artifacts/`). The artifacts root
carries canonical dirs (`UNIVERSAL_ARTIFACT_CANONICAL_DIRS = ['plan']` —
name matches the codespace feature dir): always materialized by
`ensureUniversalContainer`, listed first in the tree, never
deletable/renamable (delete = clear contents, codespace parity). The
explorer tree grafts a root `sessions` node last (codespace per-feature
sessions analog: delete/download only; `sessions` is a reserved name at the
artifacts root — 400 `reserved-name-sessions` on upload/mkdir/rename; an
agent-created `artifacts/sessions/` dir is shadowed by the graft).

The workspace explorer panel is NOT a bespoke tree: it mounts the SAME
shared `ArtifactsSection` → `ArtifactRow` → `FileActionMenu` stack the
codespace panel uses (upload/create live in the per-row ⋯ menu; the
root-writable workspace additionally passes `rootDirPath=''`, which puts the
same ⋯ menu in the section header for root-level create/upload). Rows render
the **real directory name**, never a localized label — a translated segment
would misrepresent the path the agent and the tools actually address.

There is NO thread plane (`universal/agents/**` was removed before release —
no data migration; stale trees are ignored and removed by `deleteProject`).
Multi-chat, when it lands, will be designed cross-project-kind, not as a
universal-only bolt-on. Universal resume sends only `customJobRef`; a resumed
pair re-enters its own conversation regardless of which job originally
paused (non-task job — benign). Kanban/interruption disk-restore never
existed for universal (per-(agent,job) session files are invisible to the
static SESSION_SEARCH_MAP by design) — live Redis/SSE state still works.

## Outputs are a contract, not an obligation

`respond` checks the declared contract ONLY against `_turnToolWrites` — real
writes recorded from tool side-effects, never LLM claims
(completion-signal = actual-write principle). Chat-only turns terminate
normally; contract mismatches are surfaced as warnings in the manifest
message, not failures.

## Cleanup notes

- The 5-literal jobType union (`'code'|'design'|...|'visual'`) that was
  hand-copied across ~20 http/lifecycle sites now reads `SessionableJobType`
  — new sessionable types stop requiring a shotgun edit.
- `orchestrator.ts`'s local jobType union gained `universal`; the full
  union-drift cleanup (5 remaining copies) is still open — see the plan's
  risk 4.
