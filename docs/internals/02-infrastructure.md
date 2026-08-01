# Infrastructure

## Overview

All inter-process communication and state management in ANT goes through Redis.
BullMQ is used for the Job queue, Redis Pub/Sub for real-time event propagation,
and Redis Key-Value for state storage.

## Redis Key Structure

Central definition: `src/infrastructure/state/redisConstants.ts` (REDIS_KEYS)

All keys share the `ant:` prefix and are layered by domain.

### Job domain (`ant:job:*`)

| Key | Type | Purpose |
|----|------|------|
| `ant:job:status:{jobId}` | String (JSON) | Job status (running/completed/failed) |
| `ant:job:logs:{jobId}` | List | Job execution logs |
| `ant:job:taskQueue:{jobId}` | String (JSON) | Kanban task queue snapshot |
| `ant:job:mapping:{jobId}` | String (JSON) | projectId, featureName mapping |
| `ant:job:userStopped:{jobId}` | String | User-stop flag |
| `ant:job:workflow:{jobId}` | String (JSON) | Workflow node state |
| `ant:job:killReason:{jobId}` | String (JSON) | Termination reason recorded before SIGTERM (TTL 60s). Worker SETs, job-runner GETs |

### Chat domain (`ant:chat:*`)

| Key | Type | Purpose |
|----|------|------|
| `ant:chat:session:{sessionKey}` | String (JSON) | Session + message list |
| `ant:chat:currentMessage:{sessionKey}` | String (JSON) | Message currently streaming |

### Choice domain (`ant:choice:*`)

| Key | Type | Purpose |
|----|------|------|
| `ant:choice:pending:{choiceKey}` | String (JSON) | Pending triage choice |

### Infrastructure domain (`ant:infra:*`)

| Key | Type | Purpose |
|----|------|------|
| `ant:infra:preview:{portKey}` | String (JSON) | PreviewState (runtime — deleted on stop) |
| `ant:infra:preview-config:{portKey}` | String (JSON) | Preview configuration (persistent — connections, structureType, projectProfile) |
| `ant:infra:preview:list` | Set | Preview list |
| `ant:infra:preview:byPod:{podId}` | Set | Per-pod Preview index |
| `ant:infra:ide:{portKey}` | String (JSON) | IDEState |
| `ant:infra:ide:list` | Set | IDE list |
| `ant:infra:ide:instance:{instanceKey}` | String (JSON) | IDE instance (K8s) |
| `ant:infra:ide:lastAccess:{instanceKey}` | String | IDE last-access time |

### Index domain (`ant:index:*`)

| Key | Type | Purpose |
|----|------|------|
| `ant:index:jobsByFeature:{projectId}:{featureName}` | Set | Per-feature Job index |

### Key Format Conventions

| Key kind | Format | Component count |
|---------|------|-------------|
| IDE portKey | `{tenantId}:{userId}:{projectId}` | 3 (project scope) |
| Preview portKey | `{tenantId}:{userId}:{projectId}:{feature}` | 4 (feature scope) |
| sessionKey | `{orgId}:{userId}:{projectId}/{featureName}` | composite |

## Pub/Sub Channels

Central definition: `src/infrastructure/state/redisConstants.ts` (REDIS_CHANNELS)

### Channel list

| Channel | Publisher | Subscriber | Purpose |
|------|-----------|------------|------|
| `realtime:broadcast:{orgId}:{userId}` | Job Worker | Realtime Server | General-purpose: Chat, Kanban, FileTree, etc. |
| `realtime:workflow:{orgId}:{userId}` | Job Worker | Realtime Server | Workflow node state |
| `job:stop` | API Server | Job Worker | Job stop signal |
| `job:status:updates` | Job Worker | API Server | Job completion/failure notifications |

### Multi-Tenant Isolation

Real-time channels are scoped by `{orgId}:{userId}`. Events never leak to other
users. The Realtime Server determines which channel name to subscribe to from the
`userContext` at SSE connection time.

### Channel helper functions

| Function | Returns |
|------|------|
| `getRealtimeBroadcastChannel(orgId, userId)` | `realtime:broadcast:{orgId}:{userId}` |
| `getRealtimeWorkflowChannel(orgId, userId)` | `realtime:workflow:{orgId}:{userId}` |
| `parseChannelUserContext(channel)` | `{ orgId, userId } \| null` |

## BullMQ

### Queue configuration

