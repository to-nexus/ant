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
one job. The agent level owns what its jobs share — persona prose, MCP
servers, the tool upper bound; each job narrows and specializes.

A workspace project has **one chat** (exactly like a codespace feature). You
switch the active agent and job with the chat composer's chips; each
(agent, job) pair keeps its own session, and the conversation stream is
shared — the same interaction model as switching builtin job types within a
feature chat.

## Where definitions live (scopes)

Definitions are **account/org-owned, never project-owned** — register once,
use across all of the account's workspace projects. Registration and editing
live in Settings → Agents (universal projects), or edit the files directly.

| Scope     | Location                                | Who edits            |
|-----------|------------------------------------------|----------------------|
| `user`    | `{user dir}/.ant/agents/{agentId}/`      | you, across all your projects |
| `org`     | `$ANT_CUSTOM_AGENTS_DIR` (self-host)     | org admins (read-only for members) |
| `builtin` | shipped with Ant (read-only samples)     | nobody — shadow it by creating the same id in a closer scope |

Closer scopes win id collisions: user > org > builtin. Shadowing is
whole-directory: the closer agent replaces the farther one entirely, jobs
included. The shipped `sample-researcher` agent is a builtin you can study or
shadow.

## Definition layout

```
.ant/agents/{agentId}/
  agent.yaml             # machine contract: name, shared MCP servers, tool upper bound
  base/*.md              # shared persona — always injected for every job
  injections/*.md        # shared conditional prose (loaded on demand)
  jobs/{jobId}/
    job.yaml             # job contract: tools (narrowing only), outputs, approval, models
    base/*.md            # job procedure — always injected
    injections/*.md      # job conditional prose (TOC injected; body via read_file)
```

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
- **Outputs as a contract, not an obligation** — chat-only turns are normal;
  when the job writes files, declared conventions (directory, format,
  naming, in-place updates) are checked against *real* writes and a manifest
  is announced in chat.

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
