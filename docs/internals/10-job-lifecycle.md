# Job Lifecycle

## Overview

A Job is the unit of a user's work request. It starts with an HTTP request, is
delivered to a Worker via the BullMQ queue, and the agent graph runs in a child
process. Interruption and resumption are supported.

## Job Types

| JobType | Agent | Output |
|---------|-------|--------|
| `code` | architect | Source code |
| `design` | architect | Design documents (MD, JSON) |
| `learn` | architect | Vector DB index |
| `plan` | planner | PRD |
| `ask` | architect | Chat response |
| `inline-ask` | architect | Chat response (within a Job context) |
| `visual` | creator | Visual assets (PNG, WebP, JPEG, SVG) |

## Execution Flow

### 1. Enqueue

The API Server receives the HTTP request and enqueues a Job to BullMQ.

```
POST /api/projects/:id/features/:feature/execute
    -> createExecuteJob()
    -> BullMQJobQueue.enqueue(JobPayload)
    -> stored in the Redis ant-jobs queue
```

Only 1 Job can run concurrently per Feature. If a Job is already running, 409 is
returned.

### 2. Dequeue & Spawn

The Job Worker (BullMQ Worker) dequeues the Job from the queue and spawns a child
process.

```
JobWorker.processJob(bullmqJob)
    -> spawns job-runner.ts as a child process
    -> passes JobPayload via environment variables (whitelist approach)
    -> collects logs through stdout/stderr pipes
```

Environment variables are isolated via a whitelist. The `...process.env` spread
is not used.

### 3. Orchestrate

Inside the child process, the Orchestrator runs the appropriate agent graph
according to the agent + jobType combination.

```
job-runner.ts
    -> orchestrator({ agent, jobType, ... })
    -> agent/jobType mapping:
        architect + code   -> runCodeGraph()
        architect + design -> runDesignGraph()
        architect + learn  -> runLearnGraph()
        architect + ask    -> runInlineAsk()
        planner + plan     -> runPlanGraph()
        creator + visual   -> runVisualGraph()
```

### 4. Execute

The agent graph runs as a LangGraph StateGraph. Each node performs LLM calls,
tool executions, file I/O, and so on. State during execution is reflected into
Redis in real time and broadcast via Pub/Sub.

### 5. Complete

On Job completion, the API Server is notified via the `job:status:updates`
channel. The API Server updates its internal state and propagates it to the
frontend.

## Interruption

### Interruption reasons

| Reason | Trigger |
|------|--------|
| `user_stopped` | User clicked the stop button |
| `recursion_limit` | LangGraph recursion limit reached |
| `api_error` | LLM API error |
| `process_crash` | Abnormal child process exit |
| `server_crash` | Worker crash or BullMQ lock expiry (stalled detection) |
| `timeout` | Execution time exceeded |
| `tasks_failed` | Task failure during parallel execution |
| `awaiting_choice` | Waiting for user choice (Triage) |

### Interruption handling flow

1. When an interruption occurs, the current state is checkpointed to the session file
2. `interruption` metadata (reason, canResume, timestamp) is recorded
3. Job status is updated to `paused`
4. API Server is notified
5. An interruption ChoiceCard is shown in the frontend

### Kill Reason Tracking (Redis-based)

Before the Worker sends SIGTERM to the child, it records the termination reason
under the Redis key `ant:job:killReason:{jobId}`. The child's SIGTERM handler
reads this value to determine the exact `InterruptionReason`.

```
Worker: setKillReason(jobId, reason) → Redis SET (TTL 60s) → child.kill('SIGTERM')
Child:  SIGTERM → resolveKillReason(jobId) → Redis GET (100ms cap) → handleGracefulShutdown(reason)
```

If the Redis key is absent, it is assumed that the infrastructure (Kubernetes)
terminated the process directly, bypassing the Worker, and `server_crash` is
used.

### Child Process Termination Scenarios

There are 5 paths through which the child process terminates. In scenarios 1-4
the Worker terminates it via the `killChildGracefully()` pattern (SIGTERM →
grace-period wait → SIGKILL); in scenario 5 the infrastructure terminates it
directly.

**1. User stop (user_stopped)**

```
User → stop button → API Server → publish on the Redis job:stop channel
→ Job Worker is subscribed → setKillReason(jobId, 'user_stopped')
→ killChildGracefully(child, 3s)
→ Child receives SIGTERM → resolveKillReason → gracefulShutdown.ts
→ orchestrator.handleInterruption() → save checkpoint → exit
```

In parallel, cancellation polling (5-second interval) also checks the
`isUserStopped` flag and sends SIGTERM. Slower than the stop channel, but acts as
a backup if a Pub/Sub message is lost.

**2. Imminent BullMQ lock expiry (consecutive lock extension failures)**

```
2 consecutive extension failures (5 minutes elapsed, just before lock expiry)
→ cleanup of all timers → setKillReason(jobId, 'server_crash')
→ killChildGracefully(child, 3s)
→ Child SIGTERM → graceful shutdown → save checkpoint
→ avoids moveToFinished's "Missing lock" error
```

Without this path: the child keeps running unaware of the lock expiry → calls
moveToFinished after a normal exit → "Missing lock for job" error → inconsistent
Job state.

**3. BullMQ stalled detection (Worker/child crash)**

```
Worker/child crash → lock extension stops → lock expires
→ BullMQ detects the stall on the stalledInterval (1 min) → stalled event
→ setKillReason(jobId, 'server_crash')
→ killChildGracefully(child, 2.5s) (in case it is still alive)
→ status updated to paused, server_crash interruption published
```

Because maxStalledCount=0, stalled jobs are not re-queued. The user resumes them
manually.

