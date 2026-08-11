# Authoring a Custom Agent / Job

This guide walks through defining a custom agent with one job, from empty
directory to a running chat. Concepts:
[concepts/custom-agents.md](../concepts/custom-agents.md).

## 0. Study the shipped sample

Every universal project already lists **`assistant`** — a read-only builtin
general-purpose agent shipped with Ant (source of truth:
`packages/ant-cli/src/core/data/agents/assistant/`). It demonstrates a
minimal agent (identity + persona prose only), a job that declares tool
narrowing (the full preset minus two deliberate exclusions), a per-tool
approval override (`run_command: never`), and a job intent catalog with one
injection per intent. Its yaml comments double as field documentation.

You cannot edit it in place, and creating a new agent under an id any scope
already owns (builtin included) is refused with 409 — build your own agent
under its own id instead. (Pre-existing on-disk id collisions still resolve
by scope priority: user > org > builtin.) It deliberately declares no MCP
server; the `ops-team` example below is where MCP is shown.

## 1. Scaffold

Use Settings → Agents (register button), or create the files by hand under
your account root `{workspaces}/{org}/{user}/.ant/agents/` — definitions are
account-owned and shared across your workspace projects:

```
.ant/agents/ops-team/
  agent.yaml
  base/role.md                 # agent prose — who this agent is (default name)
  jobs/weekly-report/
    job.yaml
    base/system.md             # job prose — how this job runs (default name)
    injections/weekly-report-format.md
    intents.yaml
```

`role.md` / `system.md` are only the names the scaffold and the shipped
built-in use. Any number of `base/*.md` files is allowed; they are concatenated
in filename order (agent prose first, then job prose).

Intents, injections, and tools are **job-owned** — there is no agent-level
`intents.yaml` or `injections/` (a legacy definition carrying them fails loud
with a move instruction).

## 2. agent.yaml — identity + shared connections

```yaml
id: ops-team                 # kebab-case, must equal the directory name
name: "Ops Team"
version: 1
mcp:
  servers:
    ops-db:
      transport: stdio
      command: "npx"
      args: ["-y", "@acme/ops-db-mcp"]
      env:
        DB_URL: ${secret:OPS_DB_URL}   # credential reference — the secret lives in the encrypted store
    ops-api:
      transport: http        # streamable HTTP
      url: "https://ops-api.internal/mcp"
      headers:
        Authorization: ${secret:OPS_API_TOKEN}   # credential reference, same rule as env
        X-Workspace-Id: ws-ops-prod              # plain text, stored verbatim
```

`env` and `headers` values are either plain text (stored verbatim in this
file) or a `${secret:KEY}` reference to the encrypted per-user store — you
declare which; nothing is inferred from the value's shape. Register each
referenced key's value once — through the agent settings UI, or
`PUT /api/account/mcp-credentials {"key":"OPS_API_TOKEN","value":"Bearer …"}`
— and rotate it there without touching the definition. Reference resolution
reads ONLY the store (never the host environment), so a definition cannot
name-and-leak Ant's own secrets. A bare ALL-CAPS value (the pre-`${secret:…}`
key-name format) is rejected with a migration hint rather than silently
downgraded to plain text.

`headers` is the one authentication mechanism for `http` servers, and `env` the
one for `stdio`; each is rejected on the other transport. A stdio child receives
only its declared `env` (resolved values) plus a minimal exec baseline (`PATH`,
`HOME`, `LANG`, …) — never Ant's own environment, so a server never sees Ant's
provider keys.

That is the whole schema. There is no `description` (the persona lives in
`base/*.md` prose the model actually reads) and no agent-level `tools` —
each job declares its own. `mcp` is the one shared field: servers here are
unioned into every member job (a job-level server with the same name wins).

## 3. jobs/{id}/job.yaml — the job contract

```yaml
id: weekly-report
name: "Weekly Ops Report"
version: 1
tools:
  builtin: [read_file, list_files, search_files, create_file, edit_file]
  # ^ validates directly against the universal preset. Omit to allow the
  #   full preset. Extra capability comes from MCP, never new builtins.
  approval:
    "mcp__ops-db__push": always   # always | never; mutating tools default to always
```

