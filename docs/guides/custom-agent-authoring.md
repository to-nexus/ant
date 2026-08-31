# Authoring a Custom Agent / Job

This guide walks through defining a custom agent with one job, from empty
directory to a running chat. Concepts:
[concepts/custom-agents.md](../concepts/custom-agents.md).

## Let an agent write it for you

Ant ships **`agent-builder`**, a read-only builtin whose one job (`author`)
does what this guide describes: describe the agent you want, paste in whatever
context it should work from, and it creates or edits the definition in your
personal scope, then validates the job before reporting.

It works through the same account-agents API the settings screen uses, so
everything below still applies — the rules, the whitelist, and the validation
are identical whether a person or the agent types them. What it cannot do is
publish to your organization or grant edit access; those stay in the settings
screen. It also cannot edit builtins, itself included: ask it for your own copy
under a different id instead.

Scheduling a finished agent is the other builtin's half: **`pipeline-builder`**
composes an agent's intents into a pipeline draft (cron trigger + step chain +
approval gates) through the pipelines API. It writes drafts only — enabling and
activating a pipeline stay a person's decisions in the Pipelines tab.

Write to it in your own language: the prose it authors — `base/*.md`, intent
criteria, prompts, display names — comes back in the language you used, and an
edit keeps whatever language the file is already in. Only the structure stays
fixed: ids, yaml keys, paths, tool names, and `${secret:}` references. The same
holds when you author by hand — nothing in the definition contract requires
English.

Read on if you would rather author by hand, or want to understand what it wrote.

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

`ops-team` is not hypothetical: a runnable copy is
[`examples/custom-agents/ops-team/`](../../examples/custom-agents/ops-team/), and
the MCP server it connects to is its sibling
[`examples/mcp-reference-server/`](../../examples/mcp-reference-server/). Copy the
agent directory into your account root and start the server to follow this guide
against something that actually answers. That tree is **not** loaded by the
runtime — unlike the builtin above, it exists to be copied, which is why it may
declare `mcp.servers` at all.

### Start the reference MCP server

`examples/*` is a workspace member, so a root `pnpm install` already fetched it.
From the repository root:

```bash
pnpm build:example:mcp                              # compile src/ → dist/
MCP_AUTH_TOKEN=dev-token pnpm start:example:mcp     # POST /mcp on :8931 · GET /healthz
```

Verify it in a second terminal — the smoke script exercises `initialize`,
`tools/list`, one `tools/call`, and the 401 / 405 / 406 negatives:

```bash
MCP_AUTH_TOKEN=dev-token pnpm test:example:mcp
```

`pnpm dev:example:mcp` is the same server under `tsx watch` while you edit its
tools. The server's `.env` is optional — copy its `.env.example` and set
`MCP_AUTH_TOKEN` there for a token that persists across runs, or keep passing it
inline as above. Stdio mode (`pnpm start:example:mcp:stdio`) takes no token at
all: the spawning process is the trust boundary.

Two things that otherwise cost a debugging round:

- The `OPS_API_TOKEN` credential you register in
  [§2.5](#25-register-the-credentials-the-definition-references)
  must hold the **full `Bearer <token>` string** — `Bearer dev-token`, not
  `dev-token`. The value is used as the `Authorization` header verbatim.
- Port `8931` is the `DEFAULT_PORT` constant in the server's `src/config.ts` and
  is repeated literally in `weekly-report/job.yaml`'s `url`, because yaml has no
  interpolation. Override it with `PORT` and both must change together.

## 1. Scaffold

Use Settings → Agents (register button), or create the files by hand under
your account root `{workspaces}/{org}/{user}/.ant/agents/` — definitions are
account-owned and shared across your workspace projects:

```
.ant/agents/ops-team/
  agent.yaml
  base/role.md                 # agent prose — who this agent is (default name)
  on-demand/**.md|.json        # long docs the agent reads when it needs them (§4.6)
  jobs/weekly-report/
    job.yaml
    base/system.md             # job prose — how this job runs (default name)
    on-demand/**.md|.json      # same channel, scoped to this job
    intents/report/            # one directory per intent (§4.5)
      infer.md                 #   REQUIRED: when it applies (prose criterion + optional clarify frontmatter)
      prompt.md                #   optional: prose inlined while the intent is active
      hooks.yaml               #   optional completion contract (§4.7)
```

`role.md` / `system.md` are only the names the scaffold and the shipped
built-in use. Any number of `base/*.md` files is allowed; they are concatenated
in filename order (agent prose first, then job prose). A fresh job scaffolds
no intents — `intents/` appears when you add the first one.

Intents and tools are **job-owned** — there is no agent-level intent catalog,
and no `injections/` pool at any level (a legacy definition carrying either
fails loud with a move instruction — each intent owns its prose as its own
`prompt.md`).

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
file) or a `${secret:KEY}` reference to the encrypted per-user store — **you
declare which; nothing is inferred from the value's shape.** `${secret:…}` is
the one marker that means "look this up", so any other value is a literal, and
a *malformed* reference (`${secret:lowercase}`, an unclosed brace) fails
validation rather than being treated as one.

Reference resolution reads **only the store, never the host environment**, so a
definition cannot name-and-leak Ant's own secrets. See step 2.5 for registering
the value.

`headers` is the one authentication mechanism for `http` servers, and `env` the
one for `stdio`; each is rejected on the other transport. A stdio child receives
only its declared `env` (resolved values) plus a minimal exec baseline (`PATH`,
`HOME`, `LANG`, …) — never Ant's own environment, so a server never sees Ant's
provider keys.

That is the whole schema. There is no `description` (the persona lives in
`base/*.md` prose the model actually reads) and no agent-level `tools` —
each job declares its own. `mcp` and `apis` are the two shared fields: entries
here are unioned into every member job (a job-level entry with the same name
wins).

## 2.2 `apis` — REST APIs with no MCP server

For a legacy system that only speaks REST (an ERP, an internal service),
declare the **connection** and let the model learn the API from prose:

```yaml
apis:
  douzone:
    baseUrl: https://erp.example.com/api        # where
    headers:
      Authorization: ${secret:DOUZONE_TOKEN}     # as whom — same rule as MCP headers
    allow:                                       # optional: how far. Absent = every path.
      - GET *
      - POST /vouchers/**
```

The agent gets two generic tools per entry — `api__douzone__get` (read,
approval-free) and `api__douzone__request` (write, approval-gated; declare
`tools.approval["api__douzone__request"]: never` in job.yaml for unattended
writes, ideally together with a scoped `allow`). Auth headers are attached by
the runtime; the model never sees the secret.

Do NOT enumerate endpoints here — no per-endpoint tools, no OpenAPI import.
The API's knowledge is prose, in three layers:

1. `base/*.md` — always-injected conventions (short).
2. the intent's `prompt.md` — the task-shaped subset: the 3–8 endpoints this
   intent uses, field tables, the call sequence, one worked example. Keep it
   under the 12k inline budget — overflow demotes the whole file to a pointer.
3. `on-demand/**` (agent-level, or `jobs/{id}/on-demand/**`) — the FULL spec,
   `.md` or `.json`: drop the vendor's swagger/PDF-export in verbatim. These
   files are never injected; the runtime renders an "On-Demand Documents" index
   into the system block and the model reads what it needs via the
   `_agent-definition/` mount. Because only paths are rendered, this layer
   costs no prompt budget — which is why it, and not `prompt.md`, is where a
   large document belongs.

Authoring flow that works: paste the vendor docs into `on-demand/`, curate the
intent's `prompt.md`, write the 4-line declaration (a model can generate it
from the swagger), then register the secret — the one step a human must do.

Static-header auth only. A login-dance or request-signing API, and any write
that needs server-enforced rules (validation, idempotency, dry-run), is the
signal to write a thin MCP capability server instead — see
`examples/mcp-reference-server/`.

### `self: true` — Ant's own API

One entry form declares no URL and no credential:

```yaml
apis:
  ant:
    self: true
    allow:
      - GET /definitions/agents/**
      - PUT /definitions/agents/**
```

