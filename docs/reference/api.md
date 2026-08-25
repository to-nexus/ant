# API reference

`ant-api` exposes a REST surface used by the frontend and any external
integrations. The surface is intentionally small; most "agent work"
flows through job enqueue + SSE for results, not REST polling.

For routing internals, see
[`packages/ant-cli/src/periphery/adapters/http/express/config/RouteConfigurator.ts`](../../packages/ant-cli/src/periphery/adapters/http/express/config/RouteConfigurator.ts).

## Authentication

| Mode    | Mechanism                                   |
|---------|---------------------------------------------|
| Local   | Single tenant `local:local`, no auth header |
| Cloud   | OAuth → JWT bearer in `Authorization:` header |

In cloud mode, every endpoint outside `/health` requires a valid token.

## Endpoint groups

| Group              | Base path           | Purpose                                    |
|--------------------|---------------------|--------------------------------------------|
| Health             | `/health`           | Liveness + dependency probes               |
| Projects           | `/api/projects`     | CRUD on projects                           |
| Features           | `/api/features`     | CRUD on features (nested under project)    |
| Jobs               | `/api/jobs`         | Enqueue, status, cancel                    |
| Files              | `/api/files`        | Read/write workspace files (scoped)        |
| Cloud IDE          | `/api/cloud-ide`    | Launch / proxy IDE pods (cloud only)       |
| Preview            | `/api/preview`      | Lifecycle ops on preview servers           |
| Git                | `/api/git`          | Per-feature git operations                 |
| Figma              | `/api/figma`        | Figma MCP bridge endpoints (cloud)         |
| Account agents     | `/api/account/agents` | Custom agent/job definitions (account-scoped) |
| MCP credentials    | `/api/account/mcp-credentials` | Encrypted credential store (write-only values) |
| Custom agents      | `/api/projects/:id/custom-agents` | Per-project discovery + workspace artifacts |
| Pipelines          | `/api/pipelines`    | Scheduled custom-job chains (account-scoped) |

## Health

| Verb | Path        | Returns                                   |
|------|-------------|-------------------------------------------|
| GET  | `/health`    | `{ status, redis, llm }` quick check     |

## Projects

| Verb | Path                        | Notes                                          |
|------|-----------------------------|------------------------------------------------|
| POST | `/api/projects`             | Create. Returns 409 with `canForceCleanup`     |
|      |                             | if leftover files block creation.              |
| GET  | `/api/projects`             | List for current tenant.                       |
| GET  | `/api/projects/:id`         | Read.                                          |
| PATCH| `/api/projects/:id`         | Rename. Triggers cascade per AGENTS.md.        |
| DELETE | `/api/projects/:id`       | Delete. 5-step cascade (jobs → IDE → preview → state → fs). |
| DELETE | `/api/projects/:id?force=true` | Force-cleanup leftovers from a 409.       |

## Features

| Verb | Path                                    | Notes                                |
|------|-----------------------------------------|--------------------------------------|
| POST | `/api/projects/:id/features`            | Create.                              |
| GET  | `/api/projects/:id/features`            | List.                                |
| GET  | `/api/projects/:id/features/:featureId` | Read.                                |
| DELETE | `/api/projects/:id/features/:featureId` | Delete.                            |

## Jobs

| Verb | Path                           | Notes                                     |
|------|--------------------------------|-------------------------------------------|
| POST | `/api/jobs`                    | Enqueue. Body: `{ jobType, featureId, directive, ... }`. |
| GET  | `/api/jobs/:id`                | Status snapshot.                          |
| POST | `/api/jobs/:id/cancel`         | User-stop. Sets `USER_STOPPED` flag.      |

Job status is **also** broadcast on the realtime SSE channel — prefer
SSE for client UIs over polling.

## Files

The file API is scoped to the feature's workspace path. It refuses paths
outside the current workspace.

| Verb | Path                                        | Notes                              |
|------|---------------------------------------------|------------------------------------|
| GET  | `/api/files?featureId=...&path=...`         | Read.                              |
| GET  | `/api/files/list?featureId=...&path=...`    | List.                              |
| POST | `/api/files?featureId=...`                  | Write. Body is the file contents.  |

## Cloud IDE

Available only when `ANT_K8S_NAMESPACE` is set.

| Verb | Path                                                | Notes                          |
|------|-----------------------------------------------------|--------------------------------|
| POST | `/api/cloud-ide/start`                              | Launch a pod for the user/project. |
| GET  | `/api/cloud-ide/status?projectId=...`               | Pod state.                      |
| POST | `/api/cloud-ide/stop`                               | Terminate.                      |
| ANY  | `/api/cloud-ide/proxy/*`                            | Reverse-proxy to the pod.       |

