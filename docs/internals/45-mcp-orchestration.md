# 45 — MCP Orchestration: Capability Servers, Trust Topology, Known Gaps

Status: runtime SSOT. Companion to [44-universal-job.md](44-universal-job.md)
(the universal runtime itself). 44 covers what a custom job *is*; this document
covers what happens when it reaches outside the process — the trust boundaries
an MCP connection crosses, the contract a capability server has to satisfy for
Ant's gates to work, and the parts of the picture that are not built yet.

Owner surfaces: `core/customAgents/{McpConnectionManager,McpCredentialResolver}.ts`,
`agents/universal/`, `examples/mcp-reference-server/`.

---

## 1. Position — one orchestrator, N capability servers

A custom job's capability splits into exactly two layers, and the split is
principled rather than a packaging convenience: **prompts specialize judgment
but cannot guarantee behavior.**

| Layer | Artifact | Guarantee |
|---|---|---|
| **Orchestration** — judgment, conversation, tool sequencing, reporting | agent/job/intent definition files | none; the model may decline, misread, or improvise |
| **Capability** — domain data access, mechanical rules, side effects | an MCP server the definition connects to | server code; deterministic |

Anything that must hold mechanically — amount limits, bulk-send prevention,
permission checks, complex branching — lives in the server. The LLM decides
*when* to call `refund_payment`; the server decides *whether this refund is
allowed*. A prompt that says "never refund over $500" is a preference; a server
that rejects it is a rule.