| Item | Value | Rationale |
|------|---|------|
| Queue name | `ant-jobs` | |
| Default concurrency | 2 | |
| lockDuration | 5 minutes (300 000ms) | Margin over the longest LLM call (thinking=true, ~2 min) |
| lock extension interval | 2.5 minutes (150 000ms) | BullMQ convention: lockDuration / 2 |
| stalledInterval | 1 minute (60 000ms) | Detects a truly dead worker within ~3 minutes |
| maxStalledCount | 0 | No re-queueing of stalled jobs (prevents double-child on Mac sleep/wake) |

### Lock Extension and Stalled Detection

BullMQ's lock protects a Job while a Worker processes it so no other Worker can
pick up the same Job. When the lock expires, BullMQ judges the Job "stalled".

The lock/timer constants are centrally defined in
`infrastructure/queue/constants.ts` and imported by JobWorker and BullMQJobQueue.

**skipLockRenewal: true** — disables BullMQ's built-in auto-extension and uses
manual extension only. Reason: if the built-in auto-extension (75s interval) runs
alongside manual extension, the manual failure counter becomes meaningless and
lock-expiry detection after Mac sleep is masked.

**Normal sequence:**

```
T=0       Worker dequeues Job → acquires lock (TTL=5min)
T=2.5min  Extension succeeds → lock TTL renewed to 5min
T=5.0min  Extension succeeds → lock TTL renewed to 5min
  ...     (repeats while the child runs)
T=end     Child exits normally → moveToFinished → lock released
```

**Lock extension failure sequence (Redis timeout, etc.):**

```
T=0       Lock acquired (TTL=5min)
T=2.5min  Extension fails (1/2) → warn log, counter incremented
T=5.0min  Extension fails (2/2) → consecutive-failure threshold reached
          → clean up all timers (lock extension + cancellation polling)
          → SIGTERM to child → graceful shutdown → checkpoint saved
          → SIGKILL if the child has not exited within the 3s grace period
```

Rationale for the consecutive-failure threshold
(MAX_CONSECUTIVE_LOCK_FAILURES=2): with an extension interval of 2.5min, 2
consecutive failures = 5 minutes elapsed = just before lock expiry. Killing the
child at this point avoids moveToFinished's "Missing lock" error.

**Immediate Mac sleep detection (wall-clock gap detection):**

```
T=0       Lock acquired, lastExtensionTime = now
T=2.5min  Extension succeeds, lastExtensionTime updated
          ... Mac sleep begins (setInterval stops, only the Redis TTL keeps decreasing) ...
T=7min+   Mac wakes → first interval tick fires
          elapsed = now - lastExtensionTime > LOCK_DURATION
          → lock already expired — immediate cleanup + child kill without attempting extend
```

Principle: `setInterval` stops during sleep but `Date.now()` returns wall-clock
time. On the first tick after wake, if the elapsed time exceeds lockDuration,
detection is immediate. This cuts the previous 5-minute wait (2 consecutive
failures) down to 0 seconds.

**Stalled detection sequence (child/worker crash):**

```
T=0       Lock acquired (TTL=5min)
T=2.5min  Extension cannot be attempted (process crashed)
T=5.0min  Lock expires
T=6.0min  BullMQ detects the stall on the stalledInterval cycle
          → stalled event fires
          → child kill (SIGTERM → 2.5s → SIGKILL)
          → status updated to paused, server_crash interruption published
```

Because maxStalledCount=0, stalled jobs are not re-queued; they are recorded as
interruptions so the user can manually resume.

**State-race defense (stalled handler vs processJob):**

On Mac wake, after the stalled handler transitions the job to `paused`,
processJob could overwrite it with `completed`/`failed`. To prevent this,
processJob checks the current status before updateJobStatus and does not
overwrite if it is already `paused`.

### Child Process Kill — Unified Pattern

There are 5 scenarios that require terminating the child process. Scenarios 1-4
use the `killChildGracefully(child, jobId, gracePeriodMs)` method; in scenario 5,
K8s terminates the process directly.

Every Worker-initiated kill path records the termination reason in Redis via
`setKillReason(jobId, reason)` before SIGTERM. The child's SIGTERM handler reads
this value to determine the exact `InterruptionReason`.

| Scenario | Trigger | Grace Period | Kill Reason |
|---------|--------|-------------|-------------|
| Stalled detection | BullMQ stalled event | 2.5s | `server_crash` |
| User stop | Redis `job:stop` channel | 3s | `user_stopped` |
| Imminent lock expiry | Consecutive extension failures | 3s | `server_crash` |
| Job reprocessing | Duplicate spawn for the same jobId | 3s | — |
| Infrastructure shutdown | K8s SIGTERM / KEDA scale-down | 300s (terminationGracePeriod) | `server_shutdown` |

