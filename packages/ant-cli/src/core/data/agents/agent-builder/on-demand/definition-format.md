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
a tool name.

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

## Prose

`base/*.md` files are concatenated in filename order and injected on every
turn. Agent and job prose share an 8000-character budget; past it the text is
truncated with a visible footer, so keep standing instructions tight and put
anything long in `on-demand/`.

`on-demand/` files are not injected. They are offered to the agent as paths it
can read when it needs them — the right home for a full API spec, a schema, or
a vendor document.

Prose has no required language: the `base/*.md` bodies, `infer.md`, `prompt.md`,
`name:` values, and comments may be written in whatever language the definition's
owner reads. Structural tokens are not prose and are never localized — ids, yaml
keys, paths under the whitelist, tool names in `tools.builtin` / `approval` /
`hooks.yaml`, and `${secret:KEY}` names stay exactly as this contract defines
them. Note that the 8000-character prose budget is counted in characters, not
tokens.

## Intents

`infer.md` is a trigger criterion, at most 1000 characters, written as a
condition rather than a summary. Its frontmatter accepts exactly one optional
key, `clarify: <bool>`; `default`, `injections`, `description`, `id`, and
`hooks` are rejected.

`prompt.md` has no size limit and is inlined only while its intent is active.

`hooks.yaml` declares what must be true for a turn to be complete:

```yaml
stop:
  - artifact: reports/*.md          # a file matching this glob was written
  - action: api__my-api__request    # this tool was called successfully
```

Each entry carries exactly one of `artifact` or `action`. An `action` must name
a tool the job actually has — a builtin in its allowlist, or a tool from a
connection it declares — or the job will not load.

## Scopes

`user` is the personal scope and is writable. `org` is writable only with the
organization's grant. `builtin` is read-only, always. Ids are unique across all
three: creating an agent under a name a built-in already holds is refused.
