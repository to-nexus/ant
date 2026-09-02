# Definition file contract

An agent is a directory of files. This is every path the API accepts and every
rule the loader enforces on them.

## Layout

```
{agentId}/
  agent.yaml                              identity
  base/*.md                               agent prose — always injected
  on-demand/**.md | **.json               read on demand, any depth
  jobs/{jobId}/
    job.yaml                              tools, approvals, connections
    base/*.md                             job prose — always injected
    on-demand/**.md | **.json             read on demand
    intents/{intentId}/
      infer.md                            required — the intent exists once this is saved
      prompt.md                           optional — inlined while the intent is active
      hooks.yaml                          optional — completion contract
```

Nothing else is writable. Intents live under a job, never under the agent.

## Ids

`[a-z0-9][a-z0-9-]*`, and an id must equal its directory name — `id:` inside
`agent.yaml` and `job.yaml` is checked against the path. `general` is reserved
and cannot be an intent id. At most 32 intents per job.

## agent.yaml

```yaml
id: my-agent
name: 'My Agent'
version: 1
```

`description`, `tools`, `workspace`, `models`, and agent-level intents are not
agent-level keys — they were moved to the job and are rejected with a message
saying so.

## job.yaml

```yaml
id: my-job
name: 'My Job'
version: 1
tools:
  builtin:            # allowlist; omit to grant the full preset
    - read_file
    - create_file
  approval:           # 'always' | 'never'
    run_command: never
clarify: true         # false = never ask blocking questions
```

`tools.builtin` **narrows only** — a name outside the universal preset is
rejected. Extra capability comes from a declared connection, never from adding
a tool name. The preset is closed; these are all of it:

| | |
|---|---|
| read | `read_file` `list_files` `search_files` |
| write | `create_file` `edit_file` `append_file` `delete_file` `mkdir` `copy_file` |
| web | `fetch_url` `search_web` |
| external call | `http_request` |
| command | `run_command` |
| subagent | `explore` `subagent_report` |
| state | `read_state` |
| Ant source (read-only) | `read_ant_source` `list_ant_files` `search_ant_code` |

`clarify` is not on that list. It is a knob, not a tool — the job-level key
shown above and the intent frontmatter key. Putting it in `tools.builtin` stops
the job from loading.

Approval defaults to `always` for tools that mutate outside the artifact
sandbox (`run_command`, `http_request`, and writes through a declared
connection) and to `never` for everything else. A gated call is refused, not
queued, so a job meant to run unattended must declare `never` for what it uses.

`clarify` resolves active intent → job → agent → `true`.

## Connections

Two declaration channels, usable at agent or job level (job wins on a name
collision):

```yaml
mcp:
  servers:
    my-server:
      transport: http
      url: https://example.com/mcp
      headers:
        Authorization: ${secret:MY_TOKEN}
apis:
  my-api:
    baseUrl: https://example.com/api
    headers:
      Authorization: ${secret:MY_TOKEN}
    allow:
      - GET *
      - POST /things/**
```

`${secret:KEY}` is the only credential form; the value comes from the user's
registered credentials and never enters a prompt. A literal secret in a
definition is a leak — always use the reference, and tell the user to register
the key in settings before running the job.

An `apis` entry synthesizes two tools: `api__{name}__get` (GET/HEAD) and
`api__{name}__request` (writes). `allow` lines are `METHOD PATTERN`, where
`PATTERN` is `*` or a `/`-rooted path whose segments may be `*` (one segment)
or `**` (any suffix).

### An `apis` entry that targets this Ant server

The block above is the external form. An entry that calls **this Ant server**
takes the other, mutually exclusive form:

```yaml
apis:
  ant:
    self: true          # no baseUrl, no headers — declaring either is rejected
    allow:
      - GET /definitions/agents/**
      - PUT /definitions/agents/**
```

The runtime resolves the origin and attaches the job's own token, so this form
needs no registered credential — and it is the only form that reaches this
server, because the runtime issues no credential an external entry could carry
in its `Authorization` header.

Its base is the server's `/api` mount, so `allow` patterns are written **without
that prefix** — `/definitions/agents/**`, not `/api/definitions/agents/**`.

**The token reaches two surfaces and nothing else.** Every other path is `403`.
That bound lives on the server; `allow` only narrows what the running agent is
told it may call, so widening `allow` grants nothing.

- `/definitions/agents` — agent definitions. `promote`, `editors`, `import`, and
  `files/upload` are refused inside it.
- `/definitions/pipelines` — pipeline definitions ONLY: list, create, read, replace,
  delete, `preview-fires`, and the activatable-project list. Enabling,
  activating, running, sharing, and approving a pipeline are refused; a person
  decides those in the Pipelines tab. A job that authors pipelines declares
  this surface and reads its route table from that agent's own on-demand
  reference — do not infer the route shapes from this paragraph.