The runtime supplies both, so the definition works unchanged on any install and
needs nothing registered. In exchange the token it receives is pinned
server-side to `/api/definitions/agents` — it cannot reach the rest of the API, and
it is refused on `promote`, `editors`, `import`, and `files/upload` no matter
what `allow` says. Writing `self: true` next to `baseUrl` or `headers` is a
validation error: an entry is one form or the other.

## 2.5 Register the credentials the definition references

Every `${secret:KEY}` must exist in the encrypted store **before the first
run**, or the connection fails loud as `config_invalid` rather than sending an
empty credential:

```bash
curl -X PUT .../api/credentials/mcp \
  -H 'content-type: application/json' \
  -d '{"key":"OPS_API_TOKEN","value":"Bearer …"}'
```

Or use the MCP credentials panel in Settings → Agents, which is the same
endpoint. The store is per-user and AES-256-GCM encrypted; values are
**write-only** — reading the list back returns key names and timestamps, never
the values. Rotating a credential is a `PUT` with the same key: the definition
file never changes and no job restart is needed beyond the next run.

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

## 3.5 Blocking questions — the `clarify` knob

By default every custom job can ask the user **one blocking question** when it
cannot proceed (wrong-guess-expensive ambiguity), via a built-in `clarify`
tool the runtime advertises alongside the job's tools. Asking ends the turn:
the job completes normally, the question renders as an answer card in chat,
and the session resumes when the user replies — by submitting the card or
just typing. The model is instructed to prefer sensible defaults; a session
gets at most **3** questions before the tool disappears for that session.

Declare `clarify: false` to opt out — it means "**this job is intended to run
autonomous/unattended**": the agent never asks a blocking question and always
proceeds with defaults, stating its assumptions. The knob exists at three
granularities:

```yaml
# agent.yaml — default for every member job
clarify: false

# jobs/{jobId}/job.yaml — wins over the agent default
clarify: true

# jobs/{jobId}/intents/scheduled-run/infer.md — per intent (frontmatter), wins over both while active
---
clarify: false
---
Unattended scheduled generation.
```

Precedence: the active intent's knob decides when it declares one; otherwise
`job.clarify`, otherwise `agent.clarify`, otherwise enabled. The value must
be a real boolean — `clarify: "yes"` fails validation at job accept. An
intent is *active* only when pinned with `@intent:` (or the execute body's
`intents`) — there is no catalog default, so an unattended lane pins its
intent in the scheduled/API call (§4.5).

## 4. Prose — base/ and per-intent prompt.md

- `base/*.md` is **always injected**, agent files first, then job files,
  filename order. Keep it under ~8,000 characters combined — overflow is
  truncated with a visible footer. Put the identity and the procedure here.
- `intents/{id}/prompt.md` is **situational**: inlined in full while its
  intent is active, otherwise offered as a `read_file` pointer off the
  read-only definition mount. No size cap. Put report templates, long
  checklists, and rare-case playbooks here — the sibling `infer.md` says when
  they apply.

Prose is inert — it is never template-compiled, and it cannot override the
runtime's safety or output rules (the harness states this explicitly).

## 4.5 Intents — infer.md (when) + prompt.md (what)

Each intent is a directory under `jobs/{jobId}/intents/` declaring one
situation. The directory name IS the intent id (kebab-case; `general` is
reserved) — no file declares it, so renaming an intent is renaming its
directory:

```markdown
<!-- jobs/{jobId}/intents/incident/infer.md -->
---
# comments in this fence are the authoring-guidance channel — they never
# reach the prompt. One optional key is allowed:
clarify: false
---
Reporting, investigating, or following up on a service incident.
```