See [internals/23-cloud-ide.md](../internals/23-cloud-ide.md).

## Preview

The preview server (`ant-preview`) handles per-feature dev servers. The
control plane goes through `ant-api`.

| Verb | Path                              | Notes                                 |
|------|-----------------------------------|---------------------------------------|
| POST | `/api/preview/start`              | Launch a dev server.                  |
| GET  | `/api/preview/status`             | Returns the active server map.        |
| POST | `/api/preview/stop`               | Stop a feature's dev server.          |

## Custom agents (universal runtime)

> ⚠️ **Experimental** — see
> [concepts/custom-agents.md](../concepts/custom-agents.md). These routes exist
> only for the workspace project kind (`projectType: 'universal'`).

Definitions are **account-owned, not project-owned**, so CRUD lives under
`/api/account/agents` and works with no project selected. Writes always target
the user scope; org and builtin scopes are read-only.

| Verb | Path | Notes |
|------|------|-------|
| GET  | `/api/account/agents` | List agents + their jobs, with `scope` and `readonly`. |
| POST | `/api/account/agents` | Scaffold an agent. **409** if the id is owned by *any* scope, builtin included. |
| DELETE | `/api/account/agents/:agentId` | Delete (user scope only). |
| POST | `/api/account/agents/:agentId/rename` | Rename, moving container data across every universal project of the account (dry-run, then move; refuses on any conflict). |
| POST | `/api/account/agents/:agentId/jobs` | Scaffold a job. |
| POST | `/api/account/agents/:agentId/jobs/:jobId/rename` | Rename a job, same move contract. |
| GET  | `/api/account/agents/:agentId/jobs/:jobId/validate` | Run the loader's full validation without starting a job. |
| GET  | `/api/account/agents/:agentId/jobs/:jobId/prompt-preview?intents=a,b` | The exact definition block the runtime would inject for that intent selection. |
| GET/PUT/POST/DELETE | `/api/account/agents/:agentId/files/**` | Definition file tree, read, write, create, rename, delete, upload. Paths are checked against `isAllowedDefinitionPath`. |
| POST | `/api/account/import` | Import a definition bundle. |

Credentials referenced by a definition's `${secret:KEY}` markers:

| Verb | Path | Notes |
|------|------|-------|
| GET  | `/api/account/mcp-credentials` | Key names + `updatedAt` **only** — values are write-only. |
| PUT  | `/api/account/mcp-credentials` | Upsert `{ key, value }`. Rotation is a repeat PUT; the definition file never changes. |
| DELETE | `/api/account/mcp-credentials/:key` | Remove. |

Per-project surfaces — discovery, and the workspace's shared artifact tree
(the counterpart of `/api/files` for a workspace):

| Verb | Path | Notes |
|------|------|-------|
| GET  | `/api/projects/:id/custom-agents` | Agents/jobs available to this project. |
| GET  | `/api/projects/:id/universal/artifacts/tree` | Artifact tree. `plan/` is listed first and is not deletable or renamable; a root `sessions` node is grafted last. |
| POST | `/api/projects/:id/universal/artifacts/{upload,create-file,rename,mkdir}` | Mutations. `sessions` is reserved at the artifacts root → 400 `reserved-name-sessions`. |
| DELETE | `/api/projects/:id/universal/artifacts/file?path=` | Delete. Canonical roots (`plan`, `sessions`) are cleared, not removed. |

Reads and downloads reuse the codespace file routes with `UNIVERSAL_FEATURE`
(`'universal'`) in the feature slot — `/api/projects/:id/features/universal/{files-raw,download}`
resolve against the container's merged view; `download` zip-streams directories.

A custom job is started through the normal job route with
`jobType: 'universal'` plus `customJobRef: "{agentId}/{jobId}"`, and
`UNIVERSAL_FEATURE` (`'universal'`) in the feature slot. The project-kind gate
is bidirectional and rejects at accept time, never inside the worker:

| Status | Code | Cause |
|---|---|---|
| 400 | `project-not-universal` | a `universal` job aimed at a codespace project |
| 400 | `project-universal-requires-custom-job` | a builtin jobType (`code`, `design`, `learn`, …, including `/resume` and `/continue`) aimed at a workspace project |
| 400 | `invalid-universal-feature` | the feature slot is not the reserved constant |
| 400 | `invalid-custom-job-ref` | the ref is not a well-formed `{agentId}/{jobId}` |
| 400 | `invalid-custom-job-definition` | the definition failed to load or validate |
| 400 | `unknown-intent` | an `@intent:` mention not in the job's catalog |

## Pipelines (scheduled custom-job chains)