Kill sequence: `setKillReason → SIGTERM → wait (gracePeriodMs, with early-exit
detection) → check pid liveness → SIGKILL`

When the child receives SIGTERM, it reads the termination reason from Redis
within 100ms via `resolveKillReason(jobId)`, then saves a checkpoint and exits
through the handler in `gracefulShutdown.ts`. If the Redis key is absent, it
assumes a direct infrastructure kill and uses `server_crash`. SIGKILL is a last
resort, fired only when the child fails to exit within the grace period.

### Timer Management

The two timers inside `spawnJobProcess` (lock extension, cancellation polling)
are managed together in a `timers[]` array. Whichever path the child exits
through, `cleanup()` clears both timers:

| Exit path | cleanup call site |
|----------|-----------------|
| Normal / abnormal exit | child `close` event |
| Spawn failure | child `error` event |
| Lock expiry detected | extension failure handler |
| User stop detected | cancellation polling handler |

### Job Payload

The payload enqueued to BullMQ includes agent, jobType, projectId, featureName,
directive, userContext, and more. After dequeueing, the Worker spawns a child
process and passes the payload via environment variables.

## StateStore Interface

`RedisStateStore` implements the `StateStorePort` interface. Every process
accesses Redis through the same interface. There is no in-memory fallback.

Main method groups:

| Group | Methods |
|------|--------|
| Job status | `setJobStatus`, `getJobStatus`, `setJobMapping` |
| Kanban | `setTaskQueueSnapshot`, `getTaskQueueSnapshot` |
| Workflow | `setWorkflowState`, `getWorkflowState` |
| Chat | `setChatSession`, `getChatSession` |
| Choice | `setPendingChoice`, `getPendingChoice`, `deletePendingChoice` |
| Preview | `setPreviewState`, `getPreviewState`, `listPreviews` |
| IDE | `setIDEState`, `getIDEState`, `listIDEs` |
| Index | `addJobToFeatureIndex`, `listJobsByFeature` |

## Environment Variables

### Infrastructure (DevOps-managed)

| Variable | Required | Purpose |
|------|------|------|
| `ANT_REDIS_URL` | Y | Redis connection URL |
| `ANT_WORKSPACE_BASE_PATH` | Y | Workspace root path |
| `ANT_SERVER_MODE` | Y | `local` or `cloud` |
| `ANT_ENCRYPTION_KEY` | Y | Encryption key |
| `ANTHROPIC_API_KEY` | Y | Claude API key |
| `OPENAI_API_KEY` | N | OpenAI API key |
| `GEMINI_API_KEY` | Y | Gemini API key |

### Runtime (injected into the child process)

Central definition: `src/core/types/processEnv.ts` (CHILD_PROCESS_ENV)

| Variable | Purpose |
|------|------|
| `ANT_JOB_ID` | Job identifier |
| `ANT_PROJECT_ID` | Project ID |
| `ANT_FEATURE` | Feature path identifier |
| `ANT_FEATURE_NAME` | Feature name alias |
| `ANT_JOB_TYPE` | Job type |
| `ANT_AGENT` | Agent type (`architect \| planner \| creator \| reviewer \| doc`) |
| `ANT_MODE` | Execution mode (`generate \| refactor \| explain`) |
| `ANT_USER_ID` | User ID (from the auth session) |
| `ANT_ORG_ID` | Organization ID (from the auth session) |
| `ANT_USER_EMAIL` | User email |
| `ANT_PROJECT_PATH` | Absolute project path |
| `ANT_FEATURE_PATH` | Absolute feature path |
| `ANT_REDIS_URL` | Redis URL |
| `ANT_API_URL` | API Server URL |
| `ANT_OVERRIDE_DIRECTIVE` | New directive on resume |
| `ANT_INPUT_FILE` | Input file path |
| `ANT_IS_RESUME` | Whether this is a resume |
| `ANT_ORIGINAL_JOB_ID` | Original Job ID (for resume) |
| `ANT_CHAT_SOURCE` | Whether the source is chat |
| `ANT_SERVER_MODE` | Server mode (`local \| cloud`) |
| `ANT_WORKSPACE_BASE_PATH` | Workspace base path |
| `ANT_CLI_ROOT` | CLI root path |

`ANT_USER_ID`, `ANT_ORG_ID`, and `ANT_USER_EMAIL` are not set in `.env`. They are
determined dynamically from the auth session.

## Boundaries

- Process topology and deployment model: [00-system-overview.md](00-system-overview.md)
- Job queue execution flow: [10-job-lifecycle.md](10-job-lifecycle.md)
- SSE connections and broadcasting: [21-realtime-system.md](21-realtime-system.md)