There is no job `description` (the loader rejects it — mirrors `agent.yaml`):
the job shows its `name` on the composer chip, and what the job is plus how it
works belongs in `base/*.md` prose, which is what the model actually reads.
Output conventions ("reports live under `reports/`, revisions edit the existing
file, …") go in that same prose; there is no outputs schema to configure.

## 4. Prose — base/ and injections/

- `base/*.md` is **always injected**, agent files first, then job files,
  filename order. Keep it under ~8,000 characters combined — overflow is
  truncated with a visible footer. Put the identity and the procedure here.
- `injections/*.md` (job-level) is **loaded on demand**: the runtime injects
  only a table of contents (filename + first line as the summary); the model
  reads a file with `read_file` from the read-only definition mount when it
  needs it. No size cap. Put report templates, long checklists, and
  rare-case playbooks here.

Prose is inert — it is never template-compiled, and it cannot override the
runtime's safety or output rules (the harness states this explicitly).

## 4.5 Intents — inlining injections by situation

An optional `jobs/{jobId}/intents.yaml` maps situations to that job's
injections, so situational rules arrive in full exactly when they apply
instead of waiting to be read on demand:

```yaml
version: 1
intents:
  - id: incident            # kebab-case; 'general' is reserved (the no-match fallback)
    description: 'Reporting, investigating, or following up on a service incident'
    injections: [incident-playbook.md]
```

- **Intents are selected explicitly, never auto-classified.** A turn carries the
  intents the user mentioned with `@intent:` in the composer (or that an API
  caller passed in the execute body); those intents' injections are inlined in
  full. There is no per-turn LLM classification pass.
- A turn with no explicit mention runs as the reserved `general` intent, so every
  injection stays on the table of contents and the model pulls what it needs with
  `read_file` — the `description` is what it reads to decide, so write it for
  that judgment.
- The shipped `assistant` agent's catalog
  (`packages/ant-cli/src/core/data/agents/assistant/jobs/chat/intents.yaml`)
  is the working example.

## 4.6 Plan turns — `@plan` in the composer

Planning is not a job setting; it is a **per-turn user decision**, orthogonal
to intents. Mention `@plan` in the composer (any custom job accepts it) and
that run produces or updates a plan document instead of doing the work: the
runtime confines file writes to `plan/` and rejects execution tools
(`run_command`, `http_request`, mutating MCP) for the turn. Review the plan,
then send a normal turn to execute it.

## 5. Validate and run

- `GET /api/projects/{id}/custom-agents/{agentId}/jobs/{jobId}/validate`
  runs the loader's full validation (broken YAML, id mismatches, unknown
  tools, legacy fields, secret values in env).
- `GET /api/account/agents/{agentId}/jobs/{jobId}/prompt-preview?intents=a,b`
  returns the exact composed definition block the runtime will inject — the
  settings screen's "Composed prompt" card renders it per intent selection.
- A broken definition also fails loudly with HTTP 400 when a job is started —
  never silently inside the worker.
- In the UI: open a workspace project and pick the agent and job with the
  chat composer's chips, then chat — one conversation per workspace, with
  per-(agent, job) sessions behind it.

## 6. Iterating

Definitions are read fresh at every job start (the workspace disk is the
source of truth) — edit the files and the next run picks them up. A running
job keeps the definition it started with.

## Migrating a pre-job-only definition

Older definitions carried agent-level catalogs and extra yaml fields. Each
now fails loud with the fix in the message:

| Legacy | Fix |
|---|---|
| `{agent}/intents.yaml` | move into `jobs/{jobId}/intents.yaml` |
| `{agent}/injections/*.md` | move into `jobs/{jobId}/injections/` |
| `agent.yaml: tools` | declare in `jobs/{jobId}/job.yaml` |
| `agent.yaml: description` | fold into `base/*.md` prose |
| `job.yaml: description` | fold into the job's `base/*.md` prose |
| `job.yaml: outputs` | describe conventions in the job's `base/*.md` |
| `job.yaml: plan` | delete — use the composer's `@plan` per turn |
| `workspace` / `models` (either file) | delete — they never had a runtime effect |

The settings Prompts view can read, re-save, and delete the files in place.

## Pitfalls

- **Secrets**: put a secret in `mcp.servers.*.env` / `headers` only as a
  `${secret:KEY}` reference — a plain-text value is stored verbatim in the
  yaml, so it is for non-sensitive values only. The referenced key must be
  registered in the encrypted store (settings UI or
  `PUT /api/account/mcp-credentials`) before the job starts, or the connection
  fails loud (`config_invalid`) rather than sending an empty credential. A
  bare ALL-CAPS value (legacy key-name format) fails validation with a
  migration hint.
- **Judgment vs. guarantees**: prompts specialize judgment; they cannot
  guarantee behavior. Anything that must be mechanically enforced (amount
  limits, bulk-send protection, complex branching) belongs in an MCP server
  the definition merely connects to.
- **Tool allowlist**: `tools.builtin` can only pick from the universal
  preset — MCP is the only way to add capability.
- **MCP trust**: an MCP stdio server is arbitrary code execution — treat
  adding one with the same care as running a script from the same source.