> ⚠️ **Experimental** — see [concepts/pipelines.md](../concepts/pipelines.md).
> Pipelines drive `universal` jobs, so they apply to workspace projects only.

Definitions are **account-owned templates**, exactly like agent definitions, so
CRUD is account-scoped and needs no project. Binding one to a project is a
separate call (`activate`), and the activation lives in the caller's account.

| Verb | Path | Notes |
|------|------|-------|
| GET  | `/api/pipelines` | List definitions with `scope`, availability, and activation counts. |
| POST | `/api/pipelines` | Create. Body is validated by `validatePipelineDef`; reserved knobs are rejected, never ignored. |
| GET/PUT/DELETE | `/api/pipelines/:pipelineId` | Read, replace, delete. Writes answer **409** `pipeline-enabled` while the definition is enabled. |
| POST | `/api/pipelines/:pipelineId/enable` · `/disable` | The availability state machine. `disable` answers **409** `pipeline-has-activations` while anyone holds one — never cascaded. |
| POST | `/api/pipelines/:pipelineId/promote` | Move a user-scope definition into the org scope (team organizations only). Requires **disabled**. |
| GET  | `/api/pipelines/:pipelineId/permissions` · PUT `/editors` | Org ACL — owner plus delegated editors, the same rule set as agent definitions. |
| POST | `/api/pipelines/preview-fires` | Server-side cron expansion; the FE never parses cron itself. |
| GET  | `/api/pipelines/activatable-projects` | Workspace projects with no live pipeline and no live job. |

Activation, runs, and the human gates:

| Verb | Path | Notes |
|------|------|-------|
| GET  | `/api/pipelines/:pipelineId/activations` | Every binding, including other members' (`mine: false`, read-only). |
| POST | `/api/pipelines/:pipelineId/activate` | Body `{ projectId }`. Gates in order: enabled → universal project → project free → no live job. |
| POST | `/api/pipelines/:pipelineId/deactivate` | Body `{ projectId }`, own activation only. Cancels the live run, kills running step jobs, keeps run history. |
| POST | `/api/pipelines/:pipelineId/run-now` | Fire once through the same path a cron fire takes. |
| GET  | `/api/pipelines/:pipelineId/runs` · `/api/pipelines/runs/:runId` | Run index and one run's history. |
| POST | `/api/pipelines/runs/:runId/cancel` | Cancel a live run. |
| POST | `/api/pipelines/runs/:runId/steps/:stepId/clarify` | Answer a step parked on `awaiting_clarify`; the step re-dispatches under a new job id. |
| GET  | `/api/pipelines/approvals` · POST `/approvals/:gateId` | The approvals inbox. Resolving is idempotent and shares one funnel with the chat card and the timeout arm, so a gate settles exactly once. |
| GET  | `/api/projects/:id/active-pipeline` | The one project-scoped read: which pipeline, if any, currently owns this project. |

While a project holds an activation, every interactive job start on it
(`execute`, `resume`, `continue`, `inline-ask`) answers **409**
`project-pipeline-active`. This is a separate axis from the project-kind gate
above:

| Status | Code | Cause |
|---|---|---|
| 409 | `project-pipeline-active` | an interactive job aimed at a project a pipeline owns |
| 409 | `project-has-active-pipeline` | activating onto a project that already has one |
| 409 | `project-has-live-job` | activating onto a project with a running or paused job |
| 409 | `pipeline-disabled` | activating a definition that is not enabled |
| 409 | `pipeline-enabled` | editing, deleting, or promoting an enabled definition |
| 409 | `pipeline-has-activations` | disabling a definition somebody still holds |

## Realtime (SSE)

`ant-realtime` exposes:

| Path                                               | Stream                          |
|----------------------------------------------------|---------------------------------|
| `/realtime/chat?featureId=...`                     | LLM token stream                |
| `/realtime/workflow?featureId=...`                 | Phase / node lifecycle events   |
| `/realtime/job?jobId=...`                          | Job-scoped events               |

Set `Accept: text/event-stream`. Disable proxy buffering on the path.

## Pagination and errors

- List endpoints accept `?limit=...&cursor=...`. Default limit 50, max 200.
- Error responses follow `{ error: { code, message, hint? } }`.
- 4xx errors include a human-readable `hint` for common operator issues.
- 5xx errors include a `traceId` (when tracing is wired) so operators
  can grep logs.

## Read next

- [internals/](../internals/) — full route definitions, middleware,
  auth wiring.
- [internals/21-realtime-system.md](../internals/21-realtime-system.md) —
  SSE channel internals.
- [internals/44-universal-job.md](../internals/44-universal-job.md) — the
  universal runtime behind the custom-agent routes.
