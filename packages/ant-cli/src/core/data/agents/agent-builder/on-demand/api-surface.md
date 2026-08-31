# Account-agents API

Every call goes through the declared connection: `api__ant__get` for reads,
`api__ant__request` for writes. Paths below are relative to the connection's
base — pass them exactly as written, starting with `/`.

## Authoring order

Structure is created by its own endpoints; content is saved file by file.

1. `POST /definitions/agents` — create the agent.
2. `POST /definitions/agents/{agentId}/jobs` — create a job under it.
3. `PUT /definitions/agents/{agentId}/file` — save each definition file, including
   the ones that bring an intent into existence.
4. `GET /definitions/agents/{agentId}/jobs/{jobId}/validate` — confirm the job
   loads. Do this before reporting success.

## Reads

| Call | Returns |
|---|---|
| `GET /definitions/agents` | every agent this user can see, with scope and whether it is editable |
| `GET /definitions/agents/{agentId}/files` | the definition file tree |
| `GET /definitions/agents/{agentId}/file?path=…` | one file's content |
| `GET /definitions/agents/{agentId}/jobs/{jobId}/validate` | `{ valid, errors[] }` |
| `GET /definitions/agents/{agentId}/jobs/{jobId}/prompt-preview` | the composed system block; add `?intents=a,b` to see it with intents active |
| `GET /definitions/agents/{agentId}/permissions` | who owns and may edit an organization agent |

## Writes

| Call | Body | Effect |
|---|---|---|
| `POST /definitions/agents` | `{ id, name }` | new agent in the personal scope |
| `PATCH /definitions/agents/{agentId}` | `{ name }` | rename the display name |
| `POST /definitions/agents/{agentId}/rename` | `{ id }` | change the id (moves the directory) |
| `DELETE /definitions/agents/{agentId}` | — | remove the agent and everything under it |
| `POST /definitions/agents/{agentId}/jobs` | `{ id, name }` | new job, scaffolded with `job.yaml` and `base/system.md` |
| `PATCH /definitions/agents/{agentId}/jobs/{jobId}` | `{ name }` | rename the display name |
| `POST /definitions/agents/{agentId}/jobs/{jobId}/rename` | `{ id }` | change the job id |
| `DELETE /definitions/agents/{agentId}/jobs/{jobId}` | — | remove the job |
| `PUT /definitions/agents/{agentId}/file` | `{ path, content }` | **the write you will use most** — creates or replaces one definition file, validated on the way in |
| `POST /definitions/agents/{agentId}/files/create` | `{ path }` | empty file at a whitelisted path |
| `POST /definitions/agents/{agentId}/files/mkdir` | `{ path }` | directory (not for job or intent directories — those are born from their own creating call) |
| `POST /definitions/agents/{agentId}/files/rename` | `{ path, newName }` | rename a file, or an intent directory |
| `DELETE /definitions/agents/{agentId}/file?path=…` | — | remove a file; structural files are refused |

Intents have no endpoints of their own. An intent exists once
`jobs/{jobId}/intents/{intentId}/infer.md` is saved, and is renamed by renaming
its directory.

`on-demand/**` takes the same `PUT /file` — any depth, `.md` or `.json`, at the
agent or the job level. The endpoint accepts whatever you save; what belongs
there is an authoring decision, made before you reach for it.

## Routes you will not reach

`promote`, `editors`, `import`, and `files/upload` refuse this job's token.
The first two are a person's decision in agent settings. The last two write
definition files without validating them, and everything you author must go
through the validated route.

## Reading a response

`PUT /file` answers `200` with `{ valid, errors[] }` for the job the file
belongs to. `valid: false` means the file saved but the job does not load —
finish the remaining writes, then fix what the errors name.

A `4xx` carries the reason in its body. Read it; it names the rule.
