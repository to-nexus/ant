# Realtime System

## Overview

ANT's realtime communication consists of Redis Pub/Sub and Server-Sent Events (SSE). The Job Worker publishes to Redis, and the Realtime Server subscribes and forwards to the frontend over SSE.

## SSE Connection Structure

Two independent SSE connections are used.

| Connection | Endpoint | Keyed by | Data |
|------|-----------|---------|--------|
| Unified SSE | `/realtime/projects/:id/features/:feature/stream` | project + feature | kanban, chat, fileTree, preview, gitChange |
| Workflow SSE | `/realtime/jobs/:jobId/workflow/stream` | jobId | Workflow node state |

Reason for the split: the Unified SSE stays connected per project/feature at all times, while the Workflow SSE connects only when there is a running job, keyed by that jobId.

## Event Propagation Flow

```
Publisher (Job Worker child / HTTP Server / Realtime Server)
    -> Broadcaster class
    -> Redis PUBLISH (user-scoped channel)
    -> Realtime Server (subscribe)
    -> SSE (per-client delivery)
    -> ant-ui (per-message-type handler routing)
```

The Job Worker accesses Redis directly without going through the API Server.

## Broadcaster

All Pub/Sub publishing happens exclusively through broadcaster classes. No code calls raw `stateStore.publish` or raw `redis.publish` directly for SSE purposes.

| Class | File | Published types | Execution context |
|--------|------|-----------|---------------|
| `KanbanBroadcaster` | `core/realtime/KanbanBroadcaster.ts` | `kanban` | Job Worker child |
| `WorkflowBroadcaster` | `core/realtime/WorkflowBroadcaster.ts` | `workflow` | Job Worker child |
| `FileTreeBroadcaster` | `core/realtime/FileTreeBroadcaster.ts` | `fileTree`, `unseenArtifacts` | Job Worker child |
| `PreviewBroadcaster` | `core/realtime/PreviewBroadcaster.ts` | `preview` | Job Worker child / Preview Server |
| `GitStateBroadcaster` | `core/realtime/GitStateBroadcaster.ts` | `gitState` | Job Worker child · HTTP Server · Realtime Server |
| `MessageBroadcaster` | `core/chat/MessageBroadcaster.ts` | `chat` | Job Worker child |

`GitStateBroadcaster` has a transport-agnostic design, taking a `publisher: (channel, payload) => Promise<unknown>` callback in its constructor. The Job Worker creates its own ioredis connection, while the HTTP/Realtime Server reuses the existing `stateStore.publish`. Under the single `gitState` SSE type, a `cause` discriminant (`workingTreeChange` | `operationComplete` | `reconnectRefill`) carries three distinct meanings.

### gitState 3-cause Publish Paths

- **`workingTreeChange`** — a lightweight hint. Co-emitted by `FileTreeBroadcaster.notifyFileTreeUpdate` (working-tree file changes during a job) and by `GitWatcherService` via `.git/index` mtime polling (Git manipulation from an external terminal). The FE debounces and then re-runs `fetchGitWorldState`.
- **`operationComplete`** — published from `GitOperation.onSuccess` after a user-initiated Git op succeeds. Carries the full `GitSnapshot` + `GitOperationState` + `GitPatState` so the FE can replace its snapshot immediately.
- **`reconnectRefill`** — automatically published once by the server when an SSE subscription (re)opens. Ensures a consistent state right after a reload, with no stale UI.

All three paths publish through the same `GitStateBroadcaster` instance as a **single `gitState` event type**. Details: [24-git-operations.md §0 (Git World contract — greenfield SSOT)](24-git-operations.md).

## Job Worker Environment Variable Validation

Broadcaster initialization (`getBroadcasterOptionsFromEnv`) logs the failure via `logger.error` and returns `null` if any of the 7 required env vars is missing. In that case the job still runs, but realtime updates are not delivered; the missing keys can be found in the log's `missing` array.

Required env: `ANT_REDIS_URL`, `ANT_JOB_ID`, `ANT_PROJECT_ID`, `ANT_FEATURE_NAME`, `ANT_FEATURE_PATH` (or `ANT_PROJECT_PATH`), `ANT_USER_ID`, `ANT_ORG_ID`. The whitelist is managed in `JobWorker.spawnJobProcess`.

## Initial State Delivery

Immediately after an SSE connection is established, the server sends the initial state.

### Unified SSE Initial State

| Data | Lookup source |
|--------|----------|
| Kanban | Session file + Redis (live TaskQueueSnapshot) |
| Chat | Session file / Redis |
| FileTree | Filesystem |

`dataSource` precedence for the initial Kanban state:
1. Live TaskQueueSnapshot in Redis -> `live`
2. Job running but no snapshot -> `estimating`
3. Otherwise -> `session` (based on the session file)

### Workflow SSE Initial State

Looks up `WorkflowRealtimeState` from Redis `ant:job:workflow:{jobId}`. The Job Worker's WorkflowBroadcaster refreshes this key on every node enter/exit (TTL 24h).

## Connection Lifecycle

### Unified SSE

1. `projectSlice.setSelectedFeature()` -> `sseSlice.initializeSSE()` -> `sseManager.connect()`
2. Handler registration: kanban -> `updateKanban()`, chat -> `addChatMessage()`, fileTree -> `setFileTree()`
3. Server sends the 3 initial-state payloads

### Workflow SSE

1. `jobSlice.setRunning(true, jobId)` -> `sseManager.connectWorkflow(jobId)`
2. Or the `useWorkflowSSE(jobId)` hook ensures the connection
3. `connectWorkflow` is idempotent (skips if already connected)

## Reconnection Policy

| Stage | Behavior |
|------|------|
| onerror 1–5 times | EventSource browser auto-reconnect (no state change) |
| onerror more than 5 times | disconnect -> exponential backoff reconnect |
| Reconnect success | connectionStatus = connected |

Backoff formula: `min(30s, 1s * 2^(attempt - 5))`

In a multi-pod environment, reconnecting to a different pod is fine — it subscribes to the same user-scoped channel, so event delivery is unaffected.

### Preventing Streaming Message Loss on Reconnect

If the SSE connection drops and recovers, the in-flight content of a streaming assistant message can be lost. On reconnect the server sends the current session snapshot stored in Redis, and the frontend merges it with its existing message state for seamless restoration.

## Page Refresh Restoration

1. Store initialization (currentJobId = undefined)
2. Session restoration -> initializeSSE() -> Unified SSE connection
3. Receive the Kanban jobId in the Unified SSE initial state -> set isRunning, currentJobId
4. useWorkflowSSE reacts -> Workflow SSE connection
5. useJobRestoration (a second safety net) -> fetchQueuePosition -> setRunning

The initial Kanban state must include the running job's jobId for the full restoration chain to work.

## Boundaries

- Redis Pub/Sub channel conventions: [02-infrastructure.md](02-infrastructure.md)
- Chat message handling: [31-chat-system.md](31-chat-system.md)
- Frontend SSE integration: [30-frontend-architecture.md](30-frontend-architecture.md)
- Bridge WebSocket (Ant Desktop connection/detection/auth): [26-figma-integration-infra.md](26-figma-integration-infra.md)