The body below the fence is the **inference criterion** — required, ≤1000
chars, rendered verbatim into the agent's Intent Catalog on every turn. Write
it as a trigger condition ("when does this apply"), not as a summary. The
optional sibling `prompt.md` carries the situation's instructions; the
optional `hooks.yaml` (§4.7) its completion contract. Anything else in the
intent directory fails loud (a typo'd `hook.yaml` must not silently disarm a
contract), as do the retired shapes: a per-intent `intent.yaml`, a job-level
`injections/` directory (even empty), a single-file `jobs/{jobId}/
intents.yaml`, and the retired frontmatter keys (`default`, `injections`,
`description`, `id`, `hooks` — each error names the replacement). The catalog
renders in directory-name order.

- **Intents are selected explicitly — never auto-classified, and there is no
  default.** A run binds **at most one** intent: the one the user mentioned
  with `@intent:` in the composer (or that an API caller passed in the
  execute body — more than one distinct id is refused at accept,
  `multiple-intents`). The active intent's `prompt.md` is inlined in full,
  its `clarify` knob applies, and its hooks arm. There is no per-turn LLM
  classification pass. The intent is the atomic unit of work — chain steps
  are separate runs, not co-pinned intents.
- **An unpinned turn runs as the reserved `general` intent**: nothing inlines
  and no hook arms, but the model self-selects with `read_file` — the runtime
  renders your whole catalog (each intent's id and `infer.md` criterion,
  verbatim, plus its prompt pointer) into the prompt as an *Intent Catalog*.
  A lane that must run under an intent every time (a scheduled report, an
  unattended duty) pins it in the call.
- The shipped `assistant` agent's catalog
  (`packages/ant-cli/src/core/data/agents/assistant/jobs/chat/intents/`)
  is the working example.

## 4.6 Plan turns — `@plan` in the composer

Planning is not a job setting; it is a **per-turn user decision**, orthogonal
to intents. Mention `@plan` in the composer (any custom job accepts it) and
that run produces or updates a plan document instead of doing the work: the
runtime confines file writes to `plan/` and rejects execution tools
(`run_command`, `http_request`, mutating MCP) for the turn. Review the plan,
then send a normal turn to execute it.

## 4.7 Hooks — the turn-completion contract

An intent may declare hooks in the optional `hooks.yaml` next to its
`infer.md`. Every entry must hold when the turn stops (the `stop` event,
AND) — verified by the runtime from actual tool results, never from the
model's claims. Unmet hooks re-prompt the agent a bounded number of times,
then pause the job resumably.

```yaml
# jobs/{jobId}/intents/incident/hooks.yaml
hooks:
  stop:
    - artifact: reports/*-incident.md      # a real file write this turn must match this glob
    - action: mcp__ops-api__create_incident # this tool must have been successfully called
```

- `artifact` globs address the job's artifact root: `*` matches within one
  path segment, `**` matches any depth (whole segment only). `sessions/` is
  reserved and refused.
- `action` names a tool from this job's `tools.builtin` or a full
  `mcp__{server}__{tool}` whose server is declared on the job or agent —
  otherwise the definition fails to load (the hook could never be met).
- Deleting `hooks.yaml` (or emptying the list in the settings UI) removes the
  contract; a job without hooks simply ends the turn when the agent stops.
  Hooks arm only on pinned/inherited turns — unpinned (`general`) turns are
  never gated.

## 5. Validate and run

- `GET /api/projects/{id}/custom-agents/{agentId}/jobs/{jobId}/validate`
  runs the loader's full validation (broken YAML, id mismatches, unknown
  tools, removed legacy fields, malformed `${secret:…}` references, a
  `headers` block on a stdio server or `env` on an http one).
- `GET /api/definitions/agents/{agentId}/jobs/{jobId}/prompt-preview?intents=a,b`
  returns the exact composed definition block the runtime will inject — the
  settings screen's "Composed prompt" card renders it per intent selection.
  (The preview is an authoring aid and accepts several ids to compare
  blocks; an actual run still binds at most one intent.)
- A broken definition also fails loudly with HTTP 400 when a job is started —
  never silently inside the worker.
- In the UI: open a workspace project and pick the agent and job with the
  chat composer's chips, then chat — one conversation per workspace, with
  per-(agent, job) sessions behind it.