The user-facing framing of the same split is
[concepts/custom-agents.md](../concepts/custom-agents.md#why-a-definition-plus-a-server-not-just-a-prompt).
What follows here is the part that only matters when you are modifying Ant:
which of those boundaries is a *trust* boundary.

---

## 2. Process topology — what is a child, what is a peer

Three parent/child-shaped relationships exist; only two are OS processes, and
only one is Ant-spawned foreign code. Confusing them mis-assigns trust.

| Relationship | Boundary | Lifecycle owner | Trust consequence |
|---|---|---|---|
| ant-job worker → **job-runner child** | OS process (`spawn`, `JobWorker.ts`) | Ant | Ant's own code; carries the full job env (`ANT_CUSTOM_JOB_REF`, …) |
| job-runner → **stdio MCP child** | OS process (`StdioClientTransport` spawns `cfg.command`) | Ant (connect at job start, close at job end) | **Arbitrary third-party code on Ant's host.** Receives ONLY `buildStdioChildEnv()` = exec baseline (`PATH`/`HOME`/`LANG`/`LC_ALL`/`TMPDIR`/`SystemRoot`) + explicitly declared vars — never Ant's env (`McpConnectionManager.ts`) |
| job-runner → **HTTP MCP server** | network (streamable HTTP) | **the server's operator** | Not a child at all: an independent peer with its own deploy, monitoring, and credentials. Auth = `headers` whose values are `${secret:KEY}` references into the encrypted per-user store. The server never runs on Ant's host |
| job-runner → **subagent** (explore seam) | none (same process, separate LLM loop) | Ant | Logical child only; shares the tool registry via `ctx.subagent` — no process or trust boundary |

The stdio/HTTP asymmetry drives the deployment policy: **HTTP transport is the
default for any server you did not write yourself**; stdio is exception-only. A
stdio server is arbitrary code execution equivalent to `run_command`, and its
process dies with the job — no independent scaling, no operator-side
observability.

**Closed-network constraint.** The MCP client connects *outbound from the
job-runner child*. A capability server inside a closed network is reachable
only by an Ant host inside that network. An operator with capability servers
in several isolated zones therefore runs one Ant deployment per zone, each with
its own Redis and workspace plane — there is no cross-zone orchestrator. This
is a topology fact, not a bug; deployment plans must state it.

```bash
# stdio env isolation is a guarded contract:
# tests/customAgents/universal-mcp-runtime.test.ts (dispatch + isolation axes)
rg -n "process.env as Record" packages/ant-cli/src/core/customAgents/McpConnectionManager.ts
# Expected: 0 hits.
```

---

## 3. Capability server contract

These are the rules Ant's runtime assumes when it calls a server. Rules 4 and
10 are hard contracts — break them and the tool is unrunnable or the connection
fails. The rest are the difference between a server the model uses well and one
it flails against. `examples/mcp-reference-server/` is the executable version of
this list; its README carries the copy checklist.

1. **Tool unit = verb, not task.** "Write the weekly report" is not a tool;
   `list_incidents` / `get_sla_metrics` are. Composition is the job prompt's
   work — a task-shaped tool moves judgment into a place that cannot exercise it.
2. `description` is a prompt the model reads: state when to use it **and when
   not to**.
3. Narrow input schemas — enums over free strings.
4. **Read tools MUST declare `annotations.readOnlyHint: true`.** Ant's approval
   gate branches on exactly this value (`requiresApproval`; MCP default is
   *always gated* unless annotated). Omitting it makes the tool unrunnable
   until interactive approval lands — see [§5](#5-known-gaps) and
   [44 §Approval gate](44-universal-job.md#approval-gate-1-8-phase-1--fail-closed).
5. Write tools: idempotency key + `dry_run` carrying the blast radius.
6. **Guaranteed rules are server code** — limits, bulk-send prevention,
   permission checks. Never prompt-only (§1).
7. Errors are human-readable sentences; the model plans recovery from that text.
8. Response size caps + pagination. Context budget is cost. Ant spools
   non-error results over 32 KiB to the artifacts sandbox
   (`mcp-results/{server}/{tool}-{seq}.txt`, path + preview in context — see
   [44 §MCP connections](44-universal-job.md#mcp-connections--the-credential-plane-a16a13)),
   but that is a backstop for legitimately large datasets, not a license to
   skip pagination: a spooled result still costs a full transfer and a
   read-back.
9. Naming: server `{domain}-{system}`, tools `snake_case` verbs.
10. **Auth is exactly one mechanism**: `headers` (http) / `env` (stdio),
    transport-exclusive, values either literals or `${secret:KEY}` references
    resolved from Ant's encrypted per-user store. No credential ever lands in a
    definition file. Full plane:
    [44 §MCP connections & the credential plane](44-universal-job.md#mcp-connections--the-credential-plane-a16a13).

### Connection scope — agent-level vs job-level

Connect is **fail-loud at job start**. Declaring a server on `agent.yaml`
therefore couples every job under that agent to that server's availability: an
unreachable server takes down sibling jobs that never call it. Declare the
connection on the job that uses it (`jobs/{id}/job.yaml`) unless every job
genuinely needs it. This is why the shipped `examples/custom-agents/ops-team/`
puts its server on the `weekly-report` job rather than the agent.

### Versioning

Additive tool changes are free. Renames and removals are a coordinated
definition + server change — the definition file and the server deploy move
together, same as any cross-package contract.

### Credential handling

Secrets live only in the encrypted per-user store
(`workspaces/{org}/{user}/.ant/credentials.json`, AES-256-GCM; registered via
`PUT /api/account/mcp-credentials` or the settings UI). A `headers`/`env` value
carries the marker `${secret:KEY}`, which names a store key; resolution is
store-only (`McpCredentialResolver` never reads `process.env`), so a definition
cannot name-and-exfiltrate a platform secret.

**A definition file cannot detect a pasted credential for you.** An unmarked
value is stored verbatim as a literal, by design — credential-ness is authored,
never inferred from shape (see the tombstone in [44](44-universal-job.md#mcp-connections--the-credential-plane-a16a13)).
Reviewing a definition for pasted tokens is a human checklist item, not
something `validateMcpServers` can enforce. What the three enforcement layers
(loader, HTTP gate, settings form) do share is transport-exclusivity and
malformed-reference rejection.

The failure mode this actually produces: a bare `Authorization: OPS_API_TOKEN`
header is accepted as a *literal*, so the key name ships as the header value and
the server answers 401 with no config error anywhere. `tests/customAgents/builtin-agents.test.ts`
guards the shipped definitions against exactly this.

---

## 4. Unattended runs — design constraints

Nothing here is built. It is recorded so the work starts from facts rather than
the optimistic one-liner ("reuse `executeJob`"), each point verified against
current code.

- **Scheduler ≠ HTTP route reuse.** `POST .../execute` requires a JWT
  (`extractUserContext` throws otherwise outside local mode). A scheduler has no
  interactive human: it needs a new internal enqueue path constructing
  `JobPayload.userContext` directly — which forces the *billing identity*
  question (service account vs. owner delegation) before any cron code. BullMQ
  today is single-shot (`attempts: 1`, per-call `generateHumanId()` job ids —
  incompatible with repeatable-job key reuse).
- **Intents are parameters, not inference.** The runtime never auto-classifies
  intents ([44 §Why one JobType](44-universal-job.md#why-one-jobtype-not-n));
  `intents` / `overrideDirective` already travel in the execute body, and an
  unpinned turn resolves deterministically (explicit → inherited clarify
  continuity → `general` — **there is no catalog default**; the historical
  `default: true` knob was retired with the intents/{id} cutover). A schedule
  stores its intent/directive as fixed registration-time parameters, so
  schedule-destined work carries 0–1 intents decided at registration — do not
  design intent taxonomies that assume runtime classification. This is now
  built: a pipeline step pins `(customJobRef, intent ≤ 1)` in its YAML
  ([46](46-pipeline-scheduling.md)).
- **Reporting is an MCP tool, not a new subsystem.** "Send the report to the
  channel" is a `notification`-domain server (`send_message`) called by the job
  at the end of its own prompt — the same convergence as every other capability.
  A dormant `SlackIntegration` config scaffold exists with zero consumers; it
  should be **deleted, not revived**. The one gap a job cannot self-serve is
  **failure reporting**: a crashed job calls nothing. That is a separate consumer
  subscribing to the existing `JOB_STATUS_UPDATES` Redis pub/sub — alongside the
  SSE broadcaster, never a hook inside BullMQ internals (Unified Distributed
  System Principle).
- **Audit log is greenfield.** No general action-audit store exists; the nearest
  structural precedent is the append-only credit ledger
  (`core/ports/creditLedger.ts`) — reuse the pattern, not the code.
- **A scheduler does not solve per-case lifecycles.** A universal session is
  conversation continuity per (agent, job), not a lifecycle per *case* ("this
  one refund", "this one review round"). Work shaped as multi-day waits on an
  external reply, human approval gates, and re-verification loops needs
  durable per-case state — event fan-in ("the document arrived"), resume-on-
  reply, loop-back-a-stage — which a cron trigger cannot provide. Treat it as
  a separate design axis from the scheduler; do not scope "unattended runs" as
  if cron closes it.

---

## 5. Known gaps

What the runtime cannot do today, independent of any schedule.

Priority note: **A3 is the highest-leverage gap on this list.** The fail-closed
approval gate makes every definition read-only by default, so until the
interactive flow exists, no write-shaped work can ship at all — the other rows
widen what jobs can do, A3 unlocks a category. The audit log (§4) is a
precondition for opening writes broadly, which places it ahead of A6 and the
scheduler for any deployment that intends gated writes.

| Gap | Current behaviour | Shape of the fix |
|---|---|---|
| **A3 interactive approval** | Fail-closed: `gateCall` *rejects* gated calls with guidance instead of executing them. A write tool runs only under an explicit `approval: never` declaration, so a definition is read-only by default | Surface the gated call to the user (chat card), pause the graph turn, resume on approve/deny. The session field `pendingApproval` is reserved; the gate itself already exists |
| **A5 image passthrough** | `McpCallResult.image` is extracted and then dropped at the registry handler — MCP results are text-only | `runtime.ts` registry handler + chat rendering. Small and self-contained; schedule it when the first image-returning tool appears |
| **A6 single org root** | `deriveCustomAgentScopeRoots` builds `user > org > builtin`, where the org root is one global env var (`ANT_CUSTOM_AGENTS_DIR`, readonly). Projects are `(tenant,user)`-owned, so every artifact lands in a personal project | Multiple org roots, then `team` org-kind activation (creation/join flows — [40-org-model.md](40-org-model.md)). Shared definitions need a shared-project story for their outputs |
| **Cross-tool data plane (long form)** | Result spooling ([44 §MCP connections](44-universal-job.md#mcp-connections--the-credential-plane-a16a13)) covers tool→file; tool→tool composition still routes through the model, and computed transforms need `run_command` (approval-gated unless the author declares `never`) | Expose read-tool stubs inside a sandboxed code-execution surface so the model writes a transform instead of transcribing data; keep the approval gate on write tools only. Industry direction: Anthropic "Code execution with MCP" |
| **MCP 2026-07-28 spec revision** | Client stack + reference server predate the revision (protocol de-sessioning, OAuth changes, DCR→CIMD) | Review pass over `McpConnectionManager` (transport/session assumptions) and `examples/mcp-reference-server`; no known breakage, but the assumption set is unaudited |
| **Unattended runs** | Scheduler + chaining + approval gates + run audit shipped as the pipeline runtime ([46](46-pipeline-scheduling.md)). Still open: per-case lifecycles (a separate design axis — §4), clarify/A3 await hand-off (46 Phase 2) | §4 · [46](46-pipeline-scheduling.md) |

---

## Read next

- [44-universal-job.md](44-universal-job.md) — the runtime contract: one
  JobType, definition loader/scopes, tool sandbox, credential plane, approval
  and plan-turn gates, checklist plane.
- [46-pipeline-scheduling.md](46-pipeline-scheduling.md) — the scheduler §4
  anticipated: file-defined pipelines chaining universal runs on cron with
  human approval gates.
- [guides/custom-agent-authoring.md](../guides/custom-agent-authoring.md) —
  build a definition start to finish.
- [examples/README.md](../../examples/README.md) — the reference server and the
  `ops-team` definition set that exercise every contract above on real traffic.
