# 45 — Organization AX: Universal Job + Department MCP Orchestration

Status: strategy + runtime SSOT. Companion to
[44-universal-job.md](44-universal-job.md) (the runtime itself). This document
covers what 44 deliberately does not: **why** the universal runtime is the
vehicle for organization-wide AX (automation transformation), what remains to
be built on the Ant side, how department MCP server groups must be
constructed, and how raw work inventories are normalized into agent/job/intent
definitions.

Owner surfaces: `agents/universal/`, `core/customAgents/`, the
[ant-work-inventory](https://github.com/to-nexus/ant-work-inventory) repo, and
every department MCP server built against this contract.

---

## 1. Position — one orchestrator, N capability servers

The AX model splits the organization's automation into exactly two layers:

| Layer | Owner | Artifact |
|---|---|---|
| **Orchestration** — judgment, conversation, tool sequencing, reporting | Ant (central) | universal agent/job/intent definitions (files) |
| **Capability** — domain data access, mechanical guarantees, side effects | each department | an MCP server wrapping that domain's service logic |

The boundary is principled, not organizational convenience: **prompts
specialize judgment but cannot guarantee behavior.** Anything that must hold
mechanically — amount limits, bulk-send prevention, permission checks, complex
branching — lives in MCP server code that the definition merely connects to
([custom-agent-authoring.md](../guides/custom-agent-authoring.md), Pitfalls).
The LLM decides *when* to call `refund_payment`; the server decides *whether
this refund is allowed*.

Two structural decisions keep this from fragmenting:

1. **No new JobTypes.** Every department job executes as `jobType='universal'`
   with the definition as data (`customJobRef`). Adding a department workflow
   is a file operation, not a code change ([44 §"Why one JobType"](44-universal-job.md)).
2. **Definitions have a single author.** The central FDE (총괄) writes every
   agent/job/intent definition and every tool specification; departments own
   work knowledge (inventory) and tool implementation only. Departments do not
   invent tool boundaries — that is the single convergence point that prevents
   N incompatible dialects.

```
dept tacit knowledge ──(D1: inventory + interview)──▶ raw material
   └──(D2: FDE translation)──▶ agent/job/intent definitions
                                 └──(D3: tool spec)──▶ D4: dept MCP server
```

---

## 2. Process topology — what is a child, what is a peer

Three parent/child-shaped relationships exist; only two are OS processes, and
only one is Ant-spawned foreign code. Confusing them mis-assigns trust.

| Relationship | Boundary | Lifecycle owner | Trust consequence |
|---|---|---|---|
| ant-job worker → **job-runner child** | OS process (`spawn`, `JobWorker.ts`) | Ant | Ant's own code; carries the full job env (`ANT_CUSTOM_JOB_REF`, …) |
| job-runner → **stdio MCP child** | OS process (`StdioClientTransport` spawns `cfg.command`) | Ant (connect at job start, close at job end) | **Arbitrary third-party code on Ant's host.** Receives ONLY `buildStdioChildEnv()` = exec baseline (`PATH`/`HOME`/`LANG`/`LC_ALL`/`TMPDIR`/`SystemRoot`) + explicitly declared vars — never Ant's env (`McpConnectionManager.ts`) |
| job-runner → **HTTP MCP server** | network (streamable HTTP) | **the department** | Not a child at all: independent peer with its own deploy, monitoring, and credentials. Auth = `headers` whose values are `${secret:KEY}` references into the encrypted per-user store. The server never runs on Ant's host |
| job-runner → **subagent** (explore seam) | none (same process, separate LLM loop) | Ant | Logical child only; shares the tool registry via `ctx.subagent` — no process or trust boundary |

The stdio/HTTP asymmetry drives the deployment policy: **HTTP transport is the
default and effectively mandatory for department servers**; stdio is
exception-approved only (a stdio server = arbitrary code execution equivalent
to `run_command`, and its process dies with the job — no independent scaling,
no department-side observability).

**Closed-network constraint.** The MCP client connects *outbound from the
job-runner child*. A department server inside a closed network is reachable
only by an Ant host inside that network — which means the org runs **N
network-scoped orchestrators**, each with its own Redis and workspace plane,
not one global instance. This is a topology fact, not a bug; roadmaps must
state it.

```bash
# stdio env isolation is a guarded contract:
# tests/customAgents/universal-mcp-runtime.test.ts (dispatch + isolation axes)
rg -n "process.env as Record" packages/ant-cli/src/core/customAgents/McpConnectionManager.ts
# Expected: 0 hits.
```

---

## 3. Runtime status — what holds, what is open

As of 2026-08-11 (`2524da299`), the pilot-blocking defects are closed:

| Closed | What was fixed | Guard |
|---|---|---|
| A1 dispatch | `buildUniversalRegistry` now populates the module-load-captured registry singleton instead of replacing it — `mcp__*` calls resolve | `universal-mcp-runtime.test.ts` (identity + handler rows; red-verified) |
| A2 HTTP auth | `McpServerConfig.headers` (values follow the same `${secret:KEY}`-or-literal rule as `env`, resolved from the encrypted store since A16); wired to `requestInit.headers`; rejected on stdio | loader + definitionDocs rows |
| A4 env isolation | stdio child receives allowlist env only | `universal-mcp-runtime.test.ts` isolation rows (red-verified) |
| A8 doc drift | authoring guide / concepts match the loader (no job `description`; intents are explicit-only) | guide examples load verbatim |
| A16 credential plane | `headers`/`env` values resolve `${secret:KEY}` from the encrypted per-user store (`PUT /api/account/mcp-credentials`); resolution never reads `process.env`, so a definition cannot name-and-exfiltrate platform secrets | `mcp-credential-store.test.ts` + FE `mcpCredential*` rows |
| A13 failure class | an MCP config failure raises `McpConfigError` → `config_invalid` (`canResume:false`), never `process_crash` | `job-runner` mapping row |
| A14 stream scope | `StreamOrchestrator` is turn-scoped, so `<reply>` no longer leaks raw across tool rounds | streaming rows |
| A15 turn identity | the optimistic `user_turn` stamps the real jobType instead of `'code'` | chat persistence rows |

Open items, in dependency order:

| Open | Blocks | Shape |
|---|---|---|
| ~~**WS-D E2E**~~ ✅ **done 2026-08-11** | — (Gate 1 pilot-start condition met) | Reference server built outside this repo (fixture-only ops incident/SLA API: 4 tools, streamable HTTP + stdio, bearer auth) with a single `ops-team` agent whose `weekly-report` job declares the connection (job-level, because a fail-loud connect at agent level would take down sibling jobs that never touch the server). All three things unit tests cannot reach are now proven on real traffic: SDK spawn passthrough (stdio child sees only the mapped env, none of Ant's secrets), header auth both ways (unregistered credential key → fail-loud in 2s; registered → 200 + tool results), and zero `Unknown tool` across the session. The approval axis was demonstrated end-to-end too: an unannotated write tool is refused before reaching the server, and an explicit `approval: never` grant lets it run with the server's idempotency key + `dry_run` carrying the blast radius. E2E surfaced four Ant defects — two blocking (fixed: execute-route agent default shadowing the universal mapping; universal runtime never wiring a CommandPort) and three recorded, all since fixed (crash-mislabel of config failures → A13; `<reply>` leaking across tool rounds → A14; optimistic `user_turn` hardcoded to `jobType:'code'` → A15) |
| **A3 interactive approval** | Gate 2 (any write tool) | Phase 1 is fail-closed: approval-gated calls are *rejected with guidance*. Until the pause/approve/resume flow lands (`pendingApproval` session field is reserved), write tools run only under an explicit `approval: never` declaration — so the pilot is read-only by construction |
| **A6 department scope** | Gate 2 (shared workspaces) | `team` org kind is data-model-only; org agent root is one global env var; projects are `(tenant,user)`-owned. Until fixed, every artifact lives in a personal project |
| **A5 image passthrough** | dashboards/chart tools | MCP image content is extracted (`McpCallResult.image`) but dropped at the registry handler (text only). Becomes priority the moment a department tool returns a rendered artifact |
| **A7/A9/A10 scheduler + reporting + audit** | Gate 3 (unattended runs) | genuinely greenfield — see §6 |

---

## 4. Ant development roadmap (gate-aligned)

**Gate 1 — pilot (read-only).** ✅ **Open (2026-08-11).** The WS-D end-to-end
closed the last condition: a reference definition set (HTTP MCP + `headers`
auth over stored credentials, read-only builtin tools, one intent catalog) plus the reference server
(TypeScript, `@modelcontextprotocol/sdk` 1.30, streamable HTTP + stdio, bearer
auth, health check, structured logging, `annotations.readOnlyHint: true` on the
read tools) now run against each other on real traffic. The server lives
*outside* this repo — it is the D4 reference implementation departments copy,
and its own README carries the copy checklist (registerTool + flat ZodRawShape,
per-request stateless transport, annotations discipline, machine guards on
write tools). Pilot tools stay read-only by construction: the one write-shaped
tool is refused until a job explicitly declares `approval: never` for it.

**Gate 2 — spread (writes + sharing).** Two independent tracks:

- *A3 interactive approval*: surface the gated call to the user (chat card),
  pause the graph turn, resume on approve/deny. The session field
  (`pendingApproval`) and the fail-closed gate already exist; the work is the
  pause/resume seam and the FE affordance. Until this lands, every write tool
  spec must carry an explicit human-confirmation story or stay out of D3.
- *A6 team scope*: multiple org roots in `deriveCustomAgentScopeRoots`, then
  the `team` org kind activation (creation/join flows — see
  [40-org-model.md](40-org-model.md)). Definitions become department-shared;
  artifacts need a shared-project story.

**Gate 3 — automation (unattended runs).** Three subsystems, none of which is
"reuse the existing path" (verified against code — see the analysis in §6):
scheduler, completion reporting, audit log.

Non-gate: A5 image passthrough is a small, self-contained fix
(`runtime.ts` registry handler + chat rendering) — schedule it when the first
image-returning tool spec appears, not before.

---

## 5. Department MCP server groups — construction direction

### 5.1 The three-tier reality of "wrap your service logic"

An MCP tool must call *something*. Departments arrive in three states, and the
strategy differs per state — pretending otherwise stalls the rollout:

| Tier | Department state | Direction |
|---|---|---|
| (a) | System with an API (ERP, issue tracker, internal service) | Thin MCP adapter over the existing API. Days of work. The default target for first-wave selection |
| (b) | Data exists but no API (DB access, file shares, spreadsheets-as-database) | Small internal service (read models first) + MCP adapter on top. The MCP server may BE that service initially — but write paths must not be invented ad hoc inside a tool handler |
| (c) | No system (email + tacit process) | **Not automatable yet.** The inventory entry is still valuable — it documents the judgment rules — but D3 must not fabricate tools for systems that do not exist. Defer; revisit when the department stands up (b) |

First-wave selection filter (from the rollout plan): high frequency × explicit
judgment rules × **target system API exists** × reversible × output is a
document/data. Read/aggregate/search tools only until Gate 2.

### 5.2 Server contract (D3 rules — authored centrally, implemented by depts)

1. Tool unit = **verb**, not task. "Write weekly report" is not a tool;
   `list_incidents` / `get_sla_metrics` are. Report composition is the job
   prompt's work.
2. `description` is a prompt the LLM reads: when to use it AND when not to.
3. Narrow input schemas — enums over free strings.
4. Read tools MUST declare `annotations.readOnlyHint: true`. Ant's approval
   gate branches on exactly this value (`requiresApproval`); omitting it makes
   the tool unrunnable until A3 lands.
5. Write tools: idempotency key + `dry_run`.
6. **Guaranteed rules are server code** — limits, bulk-send prevention,
   permission checks. Never prompt-only.
7. Errors are human-readable sentences; the LLM plans recovery from that text.
8. Response size caps + pagination. Context budget is cost.
9. Naming: server `{domain}-{system}`, tools `snake_case` verbs.
10. Auth: exactly one mechanism — `headers`, whose values are `${secret:KEY}`
    references resolved from Ant's encrypted per-user store (A2/A16). No
    per-department inventions, and no credential in a definition file.

### 5.3 Operations

- **Placement**: department infra, HTTP, reachable from the Ant host serving
  that network zone. Closed-network departments imply a zone-local Ant host
  (§2).
- **Registry**: the central FDE keeps the server registry (name, URL, owner,
  version, tool inventory). A definition's `mcp.servers` block is the consumer
  view of that registry.
- **Versioning**: additive tool changes are free; renames/removals are a
  coordinated definition + server change (the definition file and the server
  deploy move together, same as any cross-package contract).
- **Secrets**: server credentials live only in the encrypted per-user store
  (`workspaces/{org}/{user}/.ant/credentials.json`, AES-256-GCM; registered via
  `PUT /api/account/mcp-credentials` or the settings UI) and as the
  department's own config — a `headers`/`env` value carries the marker
  `${secret:KEY}`, which names a store key. Resolution is store-only
  (`McpCredentialResolver`): process.env is never consulted, so a definition
  cannot name-and-exfiltrate platform secrets. **A definition file cannot
  detect a pasted credential for you** — an unmarked value is stored verbatim
  as a literal, by design (credential-ness is authored, not inferred from
  shape; see the tombstone in [44](44-universal-job.md)). Reviewing D2 output
  for pasted tokens is therefore a checklist item for the FDE, not something
  `validateMcpServers` can enforce. What the three enforcement layers (loader,
  HTTP gate, settings form) do share is transport-exclusivity and malformed-
  reference rejection.

---

## 6. Unattended runs (Gate 3) — design constraints established early

Recorded here so Gate 3 work starts from facts, not the optimistic one-liner
("reuse executeJob"):

- **Scheduler ≠ HTTP route reuse.** `POST .../execute` requires a JWT
  (`extractUserContext` throws otherwise outside local mode). A scheduler has
  no interactive human: it needs a new internal enqueue path constructing
  `JobPayload.userContext` directly — which forces the *billing identity*
  question (service account vs. owner delegation) before any cron code.
  BullMQ today is single-shot (`attempts: 1`, per-call `generateHumanId()`
  job ids — incompatible with repeatable-job key reuse).
- **Intents are parameters, not inference.** The runtime never auto-classifies
  intents (44 §"No execution tier, no detect node"); `intents` /
  `overrideDirective` already travel in the execute body. A schedule stores
  its intent/directive as fixed registration-time parameters. Consequently:
  work destined for scheduling gets 0–1 intents, decided at registration.
- **Reporting is an MCP tool, not a new subsystem.** "Send the report to the
  channel" is a `notification`-domain MCP server (`send_message`), called by
  the job itself at the end of its prompt — the same convergence as every
  other capability. A dormant `SlackIntegration` config scaffold exists with
  zero consumers; it should be deleted, not revived, when Gate 3 starts.
  The one gap a job cannot self-serve: **failure reporting** (a crashed job
  calls nothing). That is a separate consumer subscribing to the existing
  `JOB_STATUS_UPDATES` Redis pub/sub — alongside the SSE broadcaster, never a
  hook inside BullMQ internals (Unified Distributed System Principle).
- **Audit log is greenfield.** No general action-audit store exists; the
  nearest structural precedent is the append-only credit ledger
  (`core/ports/creditLedger.ts`) — reuse the pattern, not the code.

---

## 7. Inventory → definition normalization (D2 translation)

Collection lives in [ant-work-inventory](https://github.com/to-nexus/ant-work-inventory)
(one work item = one file under `domains/{domain}/`). The inventory is
interview prep, not a deliverable — completeness is deliberately not required;
the **judgment rules** field is the only make-or-break input (empty judgment
rules = translation stalls regardless of everything else).

### 7.1 Mapping table

| Inventory field | Definition artifact |
|---|---|
| domain | agent (`{domain}/agent.yaml` + `base/role.md` persona) |
| one work item | job (`jobs/{work}/job.yaml` + `base/system.md`) |
| judgment rules ("어떤 판단을 하나") | job `base/*.md` prose — the procedure the model always reads |
| situational branches ("상황이 갈리는 경우") | intents (`intents.yaml`) + per-intent `injections/*.md` |
| systems used ("쓰는 시스템") | MCP tool specification (D3) → department server (D4) |
| approval / failure cost | `tools.approval` (+ server-side guarantees per §5.2 rule 6) |
| outputs ("만들어 내는 것") | output conventions in job prose; artifacts land in `universal/artifacts/` |

### 7.2 Translation rules (beyond the table)

- **No `description` fields.** `agent.yaml` and `job.yaml` carry identity only;
  everything the model should know is `base/*.md` prose. (The loader rejects
  legacy `description` — a copy-pasted old template fails loud.)
- **Intent granularity follows the consumption channel.** Intents are
  explicit-only (`@intent:` mention or execute-body parameter). For
  interactive work, fine-grained intents are fine — the model also reads the
  injections TOC on `general` turns. For schedule-destined work: 0–1 intents
  (§6). Do not design intent taxonomies that assume runtime classification.
- **Always-needed vs. sometimes-needed prose**: always → `base/*.md` (8k cap,
  truncation footer); situational → `injections/` (TOC + on-demand
  `read_file`). Report templates and rare-case playbooks are injections.
- **Tool boundaries come from D3, never from the inventory verbatim.** The
  inventory says "we look things up in system X"; the FDE decides the verb
  set. Departments implementing D4 build exactly the specified tools.
- **Write actions stay out of first-wave definitions** (A3). If a work item is
  meaningless without its write step, defer the whole item rather than
  shipping a half-job that dead-ends at a rejected call.

### 7.3 Post-collection procedure

1. **Blank-field statistics first** — which fields came back empty is the only
   observable measure of where the readme under-explained. Judgment-rule
   blank rate > 30% ⇒ interview round before document surgery.
2. **Select** by the §5.1 filter; classify each selected item into tier
   (a)/(b)/(c).
3. **Translate (D2)** per the mapping table; FDE sole author.
4. **Specify tools (D3)** citing the verified WS-D reference; hand to
   departments (D4).
5. **Delegation pivot**: once translation patterns accumulate from the pilot,
   D2 authorship widens to trained department staff. Until then, single-author
   is the anti-fragmentation price, paid deliberately.

---

## 8. Ownership summary

| Central FDE (총괄) | Departments |
|---|---|
| All agent/job/intent definitions | Work knowledge + judgment-rule accuracy (D1) |
| Tool boundaries and specs (D3) | Tool implementation + operation (D4) |
| Auth mechanism, naming, `readOnlyHint` discipline | Server hosting, monitoring, credentials |
| Error/pagination conventions, version policy | Internal service logic behind the tools (§5.1) |
| Server registry | |

Gate summary: **1** = ✅ open — WS-D E2E passed 2026-08-11, read-only tools
(all code prerequisites closed). **2** = A3 interactive approval + A6 team scope. **3** = scheduler
(new internal enqueue path + billing identity) + notification-domain MCP +
`JOB_STATUS_UPDATES` failure consumer + audit log.
