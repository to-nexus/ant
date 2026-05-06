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
