# Custom Agents & Jobs (Universal Runtime)

> ⚠️ **Experimental.** The runtime, the definition loader, the MCP overlay with
> its encrypted credential store, and the checklist board all ship and are
> covered by tests. Three things are deliberately not there yet: **interactive
> approval** (a gated write tool is refused with guidance, so writes need an
> explicit `approval: never` grant), **team/org sharing** (definitions are
> account-owned; the org scope is a single read-only directory), and
> **scheduling** (there is no unattended-run path). The file format may still
> change — a definition is a handful of files, so migrating one is cheap.

Ant's builtin jobs (plan/design/code/visual/learn) are special-purpose
pipelines bound to a codespace's feature layout. **Custom agents** are the
opposite end: purpose-specialized work agents you define with *files*, running
on one generic runtime — the `universal` job type. No code change is needed to
add, edit, or remove one.

Think "Claude Projects / custom GPT, but on your own infrastructure": a fixed
harness (agentic loop, context-window management, tool sandbox, safety rules)
plus your purpose prose and machine contract on top.

This is what a **workspace** project is for — see
[spaces.md](spaces.md) for the codespace/workspace split and the layout each
one puts on disk.

## Why a definition plus a server, not just a prompt

The design boundary worth understanding before you write anything:

> **Prompts specialize judgment; they cannot guarantee behavior.**

Prose is the right home for "which incidents count as sev-1", "what a weekly
report must cover", "when to escalate rather than answer". It is the wrong home
for anything that must *hold* — a refund ceiling, a bulk-send limit, a
permission check. Those belong in code the agent merely calls: an MCP server.
The model decides *when* to call `refund_payment`; the server decides *whether
this refund is allowed*.

So a mature custom agent is usually two artifacts with two owners: a definition
(the judgment) and one or more MCP servers (the guarantees). The organizational
version of that split is
[internals/45-org-ax-mcp-orchestration.md](../internals/45-org-ax-mcp-orchestration.md).

## The two-level model

```
Custom agent  (shared persona — a team, a role)
  └── Custom job  (one concrete duty of that agent)
```

There is no single-level shortcut: a standalone job is simply an agent with
one job. The agent contributes identity (name), the always-on persona prose
(`base/*.md`), and optionally shared MCP connections. Everything else —
tools, intents, injections — is **job-owned**, mirroring the canonical
system, where tool sets and intents belong to jobs, never agents.

A workspace project has **one chat** (exactly like a codespace feature). You
switch the active agent and job with the chat composer's chips; each
(agent, job) pair keeps its own session, and the conversation stream is
shared — the same interaction model as switching builtin job types within a
feature chat.

## Where definitions live (scopes)

Definitions are **account/org-owned, never project-owned** — register once,
use across all of the account's workspace projects. Registration and editing
live in the Agent Settings screen (profile menu), or edit the files directly.

| Scope     | Location                                | Who edits            |
|-----------|------------------------------------------|----------------------|
| `user`    | `{user dir}/.ant/agents/{agentId}/`      | you, across all your projects |
| `org`     | `$ANT_CUSTOM_AGENTS_DIR` (self-host)     | org admins (read-only for members) |
| `builtin` | shipped with Ant (read-only samples)     | nobody |

Pre-existing on-disk id collisions resolve by scope priority (user > org >
builtin, whole-directory — the closer agent replaces the farther one
entirely, jobs included), but creating or importing a NEW agent under an id
any scope already owns is refused with 409: silent shadowing has no UI
story. The shipped `assistant` agent is a builtin you can study; to
customize behavior, build your own agent under its own id.

## Definition layout

```
.ant/agents/{agentId}/
  agent.yaml             # identity: id, name (+ optional shared MCP servers)
  base/*.md              # shared persona — always injected for every job
  jobs/{jobId}/
    job.yaml             # job contract: name, tools (⊆ universal preset), approval
    base/*.md            # job procedure — always injected
    injections/*.md      # job conditional prose (TOC injected; body via read_file)
    intents.yaml         # job intent catalog (gates injection inlining)
```

Agent-level `intents.yaml` and `injections/` are **not** supported — a legacy
definition carrying them fails loud at load with a move instruction (the
settings Prompts view can create/delete the files). Neither `agent.yaml` nor
`job.yaml` carries a `description`: identity and procedure live in `base/` prose,
which is what the model actually reads. The one prompt-serving description left
is the per-intent one in `intents.yaml`, which the model reads off the injection
table of contents to decide what to pull in.

