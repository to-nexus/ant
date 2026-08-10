# Custom Agents & Jobs (Universal Runtime)

Ant's builtin jobs (plan/design/code/visual/learn) are special-purpose
pipelines bound to the canonical feature workspace. **Custom agents** are the
opposite end: purpose-specialized work agents you define with *files*, running
on one generic runtime — the `universal` job type. No code change is needed to
add, edit, or remove one.

Think "Claude Projects / custom GPT, but on your own infrastructure": a fixed
harness (agentic loop, context-window management, tool sandbox, safety rules)
plus your purpose prose and machine contract on top.

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
  agent definition. No access to the canonical plane (codebase/, features/).
- **MCP overlay** — servers declared in the definition connect at job start;
  their tools appear as `mcp__{server}__{tool}`.
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

## Universal-type projects

A project is either `canonical` (builtin feature-based jobs) or `universal`
(custom agents only) — chosen at creation, stored as `projectType` in
`config.json`. The layout is invariant: the universal plane always lives
under `universal/`, so the flag is pure policy. Universal projects skip the
canonical scaffolding (no codebase/, features/, or git anchor) and reject
feature creation.

Artifacts are owned by the **project**, not by an agent: one shared
`universal/artifacts/` tree serves every agent and job — upload a folder
once, and every custom job can read it. The explorer's Artifacts panel shows
this tree plus a root `sessions` folder (session JSONs + debug logs — the
same role as a codespace feature's sessions folder; download/delete only).