**4. Reprocessing the same Job (Mac sleep/resume race)**

```
At processJob start, an existing child with the same jobId is found
→ killChildGracefully(existingChild, 3s) → existing child terminated
→ new child spawned
```

**5. Direct infrastructure termination (K8s SIGTERM / KEDA scale-down / OOMKill)**

```
Kubernetes → sends SIGTERM to the Pod (terminationGracePeriodSeconds: 300s)
→ Worker receives SIGTERM → calls shutdown()
→ setKillReason(jobId, 'server_shutdown') recorded in parallel for all active jobs
→ SIGTERM to each child → child runs resolveKillReason → graceful shutdown
→ save checkpoint → exit(143)
```

When the child receives SIGTERM directly without going through the Worker
(OOMKill, etc.), there is no killReason in Redis, so it is classified as
`server_crash`.

### Timeline Relationship of Lock, Stall, and Kill

```
  lockDuration = 5min
  extensionInterval = 2.5min
  stalledInterval = 1min

  ┌─── Normal ────────────────────────────────────────────┐
  │  T+0     T+2.5m    T+5m      T+7.5m    ...   T+end   │
  │  lock    extend✓   extend✓   extend✓         finish   │
  └───────────────────────────────────────────────────────┘

  ┌─── Lock failure ─────────────────────────────────────┐
  │  T+0     T+2.5m    T+5m                               │
  │  lock    fail(1/2) fail(2/2)→ cleanup + SIGTERM        │
  │                     ↑ child killed just before lock expiry │
  └───────────────────────────────────────────────────────┘

  ┌─── Mac Sleep ──────────────────────────────────────────┐
  │  T+0     T+2.5m    ...sleep...  T+Xm (wake)           │
  │  lock    extend✓   interval stops  first tick: elapsed>lock │
  │                                  → immediate cleanup+kill   │
  └────────────────────────────────────────────────────────┘

  ┌─── Crash ───────────────────────────────────────────┐
  │  T+0     T+2.5m   T+5m    T+6m                      │
  │  lock    💀crash   expire  stall detected → paused   │
  └──────────────────────────────────────────────────────┘

  ┌─── K8s Scale-Down ─────────────────────────────────┐
  │  KEDA scale-down → Pod SIGTERM                      │
  │  → Worker shutdown() → setKillReason(server_shutdown)│
  │  → child SIGTERM → resolveKillReason (100ms)        │
  │  → gracefulShutdown (1800ms) → checkpoint + exit    │
  │  terminationGracePeriodSeconds: 300s                │
  └────────────────────────────────────────────────────┘
```

### SIGTERM Timing Budget

After the child receives SIGTERM, the checkpoint must complete within the time
budget before SIGKILL.

```
  resolveKillReason: max 100ms (Promise.race cap)
  diagnostics log:   ~1ms (sync)
  gracefulShutdown:  max 1800ms (timeout)
  ─────────────────────────
  total:             ~1901ms

  Stall handler grace: 2500ms → 599ms headroom
  Stop/Lock grace:     3000ms → 1099ms headroom
  K8s termination:     300s   → ample headroom
```

For detailed timing and configuration values, see
[02-infrastructure.md § BullMQ](02-infrastructure.md).

## Resume

### Resume determination

The `isResume` flag is set under the following conditions:
- The session has an interruption and a taskQueue exists
- The `/resume` or `/continue` endpoint is called
- Passed via the `ANT_IS_RESUME` environment variable in Cloud mode

### Resume routing (Code/Design Job)

A 4-way branch in the resolve node:

| Condition | Routing target |
|------|-----------|
| `!isResume` | triage (new Job) |
| `isResume + hasTaskQueue + overrideDirective` | revise (decide whether to restructure tasks) |
| `isResume + hasTaskQueue` | plan (resume from the interruption point) |
| `isResume + hasResolvedAction` | decompose (interrupted after environment detection) |

### Resume routing (Plan Job)

If a conversation exists in the session, triage is skipped and execution goes
straight to the generate node.

### directive / overrideDirective

| Field | Role |
|------|------|
| `directive` | The currently effective directive |
| `overrideDirective` | A new directive entered via chat |

On resume, if an overrideDirective is present, the LLM decides in the revise node
whether to adjust the existing task queue. After processing, the
overrideDirective is consumed and promoted to directive.

## Checkpoint

### Storage location

`{featurePath}/sessions/{agent}/{jobType}.json`

### Save points (Code/Design Job)

| Point | Saved content |
|------|----------|
| runner.ts (initial) | Early save of directive |
| detect | resolvedAction |
| decompose ~ runtimeValidate | Full state (saveCheckpoint) |
| runner.ts (recursion limit) | Full state + interruption |
| learn | Final state |

### Save points (Plan Job)

| Point | Saved content |
|------|----------|
| generate complete | conversation + conversationHistory + directive + tokenUsage |
| tool complete | conversationHistory + tokenUsage |
| SIGTERM | Latest state from stateSnapshot + interruption |

### Concurrent-Write Protection for Session Files

`FileSessionAdapter` provides two protection mechanisms:
- **Per-job FileMutex**: serializes read-modify-write operations per job type
- **Atomic write**: writes to a temp file first, then replaces the original via `fs.rename()`

## Boundaries

- BullMQ/Redis infrastructure conventions: [02-infrastructure.md](02-infrastructure.md)
- Agent graph structure: [11-agent-architecture.md](11-agent-architecture.md)
- Code Job details: [14-code-job.md](14-code-job.md)
- Design Job details: [15-design-job.md](15-design-job.md)
- Planner Job details: [16-planner-job.md](16-planner-job.md)