See the authoring guide: [guides/custom-agent-authoring.md](../guides/custom-agent-authoring.md).

## The runtime (what every custom job gets)

- **Agentic loop** — resolve → agent ⇄ tool → respond, with a recursion
  backstop and inline context-window compaction (the conversation is the
  job's only working memory and survives across runs of the same
  agent/job pair).
- **Tool sandbox** — file tools rooted at the project-shared
  `universal/artifacts/` tree (read-write) plus a read-only mount of the
  agent definition. No access to the codespace plane (codebase/, features/).
- **MCP overlay** — servers declared in the definition connect at job start;
  their tools appear as `mcp__{server}__{tool}`. MCP is the only way to add
  capability: the builtin tool list can be narrowed, never extended.
- **Approval gates** — mutating tools (`run_command`, `http_request`, MCP
  tools not marked read-only) require user approval. Phase 1 is fail-closed:
  gated calls are rejected with guidance instead of executed silently.
- **Plan turns (`@plan`)** — a per-turn composer flag, orthogonal to intents
  (like `/plan` in a coding agent): the run produces or updates a plan
  document, not the work. Enforced, not advisory — during a plan turn the
  tool gate confines file writes to `plan/` and rejects execution tools
  (`run_command`, `http_request`, mutating MCP). The work runs on a normal
  turn after you confirm.
- **Output honesty** — chat-only turns are normal; when the job writes files,
  a manifest of *real* writes (tool side-effects, never model claims) is
  announced in chat. Output conventions, when a job needs them, are plain
  prose in its `base/*.md`.
- **A checklist board** — see below.

## Credentials for MCP servers

A server's `env` (stdio) or `headers` (http) value is one of two things, and
**you declare which — nothing is guessed from the value's shape**:

- `${secret:OPS_API_TOKEN}` — a reference. The value lives in an encrypted
  per-user store (`.ant/credentials.json`, AES-256-GCM), registered once through
  Settings → Agents or `PUT /api/account/mcp-credentials`. Rotate it there
  without touching the definition file. Reading the list back returns key names
  only; values are write-only.
- anything else — a literal, stored verbatim in the yaml. Fine for a region or a
  tenant id; **not** for a token.

Two properties follow from resolving references against the store only:
a definition can never name one of Ant's own environment variables to
exfiltrate it, and a stdio server's child process receives only the variables it
declared plus a minimal exec baseline — never Ant's provider keys.

An unregistered key fails the job start loudly (`config_invalid`) instead of
sending an empty credential and getting a confusing 401 from the server.

## Progress: the checklist

A codespace job decomposes into tasks and ends on a verification gate. A custom
job has no task plane at all. Instead, when a turn's work breaks into **two or
more independent deliverables**, the agent writes a checklist and the
workspace's board renders it — pending, active, done — updating as it works. A
single-deliverable or answer-only turn leaves the board empty, on purpose.

Checklist items are **not tasks**: they never enter a task queue, never render
as kanban cards, and never count toward per-task billing. Nothing about the
checklist is configurable; it is harness behavior.

## Where the work lands

Custom jobs run only in a **workspace** project, and everything they produce
lands in that project's `universal/artifacts/` tree. Artifacts are owned by the
**project**, not by an agent: one shared tree serves every agent and job, so you
can upload a folder once and have every custom job read it. The explorer's
Artifacts panel shows this tree plus a root `sessions` folder (session JSONs +
debug logs — the same role as a codespace feature's sessions folder;
download/delete only).

Note the asymmetry that trips people up: **definitions are account-owned,
artifacts are project-owned.** One `ops-team` agent serves all of your
workspaces; each workspace keeps its own reports.

The full layout, and why the project kind is policy rather than a fork, is in
[spaces.md](spaces.md).

## Read next

- [**spaces**](spaces.md) — codespace vs workspace, and the layout of each.
- [**guides/custom-agent-authoring**](../guides/custom-agent-authoring.md) —
  build one, start to finish.
- [internals/44-universal-job.md](../internals/44-universal-job.md) — the
  runtime contract (one JobType, tool sandbox, credential plane, checklist).
- [internals/45-org-ax-mcp-orchestration.md](../internals/45-org-ax-mcp-orchestration.md)
  — rolling this out across an organization's departments.
