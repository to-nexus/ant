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
`ANT_CUSTOM_JOB_REF`/`ANT_THREAD_ID` env → job-runner → orchestrator).
Adding/removing a custom job is a pure file operation.

```bash
# The ref must never fork into a second channel:
rg -n "ANT_CUSTOM_JOB_REF" packages/ant-cli/src --type ts
# Expected: JobWorker (write), job-runner (read) only.
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
- **Session**: `{thread}/sessions/universal/universal.json`, conversation on
  the `session:main` channel so it persists across runs of the same thread.
- **Tier**: pinned Reflex at graph start (plan/visual precedent); Phase 2
  moves to LLM-declared `<executionTier>` per the 7a matrix. Tier 4 is
  deliberately unused (would be a tautology axis with `activePlanPath`).

## Definition loading (D4/D5/D8)

- Loader SSOT: `core/customAgents/CustomAgentLoader.ts`. Merge rules: prose =
  agent base → job base (cap 8k, truncation footer); injections TOC union
  (job wins); MCP union (job wins); `tools.builtin` job ⊆ agent ⊆ preset
  (narrowing only); approval stricter-wins; models/workspace job-overrides.
- Scope roots: `deriveCustomAgentScopeRoots` — project > user > org
  (`$ANT_CUSTOM_AGENTS_DIR`, readonly). Adding org sync later = one more root.
- **Activation is job-runner-child-only** (`activeCustomJob.ts` throws on
  double activation). The API server only lists summaries. Validation
  failures are HTTP 400 at job-accept (`resolveUniversalExecuteContext`),
  never a crash inside the child.

Guard: `tests/customAgents/custom-agent-loader.test.ts`.

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
ALWAYS namespaced under `universal/` regardless. Enforcement points:

- `/execute` universal branch: 400 `project-not-universal` on canonical
  projects (`resolveUniversalExecuteContext`).
- `FeatureCrudService.createFeature`: rejected on universal projects
  ("git 없는 feature"라는 개념 모순의 구조적 차단).
- `deleteProject`'s fs.rm covers `universal/` (threads + artifacts) without
  a new cascade step; feature-stage steps are naturally no-ops.

Threads (`universal/agents/{agentId}/{jobId}/threads/{threadId}`) flow
wherever a featurePath-shaped value is expected — the single seam is
`WorkspaceResolver.getAgentThreadPath` (+ `getUniversalArtifactsPath`), used
by JobWorker and the routes. Artifacts are project-owned
(`universal/artifacts/`), agents own only their sessions.

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