To exercise this against a real MCP server rather than a definition of your
own, copy `examples/custom-agents/ops-team/` into your account root and start
its server ([§0](#start-the-reference-mcp-server)). Its `weekly-report` job
declares the connection; its `chat` job deliberately does not, so that one keeps
working with the server down — the pair is what an MCP failure looks like from
both sides.

## 5.5 What you get without declaring it

Two surfaces are harness behavior — there is nothing to configure, and nothing
you write can turn them on or off:

- **The checklist board.** When a turn's work decomposes into two or more
  independent deliverables, the agent writes its own checklist and the
  workspace's board renders it, updating as items move. Single-deliverable and
  answer-only turns leave the board empty on purpose. Checklist items are not
  tasks — no queue, no cards, no per-task billing.
- **The write manifest.** When a turn writes files, the reply announces the
  files that were *actually* written, taken from tool side-effects rather than
  from anything the model said it did. Chat-only turns are normal and announce
  nothing.

## 6. Iterating

Definitions are read fresh at every job start (the workspace disk is the
source of truth) — edit the files and the next run picks them up. A running
job keeps the definition it started with.

## 7. Put it on a schedule

Once a job earns its keep, it shouldn't need a human to remember to start it. A
**pipeline** is one more yaml file: a cron trigger plus a list of steps, where a
step is either one of the jobs you just wrote or a gate that waits for a person.
Chaining is cross-agent, so a report job and an escalation job can be two steps
of the same run.

`examples/pipelines/weekly-ops.yaml` drives the `ops-team` example agent this
way. The model — definitions vs. activations, the availability state machine, and
what a gate does while it waits — is in
[concepts/pipelines.md](../concepts/pipelines.md).

## Migrating a pre-job-only definition

Older definitions carried agent-level catalogs and extra yaml fields. Each
now fails loud with the fix in the message:

| Legacy | Fix |
|---|---|
| `{agent}/intents.yaml` | split into `jobs/{jobId}/intents/{intentId}/infer.md` (+ `prompt.md`, `hooks.yaml`) |
| `jobs/{jobId}/intents.yaml` | split into `jobs/{jobId}/intents/{intentId}/infer.md` (+ `prompt.md`, `hooks.yaml`) |
| `intents/{id}/intent.yaml` | `description` → the `infer.md` body; `clarify` → its frontmatter; `injections` → the intent's own `prompt.md`; `default` → removed (pin explicitly) |
| `{agent}/injections/*.md`, `jobs/{jobId}/injections/*.md` | move each file into the intent that used it, as `intents/{id}/prompt.md`; delete the directory |
| `{agent}/reference/**`, `jobs/{jobId}/reference/**` | renamed to `on-demand/**` — same channel (paths rendered, bodies read on demand); rename the directory |
| `agent.yaml: tools` | declare in `jobs/{jobId}/job.yaml` |
| `agent.yaml: description` | fold into `base/*.md` prose |
| `job.yaml: description` | fold into the job's `base/*.md` prose |
| `job.yaml: outputs` | describe conventions in the job's `base/*.md` |
| `job.yaml: plan` | delete — use the composer's `@plan` per turn |
| `workspace` / `models` (either file) | delete — they never had a runtime effect |

The settings Prompts view can read, re-save, and delete the files in place.

## Pitfalls

- **Secrets**: put a secret in `mcp.servers.*.env` / `headers` only as a
  `${secret:KEY}` reference. A plain-text value is stored **verbatim in the
  yaml**, and nothing warns you about it — the runtime cannot tell a token from
  a workspace id, which is exactly why the marker is explicit. Plain text is
  for non-sensitive values only (see step 2.5 for registering the rest).
- **Judgment vs. guarantees**: prompts specialize judgment; they cannot
  guarantee behavior. Anything that must be mechanically enforced (amount
  limits, bulk-send protection, complex branching) belongs in an MCP server
  the definition merely connects to.
- **Tool allowlist**: `tools.builtin` can only pick from the universal
  preset — MCP is the only way to add capability.
- **MCP trust**: an MCP stdio server is arbitrary code execution — treat
  adding one with the same care as running a script from the same source.