An agent that must drive any other part of this server — projects, billing,
auth — cannot get there through this channel, and saying so is the honest
answer rather than declaring the connection anyway.

## Prose

`base/*.md` files are concatenated in filename order and injected on every
turn. Agent and job prose share an 8000-character budget; past it the text is
truncated with a visible footer, so keep standing instructions tight. Long
material has two homes by kind: a task's full procedure goes in that intent's
`prompt.md` — no size limit, inlined only while the intent is active — and
lookup reference the agent opens itself goes in `on-demand/`.

`on-demand/` files are not injected. They are offered to the agent as paths it
can read when it needs them — the home for lookup material consulted while
working: a schema, a rate table, a full API spec. Material that defines the
work itself belongs in the intent's `prompt.md` and the job's prose, never
here.

Prose has no required language: the `base/*.md` bodies, `infer.md`, `prompt.md`,
`name:` values, and comments may be written in whatever language the definition's
owner reads. Structural tokens are not prose and are never localized — ids, yaml
keys, paths under the whitelist, tool names in `tools.builtin` / `approval` /
`hooks.yaml`, and `${secret:KEY}` names stay exactly as this contract defines
them. Note that the 8000-character prose budget is counted in characters, not
tokens.

## Intents

`infer.md` is a trigger criterion, at most 1000 characters, written as a
condition rather than a summary. A calendar is not a condition — "runs
monthly" describes a schedule, which belongs to pipeline authoring outside
the agent definition, never to `infer.md`. Its frontmatter accepts two
optional keys — `clarify: <bool>` and `outcomes: [..]`; `default`,
`injections`, `description`, `id`, and `hooks` are rejected.

`outcomes` (2–5 kebab-case ids, e.g. `outcomes: [ok, anomaly, needs-review]`)
declares the intent's DECISION vocabulary: a turn under this intent must end
its final reply with exactly one `<verdict>one-of-these</verdict>`, the
runtime seals the parsed verdict, and pipeline `on: verdict:<name>` edges
route on it. Declare it on JUDGMENT intents — ones whose job is to look at
evidence and reach a named conclusion — and make `prompt.md` state what each
outcome means and what evidence supports it. The vocabulary lives here, on
the intent, because the business knowledge lives here; pipelines only
reference it.

`prompt.md` has no size limit and is inlined only while its intent is active —
it is where a task's procedure lives; `infer.md` only decides when it applies,
and `prompt.md` never restates that condition.

`hooks.yaml` declares what must be true for a turn to be complete. The file
must declare exactly one top-level `hooks` key; the events nest under it:

```yaml
hooks:
  stop:
    - artifact: reports/*.md          # a file matching this glob was written
    - action: api__my-api__request    # this tool was called successfully
```

Approval posture: a tool declared `tools.approval: always` is refused
fail-closed in interactive runs, but under a PIPELINE the run pauses and a
person approves or rejects the exact call from the pipeline inbox — so an
intent whose risky write should be human-signed per call may keep
`approval: always` and still run scheduled. Declare `approval: never` only
for writes that are safe fully unattended.

Each entry carries exactly one of `artifact` or `action`. An `action` must name
a tool the job actually has — a builtin in its allowlist, or a tool from a
connection it declares — or the job will not load.

`artifact:` globs resolve against the job's artifact root — `*` matches within
one path segment, `**` matches any depth; `sessions/` is reserved and refused.
Entries are conjunctive (all must be met, at most 8 per intent), so one
contract can require both a working file and a system call. Artifact evidence
comes only from the file tools (`create_file`, `edit_file`, `append_file`,
`copy_file`): a file produced by `run_command`, and a large tool result the
runtime spooled to disk, satisfy no `artifact:` hook — hold such an intent to
an `action:` instead. A write into an external system is declared as its tool:
`action: api__{name}__request` or `action: mcp__{server}__{tool}`.

An intent's stop globs are its output contract: pipeline authoring pins
exactly these globs as a downstream step's context, so keep them stable and
specific. The plane's file tools are text-only — `read_file` refuses binary
and `create_file` cannot author it — so an artifact another intent or step
will consume must be a text format. The one non-text input is a supported
image (PNG / JPEG / WebP / GIF): attached as context, it reaches the model
as a visual input rather than through `read_file`.

A hook is for observable completion. When an intent's "done" is evidence the
runtime can see — a produced file, a successful call — declare it here rather
than leaving it as prose alone; when done is a judgment only a reader can
make, there is nothing to declare and the contract stays in `prompt.md`.

## Scopes

`user` is the personal scope and is writable. `org` is writable only with the
organization's grant. `builtin` is read-only, always. Ids are unique across all
three: creating an agent under a name a built-in already holds is refused.
