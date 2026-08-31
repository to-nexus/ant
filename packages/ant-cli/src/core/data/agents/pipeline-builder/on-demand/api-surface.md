# Pipelines API

Every call goes through the declared connection: `api__ant__get` for reads,
`api__ant__request` for writes. Paths below are relative to the connection's
base — pass them exactly as written, starting with `/`.

## Authoring order

A pipeline is one document. There is no structural scaffold to create first and
no per-field patch: you compose the whole definition and save it in one call.

1. `GET /definitions/pipelines` — see what exists, so the id is free and an edit targets
   the right one.
2. `GET /definitions/agents` and `GET /definitions/agents/{agentId}/files` — resolve
   every step's agent, job and intent before composing.
3. `POST /definitions/pipelines` (create) or `PUT /definitions/pipelines/{pipelineId}` (replace).
4. `POST /definitions/pipelines/preview-fires` — read the next firings back. Do this before
   reporting success.

## Reads

| Call | Returns |
|---|---|
| `GET /definitions/pipelines` | every pipeline this user can see: `id`, `def`, `scope`, `enabled`, per-caller `readonly`, `activations[]`, server-computed `nextFireAt` |
| `GET /definitions/pipelines/{pipelineId}` | one definition |
| `GET /definitions/pipelines/{pipelineId}/permissions` | who owns and may edit an organization pipeline |
| `GET /definitions/pipelines/activatable-projects` | the projects a person could activate a pipeline on |
| `GET /definitions/agents` | every agent this user can see |
| `GET /definitions/agents/{agentId}/files` | that agent's definition file tree |
| `GET /definitions/agents/{agentId}/file?path=…` | one file's content — how you read a job's `job.yaml` or an intent's `infer.md` |

`nextFireAt` is computed by the server. Never parse a cron expression yourself
and never present a firing time you did not get from the server.

## Writes

| Call | Body | Effect |
|---|---|---|
| `POST /definitions/pipelines` | `{ id, def }` | new pipeline in the personal scope, **always created disabled** |
| `PUT /definitions/pipelines/{pipelineId}` | `{ def }` | replace the whole definition |
| `DELETE /definitions/pipelines/{pipelineId}` | — | remove the pipeline |
| `POST /definitions/pipelines/preview-fires` | `{ cron, tz? }` | `{ ok, error?, fires[] }` — the only way to check a schedule |

`PUT` replaces. There is no field-level update: send the entire definition
every time, carrying over everything you are not changing.

## Routes you will not reach

These answer `403` to this job's token whatever the connection's `allow` list
says. They are not obstacles to route around — each one is a decision that
belongs to a person or a surface that is not yours.

| Refused | Why |
|---|---|
| `enable` / `disable` | publishing a draft, and reclaiming it for editing |
| `activate` / `deactivate` | binding a pipeline to a project. An activation takes the project over: while it holds, every interactive job start there is rejected |
| `run-now` | firing a run outside the schedule, on the activator's credits |
| `promote` / `editors` | sharing with the organization, and granting edit access |
| `approvals` and `approvals/{gateId}` | answering a gate. A pipeline that approves its own gates has no gate |
| `runs/**` | run history and cancellation — operating a pipeline, not authoring one |
| `download` | bulk export; `GET /definitions/pipelines/{pipelineId}` already carries the definition |

Everything outside `/definitions/pipelines` and `/definitions/agents` is refused too. Agent
definitions are readable and **not writable** from here — authoring an agent is
the agent builder's job.

## Reading a response

`POST` answers `201` with `{ id, entry }`. `PUT` answers `200`.

A `4xx` carries the reason in its body; read it, it names the rule.

| Status | Meaning |
|---|---|
| `400` | the definition is invalid, or the id is malformed. `body.errors[]` lists every rule broken — fix them all before saving again |
| `403` | an organization pipeline this user cannot edit, or one of the refused routes above |
| `404` | no such pipeline |
| `409` | `pipeline-exists` (id taken, possibly by an org pipeline) · `pipeline-enabled` (disable it first — a person does that) · `pipeline-has-activations` (holders must deactivate themselves) · `cap-exceeded` |
