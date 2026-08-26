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
becomes a fourth parse site. `intents` keeps the array shape for wire
compat, but **a run binds at most ONE intent** — the intent is the atomic
unit of work (per-intent stop hooks are the run's completion contract, and
the future scheduler's node address is `(job, intent)`). Enforced at three
boundaries: the accept gate (`validateUniversalTurnMeta` → 400
`multiple-intents` on >1 distinct id), the FE arming slot
(`addUniversalIntentMention` replaces instead of accumulating), and the
seal sanitizer (`parseSealedTurnContext` truncates pre-cutover multi-intent
seals — inheritance rides the state-restore plane, which the HTTP gate
never sees).

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

- **Unpinned turns: the rendered catalog — never a classifier, and no catalog
  default.** An unpinned turn resolves `explicit → inherited (clarify
  continuity) → ['general']` (`buildTurnContext` in resolve). There is no
  `default: true` flag anywhere: the three consumers of an active intent —
  prompt inlining (`buildCustomJobSystemBlock`), the per-intent clarify knob
  (`isClarifyEnabled`), and stop-hook arming (`activeStopHooksOf`) — fire only
  for pinned/inherited intents. A lane that needs them on every run pins the
  intent explicitly (`@intent:` mention / `UniversalTurnMeta.intents` on
  scheduled and API runs).

  For turns that land on `general`, the authored criteria still reach the
  model: `buildCustomJobSystemBlock` renders an **Intent Catalog** section —
  each intent's id + its `infer.md` criterion verbatim (multi-line prose via
  `sanitizeBlock`, indented so author text is DATA and cannot restructure the
  block or escape it) + the state of its `prompt.md` (inlined / pointer /
  none). Self-selection is therefore an informed judgment against the
  authored criteria, and the model `read_file`s the applying intents'
  prompt files off the read-only definition mount. The
  `general`-suppresses-inlining rule stands: always-on prose belongs in
  `base/`.

  **The resolution is announced, and `general` says so.** `turnContext.source`
  names which of the three steps fired — `pinned` / `inherited` / `unpinned`,
  never `infer`, since no step classifies — and resolve emits a chat card from
  it (`core/customAgents/turnContextChat.ts`, plain markdown on the same
  `chatAPI` path as respond's artifact manifest; no canonical tag is emitted,
  so `OutputTagRegistry` — which scopes tags the LLM may emit — is not
  involved). `unpinned` additionally lists the catalog, so an author sees both
  that no declared intent was active and what the agent was choosing among.
  Without it, a turn that fell through to `general` (intent prompts left as
  pointers, clarify knob unreachable, hooks unarmed) was indistinguishable in
  the transcript from one running under the intent the author meant — the
  input-box `@intent:` chips only ever showed what was *pinned*, and are
  cleared on send.

  Guards: `universal-turn-context.test.ts` (general resolution rows, `source`
  rows, card announcement-gate rows), `universal-prompt-injection.test.ts`
  (catalog rendering + sanitize rows), `custom-agent-loader.test.ts`
  (infer.md validation rows).

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
  description`, and `workspace` / `models` on either file. Intents are
  job-only for the same reason tool sets are: a duty owns its situational
  rules, a persona does not. A silently-ignored field is how a definition
  author concludes a knob works.
- Prose floor: a job with zero non-empty `base/*.md` across both levels fails
  loud — an agent with no prose is a harness with no purpose.
- **Intent catalog = one directory per intent, three files, no yaml schema**:
  `jobs/{jobId}/intents/{intentId}/infer.md` (REQUIRED — optional frontmatter
  fence allowing exactly one key, `clarify: <bool>`; the prose BODY is the
  inference criterion, capped at `INFER_BODY_MAX` = 1000 chars since it
  renders into every turn's catalog) + optional `prompt.md` (prose inlined
  while the intent is active; whitespace-only = absent) + optional
  `hooks.yaml` (the completion contract; `hooks:` wrapper key kept so shared
  `validateIntentHooks` is consumed verbatim). The intent id IS the directory
  name — no file declares it, so rename is a pure directory move. The fence
  convention is the shared `splitFrontmatter` (`@ant/shared`), consumed by
  BOTH the BE loader and the FE editor so the same bytes never parse two
  ways; comments inside the fence are the authoring-guidance channel (they
  never reach the rendered criterion). Per-file rules live in
  `validateInferFile` / `validateHooksFileDoc`; the cross-file cap (32)
  aggregates in `parseIntentsDir` over sorted directory order (catalog order
  = dirname-lexicographic — an accepted consequence; selection semantics are
  order-free). Fail-loud shapes, each with its move instruction: an intent
  dir carrying anything besides those three files, a stray file under
  `intents/`, a leftover `intent.yaml` or single-file `jobs/{jobId}/
  intents.yaml`, a `jobs/{jobId}/injections/` directory (even empty — the
  pool was replaced by per-intent prompt.md, hard cutover), and the retired
  frontmatter keys `default` / `injections` / `description` / `id` / `hooks`
  (each names its replacement — a silently-ignored removed key is how an
  author concludes a knob works). `default: true` is GONE entirely: unpinned
  turns always run as `general` and lanes that need per-intent behavior pin
  explicitly. A job without `intents/` is a valid empty catalog — the
  scaffold ships none; the settings UI creates `intents/{id}/infer.md`
  through the PUT funnel (which mkdirs parents).
- Scope roots: `deriveCustomAgentScopeRootsForTenant` (SSOT — dispatches on
  the org **kind**, never on server mode; both HTTP mounts, job-accept, and
  the job-runner child all derive through it). Definitions are
  **account/org-owned, never project-owned**.

  | kind | roots (priority order) |
  |---|---|
  | `local` / `individual` | user `{ws}/{orgId}/{userId}/.ant/agents` (writable) > org env-dir > builtin — byte-identical to the historical user-dir derivation |
  | `team` | ① user `{ws}/individual/{userId}/.ant/agents` (writable — personal agents stay anchored to the individual org, so switching the active org never empties the list) ② org `{ws}/{orgId}/.ant/agents` (`aclGoverned: true` — per-agent write authority) ③ org `$ANT_CUSTOM_AGENTS_DIR` (readonly) ④ builtin. The pre-org-agents team-path user root (`{ws}/{orgId}/{userId}/.ant/agents`) is retired — not discovered, not promotable, no auto-migration. |

  `deriveCustomAgentScopeRoots(projectPath)` survives only as the
  local/individual shim and the job-runner BC fallback for in-flight jobs
  spawned by a pre-upgrade worker (the worker now passes `ANT_ORG_KIND` +
  `ANT_WORKSPACES_ROOT`; the kind is NEVER re-derived from the org id — a
  local tenant named like a team org would be misclassified).
- **Org-owned agents (team kind).** Any live member may *promote* a personal
  agent: a MOVE (`fs.rename`, not a copy) of the definition dir into the
  per-org root, recording the promoter as owner. Runtime container data does
  not move — sessions/plans are keyed by `agentId` under each project and the
  id is unchanged. Authority model: every member can list/run; edit/delete =
  agent owner ∨ delegated `editors` ∨ live org admin/owner role (never the
  JWT claim — `resolveLiveTeamMembership`). The ACL sidecar is
  `{ws}/{orgId}/.ant/agent-acl.json` (`routes/helpers/orgAgentAclStore.ts`),
  deliberately OUTSIDE any agent dir so the definition-file PUT funnel
  (`resolveDefinitionPath`, confined to `agents/{agentId}/`) structurally
  cannot rewrite it. Missing/corrupt ACL ⇒ admin-only editing. The single
  write chokepoint stays `findWritableAgent` (now async, lazy org gate);
  list summaries are decorated per caller (`readonly` = effective authority,
  `org: {owner, canEdit, canManageEditors, editors?}`).
- **`$ANT_CUSTOM_AGENTS_DIR` is a single global directory with NO org
  separation** — in a multi-tenant deployment every org sees it. It slots
  BELOW the per-org root and stays a self-host escape hatch only; do not
  point it at tenant data.
- **MCP credentials are per-user** (`credentials.json`): an org agent's
  `${secret:KEY}` references resolve against each running member's own store,
  so every member must register the keys themselves. Known limit, documented
  — not a bug.
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

Guard: `tests/customAgents/custom-agent-loader.test.ts` (incl. the
tenant-derivation table), `tests/customAgents/builtin-agents.test.ts`,
`tests/customAgents/universal-container.test.ts` (feature-slot + gate truth
tables, container bootstrap, session path shape, thread-plane tombstones),
`tests/http/account-agent-routes.test.ts` (promotion, org edit matrix,
editors management, ACL-sidecar unreachability, caller-effective list
decoration).

## Tool policy (D3)

- Allowlist SSOT: the tool NAME inventory (preset list, mutating/write
  subsets, mcp prefix) is the BE↔FE contract and lives in
  `@ant/shared/universal-tools` (the FE action picker and artifact-hook
  satisfiability hints consume the same lists); `universalToolPolicy.ts` in
  **core** re-exports it and keeps the runtime-behaviour policy (approval,
  plan-turn confinement, clarify) BE-only, so the loader still validates
  subsets without a core→agents dependency; the registry factory
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
  loopback-only probe (SSRF-guarded), not a general HTTP client. The "revisit
  if a real need appears" clause was resolved by the `apis` channel (below),
  NOT by opening this tool: the real need was *authenticated* calls to systems
  without an MCP server, and unlocking a generic builtin would have left
  nowhere to hang per-server identity, declared auth, or scope. `http_request`
  stays a loopback probe. (A public unauthenticated `http_get` builtin —
  private-range-blocked, the opposite guard — remains a follow-up candidate;
  `fetch_url`/`search_web` cover public reads meanwhile.)

## MCP connections, declared REST APIs & the credential plane (A16/A13)

A custom job gains capability beyond the builtin preset through exactly TWO
declaration channels — `mcp.servers` (MCP servers) and `apis` (declared REST
API connections); `tools.builtin` can narrow the preset, never extend it.
Both channels share one credential rule, one approval gate, and one result
plane, which makes the connection contract a security surface rather than a
convenience.

### `apis` — declared REST API connections (no MCP server exists)

For legacy systems that speak plain HTTP and will never ship an MCP server
(ERP, internal REST services), an `apis` entry declares connectivity ONLY —
where (`baseUrl`), as-whom (`headers` with `${secret:KEY}`), optionally
how-far (`allow` method+path rules). The runtime itself plays the missing
server's role **in-process** (no child process, no MCP handshake):
`McpConnectionManager.connect()` compiles the entry and synthesizes two
generic tools per server (`core/customAgents/restApi.ts`):

- `api__{server}__get` — GET/HEAD only, `readOnlyHint: true` → approval-exempt,
  allowed on `@plan` turns.
- `api__{server}__request` — POST/PUT/PATCH/DELETE only, fail-closed approval;
  the author opts into unattended writes with
  `tools.approval["api__{server}__request"]: never`. The method enums are
  disjoint, so a write can never ride the exempt tool.

The two-tool split is forced by mechanics, not taste: `gateCall` and
`requiresApproval` read `readOnlyHint` statically per tool NAME, so a single
tool could not be read-exempt and write-gated at once.

The API's **knowledge** (endpoints, fields, call sequences) is deliberately
NOT declared — no per-endpoint tool schemas, no OpenAPI import. It is prose:
`base/*.md` for always-on conventions, the intent's `prompt.md` for the
task-shaped subset, and `reference/**` (agent- and job-level, `.md`/`.json`,
any depth) for full specs read on demand via the `_agent-definition/` mount.
The loader collects the reference file list into `resolved.referenceDocs` and
`buildCustomJobSystemBlock` renders it as a structural "Reference Files (read
on demand)" index — the model is TOLD the documents exist and must be read
before acting; their content never inlines. This is the industry-consensus
layer split (MCP/declaration = connectivity + governance, docs = knowledge,
the model = orchestration), and it pins the empirically dominant failure axis
of OpenAPI→tools conversion (auth metadata) in the declaration while leaving
everything else to prose.

Executor rules (each mechanical — `tests/customAgents/rest-api.test.ts`):
`path` is `/`-rooted and re-asserted under baseUrl's origin+prefix after
normalization; redirects are never followed (`redirect: 'manual'` — an
off-origin Location must not receive the auth header); declared headers win
and per-call collisions are rejected; resolved secret values never appear in
args/results/errors; the allow-list is checked before any request; 2xx/3xx
are success results, 4xx/5xx are `isError: true` WITH the body (an
API-rejected write must never satisfy an `api__…__request` action stop hook);
`McpConfigError` only at compile time (bad baseUrl / unregistered secret) so
job-runner keeps classifying it `config_invalid`. Results flow through the
same registry handler as MCP tools, so >32KB responses spool identically.

### `apis` self entries — this Ant server's own API

An entry takes one of two mutually exclusive forms. The external form above is
one; the second is `self: true`, which carries **neither URL nor credential**:

```yaml
apis:
  ant:
    self: true
    allow:
      - GET /account/agents/**
      - PUT /account/agents/**
```

`resolveSelfApiConfig` (`restApi.ts`) resolves the base URL from
`ANT_API_URL` — the env both spawn sites already inject — plus the `/api`
mount, and attaches `ANT_SELF_API_TOKEN` when one exists. Both failures are
definition-independent misconfiguration and therefore loud at connect time
(`McpConfigError` → `config_invalid`): an absent/unusable `ANT_API_URL`, and
cloud with no minted token. Local mode legitimately has neither a token nor an
auth gate. The model-facing tool description says "this Ant server", never the
resolved origin.

This form exists because a definition must not hard-code an install's origin or
assume a registered credential — which is also why it is **the only `apis`
form a builtin agent may declare** (`tests/customAgents/builtin-agents.test.ts`;
the same reason `mcp.servers` is forbidden there).

**The token, and why `allow` is not the boundary.** When
`resolveUniversalExecuteContext` sees a self entry it returns `declaresSelfApi`,
and `UniversalDispatchService` — the single dispatch owner — mints an ES256 JWT
carrying `scope: 'self-api'`. Minting happens in the process holding the private
key (C-001); the child receives one signed, non-renewable token on the queue
payload → `ANT_SELF_API_TOKEN`, a name the `ANT_*` namespace rule keeps out of
every `run_command` child.

A definition is user-editable, so its `allow` list is one save away from
`* *` — it scopes what the model is TOLD it may call, not what it MAY call.
The boundary is `createSelfApiScopeGuard`, mounted on `/api` after
authentication and before every router:

| Request under a `self-api` token | Result |
|---|---|
| `/api/account/agents/**` | admitted — the account router's own ACL then decides |
| anything else under `/api` | 403 (`self-api-scope`) — including the auth routes, so the token cannot mint another |
| `…/promote`, `…/editors` | 403 — publishing to the org and granting edit access are a person's decision |
| `…/import`, `…/files/upload` | 403 — the two write routes that skip `gateDefinitionSave` |

Absence of the claim is an ordinary session and is never treated as a pin.
The builtin `agent-builder` agent is the first consumer of this form; job
authoring therefore goes through the same validated write funnel as the
settings UI (`PUT /account/agents/:agentId/file` → `gateDefinitionSave` →
`loadCustomJob`), and needs no new write plane.

Out of scope by design: session-login dances, request signing (HMAC), OAuth —
a `${secret:KEY}` resolves into declared headers only, never into a request
body the model composes, so a body-credential login is mechanically
impossible. Systems needing those, and rule-bound writes needing server-side
validation/idempotency/dry-run, take the capability-server escalation path
(doc 45 §3, `examples/mcp-reference-server`).

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

### Plan-complete CTA (`plan_complete` choice card)

When a plan turn ends having actually written plan docs, `respondNode` emits a
`plan_complete` choice card — the universal analog of the design job's
`spec_complete` "Start Development" CTA, adapted from Claude Code's post-plan
trio (proceed / proceed-with-approval / keep planning). ANT has no per-edit
approval loop; the approval surface is the composer, so the options are:

| Choice | Behavior (all FE-driven; resolution is a pure audit line) |
|---|---|
| `proceed` | Follow-up universal turn immediately: the card-payload intent re-pinned (`planContinuationPins` caps a pre-cutover multi-intent payload to its first id), plan docs pinned as `@ctx`, auto directive, `plan` off. Resolution persists **after** a successful dispatch so a failed launch never takes the 24h per-cardId NX lock. |
| `edit` | Arms the composer from the payload: `@intent`/`@ctx` chips into `universalTurnMeta` + directive via `pendingChatInput` — the user edits, then sends. |
| `keep_planning` | Re-arms `@plan` + re-pins the intent; no `@ctx` re-pin (resolve re-lists `plan/{agentId}/{jobId}/` into the Plan Documents band every turn). |
| `later` | Dismiss. |

The gate is `planCompleteCardWrites` (exported, pure): `turnContext.planTurn`
∧ no `_clarifyPause` ∧ deduped `_turnToolWrites` filtered by `isUnderPlanDir`
non-empty — plus an on-disk `fileExists` filter at emit time. Deterministic by
construction: no LLM judgment, no tag (`OutputTagRegistry` untouched — choice
cards are imperative `ChatAPIClient.sendChoiceCard` calls). Payload keys
(`planFiles` / `customJobRef` / `intents` / `intentSource`) ride the explicit
whitelist in `buildChoiceCardMetadata`; the FE variant pins from the CARD
payload, never the live composer selection (which may have drifted). `general`
is never re-pinned — an unpinned plan turn's follow-up re-resolves
explicit → inherited → general (there is no catalog default). No synthetic
workerScope: universal is
single-scope, and the card (emitted after the artifact manifest, before the
seal) orders by ts within `_main_`.

Known degradation: `_turnToolWrites` is per-run, so a clarify pause loses
pre-pause writes — a resumed run that writes nothing offers no card (same
acceptance class as the pause skipping the checklist seal). Emission is
log-and-swallow and sits before the session seal so a seal failure cannot
swallow the CTA.

Guards: `planCompleteCardWrites` rows in
`tests/customAgents/universal-turn-context.test.ts`, the no-synthetic-scope +
whitelist rows in `tests/llm/llmResponseService.test.ts`, the seam-order row
in `tests/policy/learn-summary-ordering.test.ts`, and the FE pin table in
`packages/ant-ui/tests/chat/planCompleteCard.test.ts`.

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
  `universalToolPolicy.ts`): the active intent's `clarify` knob decides when
  declared; none declared → `clarifyDefault` (`job.clarify ??
  agent.clarify ?? true`). (The function still ANDs over an intent array —
  "disabled wins" — but a run binds at most one intent, so the multi-input
  branch only serves pre-cutover restores.) `clarify: false` means "this job is intended
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
- **Turn-context continuity across the pause.** The paused seal additionally
  carries `clarifyTurnContext` — the RESOLVED turn context (intents / `@ctx`
  / `planTurn`), not the raw mentions. The runner restores it ONLY when its
  turn admission structurally closes the dangling `tool_use` (same gate as
  the closer above; `parseSealedTurnContext` sanitizes, and a general-only
  content-free seal restores nothing). Resolve's intent ladder is
  explicit → inherited → general, with banner source
  `inherited` / `승계`. Without this, an answer turn re-resolved from scratch
  and a `writing`-pinned turn's clarify answer ran as `general`. This rides
  the state-restore plane (same seal as `conversations` / `checklist`) — it
  is NOT a second turn-meta transport; `ANT_UNIVERSAL_TURN_META` stays the
  only cross-process channel, and an explicit mention on the answer turn
  still wins. The no-reply closure inherits too (plan-write confinement must
  not drop on a defaults-run); the crash-path save never writes it. Like
  every marker above it self-clears at the first non-paused seal.
- **No dismiss affordance, by design.** Nothing is running while awaiting —
  there is no live call to interrupt. Typing past the card IS the dismissal
  (canonical behavior inherited: answers merge, card resolves `'skipped'`).
- **Pipeline mode (doc 46 §5b).** When the asking job is a pipeline step, the
  same seal parks the step `awaiting_clarify` and the answer arrives as the
  coordinator's re-dispatch `overrideDirective` — the runner's structural
  closer needs no pipeline awareness. The composer stays pipeline-locked;
  the clarify card is the in-app answer surface (its submit skips `runJob`
  on a pipeline-owned project), and the approvals inbox/API is the second
  channel.

Guard: `tests/customAgents/universal-clarify.test.ts` (seal/restore rows) and
`tests/customAgents/universal-turn-context.test.ts` (inheritance ladder rows).

## Prompt injection (1-4)

Two-layer prompt: builtin harness (`templates/jobs/universal/nodes/agent/`,
registered as `TEMPLATE_PATHS.universalAgent`) + the definition as an
**inert** boundary-tagged block (`wrapCustomJobContent` →
`<custom_job_instructions id source="workspace">`), injected via
`PromptBuildConfig.inertSystemAppend` — after merged template injections,
before policy (guardrail-first / policy-last invariants hold). Custom prose
is never Handlebars-compiled (no partial access).

Block structure (`buildCustomJobSystemBlock` in `core/customAgents/
promptBlock.ts`): merged base prose → `## Active Intent Instructions`
(active intents' `prompt.md` bodies inlined in full, budget
`INTENT_PROMPT_INLINE_CAP` = 12k; overflow demotes a prompt WHOLESALE to its
read_file pointer with an applies-now marker — truncation never) → the
`## Intent Catalog` (per intent: id + stop-hook suffix, the `infer.md`
criterion via `sanitizeBlock` — newlines kept but continuation lines
indented, so author prose cannot mint column-0 headings/rows — and the
prompt state: `(inlined above — do not re-read)` / active-but-demoted
pointer / inactive pointer / `(none)`). `general` is not a catalog member,
so a general-only turn inlines nothing (always-on prose belongs in `base/`).
The whole definition dir is mounted read-only at `_agent-definition/`, so a
pointer resolves via plain `read_file`. The prompt-preview endpoint
(`GET …/prompt-preview?intents=`) renders this exact block; its
`inlined`/`toc` fields carry intent ids.

The shared `output-tag-policy` injection is **excluded** for the universal
template set (`PromptBuilder.resolveInjections` gates on `inferJob(config)`):
its core claims are false for universal (bare streamed text IS the reply;
there is no `<clarify>` tag — the tag body would be shimmer-suppressed and
discarded, silently losing the question). The invariants universal keeps are
restated for its channel model in `jobs/universal/nodes/agent/rules.md`
(Output Channel) — exclusion + locality over a two-contract shared file.

Guard: `tests/customAgents/universal-prompt-injection.test.ts` (gate truth
table, not prose pinning).

### Authored-artifact language

The harness prompt is English; the artifacts a universal job produces need not
be. `rules.md` (Output Channel) states one precedence ladder for file contents:
an explicit user instruction → the language convention the definition states →
the language of the file being revised → the language of the user's request.
Rungs 2 and 3 above 4 are the compatibility guarantee — an English-authored
definition and an existing English file both keep English, so nothing flips on
its own; rung 4 is what makes a Korean team's report agent write Korean reports
without its author having to think of the rule.

Before this, `rules.md` said only "file contents in the language the definition
or the artifact's purpose requires" and left the silent case undefined, so the
English system prompt decided it. That hurt most where it was least wanted: the
builtin `agent-builder` writes definition prose that its requester then
maintains verbatim in the settings screen (§ File ↔ section isomorphism), and a
definition its owner cannot read is one they cannot maintain. `agent-builder`
therefore also states the rule in its own `base/role.md` — rung 2 reads the
definition's convention, and that definition is itself English, so silence there
would have read as "write English".

Deliberately NOT built:

- **A yaml `language:` key.** The file body already states its language; a
  declared key is a second owner of the same fact and drifts from it. It would
  also cost a `@ant/shared` type, loader validation, a `gateDefinitionSave` rule,
  and an FE field.
- **Wiring `state.language` / `isKorean` into the ladder.** That channel is a
  binary ko/en regex (`detectLanguage`) serving UI locale — it cannot express
  ja/de/fr, and it is strictly less informed than the directive the model already
  reads. `base.md`'s `{{#if isKorean}}` reply booster stays as-is and is
  unrelated to artifact language.
- **A per-turn language classification pass** — same reason every other
  pre-classification pass is forbidden here (§ Why one JobType).

The ladder is prose and is not pinned by a test. The gated invariant is its
inverse: `tests/customAgents/builtin-agents.test.ts` fails if a shipped
definition under `src/core/data/agents/**` carries non-Latin script, so the
tree Ant ships stays neutral while user definitions localize freely. Structural
tokens (ids, yaml keys, paths, tool names, `${secret:}` refs) never localize at
any rung. Note the prose cap is counted in characters (`CUSTOM_PROSE_CAP`), so
CJK prose buys a larger token budget at the same cap rather than truncating
earlier.

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

The artifact mutation routes (`upload` / `create-file` / `rename` / `mkdir` /
`DELETE file`) live on ONE sub-router mounted at
`/projects/:projectId/universal/artifacts` with `mergeParams: true`, and a single
mount-level hook publishes `fileTree` for every non-GET answering < 400. It is
mounted, not per-route, so a seventh mutation route cannot be added without the
notify (`files.routes.ts` hand-copies its notify five times — that shape is not
repeated here). Without `mergeParams` the notify silently addresses an
`undefined` project, which is the failure mode to watch. The notifier is the same
`WorkflowBridge` instance the api routes get, wired at
`RouteConfigurator.setupCustomAgentRoutes`.

Because the artifacts root is free-form (only `plan` is canonical), a root-level
directory can appear mid-job. The explorer therefore auto-expands only
*genuinely-new* top-level dirs (`planArtifactAutoExpand` +
`seenArtifactTopLevelDirs`, paired with `expandedArtifactDirs`), so an agent's
`mkdir` output is visible without a browser refresh while a dir the user
collapsed is not force-reopened on every SSE tick. The codespace panel builds its
top level from a fixed list, so its path set is constant and the rule is inert
there. The panel's refetch is deliberately NOT gated on `isRunning`.

There is NO thread plane (`universal/agents/**` was removed before release —
no data migration; stale trees are ignored and removed by `deleteProject`).
Multi-chat, when it lands, will be designed cross-project-kind, not as a
universal-only bolt-on. Universal resume sends only `customJobRef`; a resumed
pair re-enters its own conversation regardless of which job originally
paused (non-task job — benign). Kanban/interruption disk-restore never
existed for universal (per-(agent,job) session files are invisible to the
static SESSION_SEARCH_MAP by design) — live Redis/SSE state still works.

## Stop hooks — the deterministic turn-completion contract

An intent may declare `hooks.stop` entries in its
`intents/{intentId}/hooks.yaml` (the optional sibling of `infer.md`) —
`artifact` (a glob a REAL write this turn must match) or `action` (a tool name
that must have been successfully called), all entries AND. This re-introduces
the removed job-level `outputs` contract (`12177f173`) with the defect fixed:
that field was post-hoc warning-only (no teeth); hooks are a gate.

Declaration → evidence → gate → bounded bounce → interruption:

- **Declaration**: intra-file syntax rules (event key `stop` only, entry
  shape, glob charset/traversal/`sessions/` bans, action-name vocabulary) are
  the shared `validateIntentHooks` in `@ant/shared/custom-agents.ts` — the
  `validateMcpServers` pattern: ONE rule set consumed by the BE
  (`validateHooksFileDoc` → loader + `gateDefinitionSave` PUT funnel, which
  injects the universal-preset predicate) and by the FE structured hook editor
  (no predicate → builtin judgement deferred to the save gate); cross-file
  satisfiability (artifact hook ⇒ a write tool in `tools.builtin`; action ⇒
  builtin allowlisted / MCP server declared) validates in `loadCustomJob`.
  Hooks are per-intent BY DESIGN — no job/agent level, which would bind
  `general` turns; a lane that needs a contract on every run pins its intent
  explicitly (`@intent:` / `UniversalTurnMeta.intents` — there is no catalog
  default). (The pre-split YAML-anchor reuse trick died with the per-intent
  file split — anchors resolve within one document only.)
- **Evidence**: the tool node folds real writes into `_turnToolWrites`
  (side-effects, never LLM claims) and successful call names into
  `_turnToolActions` (a gate-rejected call carries `result.error`, so
  "advertised but blocked" never counts). Judgment is a binary predicate at
  the stop point, not progress estimation — the hook vocabulary is limited to
  what the runtime observes deterministically.
- **Gate**: the turn's ONLY stop point (agent node emits zero tool calls)
  evaluates `checkStopHooks` + disk re-verification (`stopHooks.ts` SSOT,
  same predicate family as design `isNoOutputCompletion` / plan
  `isUnrealizedBrief`). Unmet → a `[stop-hook]` ✓/✗ message re-enters the
  agent (join-barrier shape, before finalize — A14), at most
  `UNIVERSAL_STOP_HOOK_BOUNCE_BUDGET` times per turn.
- **Interruption**: budget spent → respond recomputes (never trusts the
  agent's flag), prints the ⚠️ ✓/✗ manifest (unmet patterns verbatim — author
  typos visible), seals `awaitingStopHooks` + `hookTurnContext` +
  `hookLedger` (clarify-pause rail, self-clearing), and job-runner publishes
  a resumable `universal_stop_hook_unmet` interruption instead of success
  (plan_no_output precedent — result-carried, never a throw). The resumed
  turn re-arms the same intents with a fresh budget; the ledger keeps met
  hooks met (cross-job loop enforcement without re-demanding done work).
  The ledger also rides a clarify pause (mid-sequence confirmation case).

Exemptions (all pure code): plan turns (plan_complete owns their contract;
writes are plan/-confined), clarify pauses (deferred — the answer turn
re-gates via inheritance), `general` (reserved, cannot declare hooks).
The checklist is deliberately untouched in both directions: it is LLM
self-narration (soft), the hook is a code-judged contract (hard).

v2 reserves a `command` hook (author-defined verification command). Deferred
because it is an execution surface — it needs the stdio-MCP-child treatment
(sandbox, env allowlist, timeout, credential non-exfiltration). v1's two hook
kinds only observe evidence; no author code ever runs.

UI surfaces: discovery (`tryReadJobIntentSummaries` → `CustomJobSummary.intents`)
carries the FULL `CustomIntentDef[]` (hooks/clarify/hasPrompt — bounded 32×8),
so the actions tab's universal `intent-detail` step and the settings tree render
without a second fetch. Agent Settings edits intents SURGICALLY — the infer
criterion and clarify splice the infer.md text (`applyInferBody` / `applyInferClarify`
in `definitionDocs.ts`, fence comments preserved; the clarify edit is
line-level BECAUSE the yaml lib deletes a pair's leading comments with it),
hooks go through per-field YAML node edits on hooks.yaml — the historical
wholesale rewrite silently erased every field the form did not model, plus
comments. The structured hook editor (glob builder + action picker over this
job's builtins ∪ declared MCP servers) writes through the same per-file
funnel, gated by the shared syntax rules client-side and by
`gateDefinitionSave` authoritatively.

### File ↔ section isomorphism (Agent Settings)

The screen's core philosophy: the left rail and the right sections show the
SAME definition content — structured vs raw — and sync both ways. The rail
has two ISOMORPHIC views (`AgentTree`, persisted per user): *Structure*
(scope groups → agent → job → intent, decorated from the discovery summary)
and *Files* (the same scope groups and agent rows; under an expanded agent,
its definition file tree — per-agent lazy `GET …/files` into the
`definitionTrees` store map, `DefinitionFileTree` with the selected file
highlighted and its ancestors auto-opened). Clicking a mapped node selects
the owning level and scrolls to the owning card (`classifyDefinitionPath` →
`handleOpenTreeFile`); interacting with a card highlights its file
(`treeFocusPath`). No card shows a path caption — the rail is the location
surface.

| tree node (Files view) | right section (card id) |
|---|---|
| `{agent}/` | the agent-level screen |
| `agent.yaml` | AgentDefinitionCard (`c3g-agent`) |
| `base/*.md` | PromptsCard file buffers (`c3g-prompts`) |
| `jobs/{j}/` | the job-level screen |
| `jobs/{j}/job.yaml` | JobDefinitionCard (`c3g-tools`) |
| `jobs/{j}/base/*.md` | PromptsCard |
| `jobs/{j}/intents/` | IntentsCard (`c3g-intents`) |
| `intents/{i}/` | the intent-level screen |
| `intents/{i}/infer.md` | IntentDetailCard (`c3g-intent`) |
| `intents/{i}/prompt.md` | IntentPromptCard (`c3g-intent-prompt`) |
| `intents/{i}/hooks.yaml` | IntentHooksCard (`c3g-intent-hooks`) |
| (non-file) | OrgAccess / Promote / Danger — outside the mapping |

The actions tab mirrors the canonical UX: an intent chip NAVIGATES to the
`intent-detail` step (no toggle-on-chip; the chip's ring mirrors the armed
`universalTurnMeta.intents`), and the detail page carries the canonical bottom
menu (`ActionFooter` `universal-intent` variant): **Chat** arms the intent as
an `@intent:` mention and focuses the composer (prepare, never send); **Build**
posts a localized run request as the user turn (`universalBuildDirective`,
`actions:universal.buildDirective` — never the intent's `infer` criterion, which
is prompt text already rendered into the Intent Catalog) and dispatches a
universal run with EXACTLY this intent pinned — `handleBuild` resets the
armed turn meta before arming, so pre-armed intents/`@ctx`/`@plan` leftovers
never ride a Build — via `selectUniversalExecuteContext` (the
`PlanCompleteVariant.handleProceed` precedent — composer-independent, so a
collapsed chat sidebar cannot defer it).

### Structured ⇄ raw coverage matrix (Agent Settings)

Principle: **one editing surface per file per screen** (`DefinitionCard`'s
Form ⇄ Raw toggle for structured files; plain editors for prose). Since the
per-intent split each intent's screen holds three files, three cards, three
surfaces.

| Item | Level | Structured section | Raw surface |
|---|---|---|---|
| `agent.yaml` id / name / mcp.servers | agent | AgentDefinitionCard | same card's YAML toggle |
| `agent.yaml` version / clarify | agent | — (deliberate) | agent YAML toggle (raw-only) |
| agent `base/*.md` | agent | — (prose) | PromptsCard md editor |
| `job.yaml` id / name / tools.builtin / tools.approval / mcp.servers | job | JobDefinitionCard | same card's YAML toggle |
| `job.yaml` version / clarify | job | — (deliberate) | job YAML toggle (raw-only) |
| job `base/*.md` | job | — (prose) | PromptsCard md editor |
| intent catalog (list / create phantom / navigate) | job | IntentsCard (plain SectionCard — owns no file; maps to `intents/`) | each intent's own cards |
| `infer.md` criterion / id | intent | IntentDetailCard (a DefinitionCard; the id renames via the structural `IdRenameField` — a PURE directory move, no file declares the id) | same card's Raw toggle — this intent's infer.md verbatim (frontmatter included) |
| `infer.md` `clarify` frontmatter | intent | IntentDetailCard "Behavior flags" (tri-state; "inherit" deletes the key — line-level splice, fence comments survive) | same Raw toggle |
| `intents/{i}/prompt.md` | intent | IntentPromptCard (plain editor — markdown IS the file; emptied = DELETE on save) | the card IS the raw surface |
| `hooks.yaml` `hooks.stop` | intent | IntentHooksCard (a DefinitionCard, `StopHooksEditor` — glob builder + action picker) | same card's YAML toggle — this intent's hooks.yaml |
| MCP credential VALUES | agent/job | McpServersEditor (write-only, masked) | **no raw by design** — yaml holds only `${secret:KEY}` references; values live in the encrypted account store |

A broken `infer.md` (frontmatter error) on the intent screen keeps the
DefinitionCard frame (parse banner + Raw editor) instead of mis-reporting
"intent no longer exists" — the file is repairable in place, and a broken
infer.md never locks the prompt or hooks cards (independent files).
Save-blocking parse errors are DIRTY-doc-only (phantoms excepted: a new
intent's empty infer.md blocks Save even while clean — the authorship gate):
with a whole catalog of files loaded, one pre-existing broken file must not
freeze unrelated saves.

## Cleanup notes

- The 5-literal jobType union (`'code'|'design'|...|'visual'`) that was
  hand-copied across ~20 http/lifecycle sites now reads `SessionableJobType`
  — new sessionable types stop requiring a shotgun edit.
- `orchestrator.ts`'s local jobType union gained `universal`; the full
  union-drift cleanup (5 remaining copies) is still open — see the plan's
  risk 4.
