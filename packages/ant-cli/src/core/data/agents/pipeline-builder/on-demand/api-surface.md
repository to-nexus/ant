# Pipelines API

Every call goes through the declared connection: `api__ant__get` for reads,
`api__ant__request` for writes. Paths below are relative to the connection's
base — pass them exactly as written, starting with `/`.

## Authoring order

1. `GET /definitions/pipelines` — see what exists; ids are taken across scopes.
2. `GET /definitions/agents` (plus per-agent file reads) — confirm every
   step's agent, job, and intent before designing.
3. `POST /definitions/pipelines` or `PUT /definitions/pipelines/{id}` — save
   the whole definition.
4. `POST /definitions/pipelines/preview-fires` — check the trigger. Do this
   before reporting success; it also works before saving, as a design check.

## Reads

| Call | Returns |
|---|---|
| `GET /definitions/pipelines` | `{ pipelines[], invalid[], orphanActivations[], caps }` — every pipeline this user can see, each with `scope`, per-caller `readonly`, `enabled`, and activation rows |
| `GET /definitions/pipelines/{id}` | `{ id, def, scope, readonly, enabled, org?, activations }` — `def` is the full definition to edit |
| `GET /definitions/pipelines/{id}/permissions` | who owns and may edit an organization pipeline |
| `GET /definitions/pipelines/activatable-projects` | `{ projects: [{ id, name, activePipelineId }] }` — where a person could activate the draft |
| `GET /definitions/agents` | every agent this user can see, with its jobs and their intents |
| `GET /definitions/agents/{agentId}/files`, `…/file?path=…` | an agent's definition tree and one file's content — where the operating-context sections live |

## Writes

| Call | Body | Effect |
|---|---|---|
| `POST /definitions/pipelines` | `{ id?, def }` | new pipeline in the personal scope, saved as a **disabled draft**; `id` defaults to a slug of `def.name` |
| `PUT /definitions/pipelines/{id}` | `{ def }` | **replaces the whole definition** — fetch first, edit, send everything back |
| `DELETE /definitions/pipelines/{id}` | — | removes the definition; refused while enabled |

Both saves answer `{ id, entry }` on success (201 for POST, 200 for PUT).
There is no partial update and no file interface — the definition is one JSON
object in `def`, shaped exactly as `on-demand/pipeline-format.md` describes.

## Trigger preview

`POST /definitions/pipelines/preview-fires` with `{ cron, tz? }` answers
`{ ok, error?, fires: [...] }` — the next five fire times as ISO timestamps.
`ok: false` means the expression is malformed OR its fires violate the
five-minute minimum interval; `error` says which. This is the only cron
authority — never compute fire times yourself.

## Failures

| Response | Meaning | What to do |
|---|---|---|
| `400` code `invalid-pipeline-def` | the definition breaks a rule | read the FULL `errors[]`, fix every named rule, save again |
| `400` code `invalid-pipeline-id` | id is not `[a-z0-9][a-z0-9-]*` | propose a valid id |
| `400` code `cap-exceeded` | account pipeline cap reached | tell the user; deleting old drafts is their call |
| `409` code `pipeline-exists` | id taken, in any scope | propose another id |
| `409` code `pipeline-enabled` | published definitions are immutable | a person disables it in the Pipelines tab first; stop and say so |
| `403` code `org-pipeline-forbidden` | org pipeline this user cannot edit | say so; offer a personal-scope copy under a new id |
| `403` code `self-api-scope` | an operational route | that action is a person's decision in the Pipelines tab |

## Routes you will not reach

`enable`, `disable`, `activate`, `deactivate`, `run-now`, `promote`,
`editors`, `approvals`, `runs`, and `download` refuse this job's token.
Publishing a draft, binding it to a project, firing a run, sharing, and
resolving approvals are a person's decisions in the Pipelines tab. Run history
is readable there, and — for a pipeline bound to this project — under the
read-only `pipeline-runs/` node of the artifacts tree.
