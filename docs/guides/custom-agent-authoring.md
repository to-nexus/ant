# Authoring a Custom Agent / Job

This guide walks through defining a custom agent with one job, from empty
directory to a running chat. Concepts:
[concepts/custom-agents.md](../concepts/custom-agents.md).

## 0. Study the shipped sample

Every universal project already lists **`sample-researcher`** — a read-only
builtin agent shipped with Ant (source of truth:
`packages/ant-cli/src/core/data/agents/sample-researcher/`). It demonstrates
the whole definition surface: tool narrowing, per-tool approval, an
`outputs: contract` job, a chat-only job, and `injections/` loaded on demand.
Its yaml comments double as field documentation.

You cannot edit it in place — to make it yours, create an agent with the
**same id** in user scope; a closer scope shadows the builtin wholesale
(jobs included). It deliberately declares no MCP server; the `ops-team`
example below is where MCP is shown.

## 1. Scaffold

Use Settings → Agents (register button), or create the files by hand under
your account root `{workspaces}/{org}/{user}/.ant/agents/` — definitions are
account-owned and shared across your workspace projects:

```
.ant/agents/ops-team/
  agent.yaml
  base/system.md
  jobs/weekly-report/
    job.yaml
    base/system.md
    injections/weekly-report-format.md
```

## 2. agent.yaml — the shared contract

```yaml
id: ops-team                 # [a-z0-9-]+, must equal the directory name
name: "Ops Team"
description: "Shared agent for service operations, reporting, incidents"
version: 1
mcp:
  servers:
    ops-db:
      transport: stdio       # or http (streamable) with url:
      command: "npx"
      args: ["-y", "@acme/ops-db-mcp"]
      env:
        DB_URL: OPS_DB_URL   # value is the HOST ENV VAR NAME — secrets never live in this file
tools:
  builtin: [read_file, list_files, search_files, create_file, edit_file, fetch_url]
  # ^ upper bound for member jobs. Omit to allow the full universal preset.
```

## 3. jobs/{id}/job.yaml — the job contract

```yaml
id: weekly-report
name: "Weekly Ops Report"
description: "Compiles the weekly operations report from the shared data"
version: 1
outputs:
  mode: contract             # none (chat only) | free | contract
  artifacts:
    - kind: weekly-report
      dir: reports/          # relative to universal/artifacts/ (plans/ is reserved)
      format: md
      naming: llm            # the model names the file, or a fixed pattern string
      update: in-place       # revisions edit the existing file
tools:
  builtin: [read_file, list_files, search_files, create_file, edit_file]
  # ^ must be a SUBSET of the agent's bound — narrowing only. Extra
  #   capability comes from MCP, never by widening the builtin list.
  approval:
    "mcp__ops-db__push": always   # always | never; mutating tools default to always
models:
  agent: claude-sonnet-5     # optional per-node model override
```

## 4. Prose — base/ and injections/

- `base/*.md` is **always injected**, agent files first, then job files,
  filename order. Keep it under ~8,000 characters combined — overflow is
  truncated with a visible footer. Put the identity and the procedure here.
- `injections/*.md` is **loaded on demand**: the runtime injects only a table
  of contents (filename + first line); your `base/` prose tells the model
  *when* to load which file, and the model reads it with `read_file` from the
  read-only definition mount. No size cap. Put report templates, long
  checklists, and rare-case playbooks here.

Prose is inert — it is never template-compiled, and it cannot override the
runtime's safety or output rules (the harness states this explicitly).

## 5. Validate and run

- `GET /api/projects/{id}/custom-agents/{agentId}/jobs/{jobId}/validate`
  runs the loader's full validation (broken YAML, id mismatches, tool-subset
  violations, contract-without-write-tools, secret values in env).
- A broken definition also fails loudly with HTTP 400 when a job is started —
  never silently inside the worker.
- In the UI: open a workspace project and pick the agent and job with the
  chat composer's chips, then chat — one conversation per workspace, with
  per-(agent, job) sessions behind it.

## 6. Iterating

Definitions are read fresh at every job start (the workspace disk is the
source of truth) — edit the files and the next run picks them up. A running
job keeps the definition it started with.

## Pitfalls

- **Secrets**: `mcp.servers.*.env` values must be *names* of host env vars.
  A literal credential in the yaml fails validation.
- **Judgment vs. guarantees**: prompts specialize judgment; they cannot
  guarantee behavior. Anything that must be mechanically enforced (amount
  limits, bulk-send protection, complex branching) belongs in an MCP server
  the definition merely connects to.
- **Tool narrowing**: `tools.builtin` can only shrink. If a job declares an
  outputs contract, it must keep at least one write tool.
- **MCP trust**: an MCP stdio server is arbitrary code execution — treat
  adding one with the same care as running a script from the same source.
