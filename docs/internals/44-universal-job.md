# 44 — Universal Job: File-Defined Custom Agent/Job Runtime

Status: Phase 1 (MVP) landed. Owner surfaces: `agents/universal/`,
`core/customAgents/`, `templates/jobs/universal/`,
`periphery/adapters/http/routes/customAgents.routes.ts`.

## Why one JobType, not N

A new JobType costs hand-copied unions in 5+ places and ~115 file touches.
Custom jobs therefore NEVER mint a JobType: everything executes as
`jobType='universal'` and the definition travels as an opaque composite key
`customJobRef = "{agentId}/{jobId}"` on the same channel overrideDirective
uses (HTTP body → zod schema → ExecuteJobParams → JobPayload →
`ANT_CUSTOM_JOB_REF` env → job-runner → orchestrator).
Adding/removing a custom job is a pure file operation.

```bash
# The ref must never fork into a second channel:
rg -n "ANT_CUSTOM_JOB_REF" packages/ant-cli/src --type ts
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
- **Tier**: pinned Reflex at graph start (plan/visual precedent); Phase 2
  moves to LLM-declared `<executionTier>` per the 7a matrix. Tier 4 is
  deliberately unused (would be a tautology axis with `activePlanPath`).

## Definition loading (D4/D5/D8)

- Loader SSOT: `core/customAgents/CustomAgentLoader.ts`. Merge rules: prose =
  agent base → job base (cap 8k, truncation footer); injections TOC union
  (job wins); MCP union (job wins); `tools.builtin` job ⊆ agent ⊆ preset
  (narrowing only); approval stricter-wins; models/workspace job-overrides.
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
- **Create-collision is writable-scope-only** (`findCreateCollision`): a new
  user agent may shadow a readonly (org/builtin) agent wholesale; only a
  same-id user agent 409s. Creation (Settings → Agents, or
  `POST /custom-agents`) always targets the user scope — there is no scope
  request parameter. Future: expose `shadows` on `CustomAgentSummary` and a
  copy-to-scope endpoint so shadowing doesn't start from an empty scaffold.
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

## Approval gate (1-8, Phase 1 = fail-closed)

`requiresApproval`: explicit declaration → mutating-builtin default
(`run_command`, `http_request` ⇒ always) → MCP default (always unless the
server annotates `readOnlyHint`). The tool node's `gateCall` REJECTS gated
calls with guidance ("do not retry; tell the user; author may declare
`never`") — silent execution is forbidden. The interactive
pause/approve/resume flow is the Phase-1.5 follow-up; the session field
reserved for it is `pendingApproval`.

## Prompt injection (1-4)

Two-layer prompt: builtin harness (`templates/jobs/universal/nodes/agent/`,
registered as `TEMPLATE_PATHS.universalAgent`) + the definition as an
**inert** boundary-tagged block (`wrapCustomJobContent` →
`<custom_job_instructions id source="workspace">`), injected via
`PromptBuildConfig.inertSystemAppend` — after merged injections, before
policy (guardrail-first / policy-last invariants hold). Custom prose is never
Handlebars-compiled (no partial access).

Guard: `tests/customAgents/universal-prompt-injection.test.ts` (gate truth
table, not prose pinning).

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
- `FeatureCrudService.createFeature`: rejected on universal projects
  ("git 없는 feature"라는 개념 모순의 구조적 차단).
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
