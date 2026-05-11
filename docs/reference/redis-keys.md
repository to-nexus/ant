# Redis keys

Ant uses Redis for **everything cross-process**: the BullMQ queue,
canonical state (kanban, job status, user-stopped flags), pub/sub
channels for streaming, and locks for clone/init/fetch.

The canonical SSOT for keys is
[`packages/ant-cli/src/infrastructure/state/RedisKeys.ts`](../../packages/ant-cli/src/infrastructure/state/RedisKeys.ts)
(file path stable across releases). This page is the operator-friendly
catalog.

For the deep dive (TLS, cluster topology, retry semantics) see
[internals/02-infrastructure.md](../internals/02-infrastructure.md).

## Naming convention

All keys are prefixed with `ant:`:

```
ant:<group>:<resource>[:<sub>]
```

Examples:

```
ant:job:status:<jobId>
ant:state:active
ant:lifecycle:cleanup:request
ant:lock:clone:<org>:<user>:<projectId>
ant:queue:ant-jobs           (BullMQ-managed)
ant:throttle:worktree-prune:<projectId>
```

The `ant:` prefix lets you scope a Redis ACL to Ant's keyspace.

## Groups

### Jobs (`ant:job:*`)

| Key                                        | Type   | Purpose                                          |
|--------------------------------------------|--------|--------------------------------------------------|
| `ant:job:status:<jobId>`                   | hash   | Terminal state, timing, error message.           |
| `ant:job:user-stopped:<jobId>`             | string | `1` if the user requested stop.                  |
| `ant:job:kill-reason:<jobId>`              | string | Reason for forced termination.                    |
| `ant:job:active:<feature>`                 | set    | Active jobs per feature.                         |
| `ant:job:kanban:<feature>`                 | hash   | Kanban snapshot — queue, running, completed.     |

### State (`ant:state:*`)

| Key                                        | Type   | Purpose                                          |
|--------------------------------------------|--------|--------------------------------------------------|
| `ant:state:active`                         | set    | Active feature ids (for liveness checks).        |
| `ant:state:project:<projectId>`            | hash   | Project metadata cache.                          |
| `ant:state:feature:<featureId>`            | hash   | Feature metadata cache.                          |

### Lifecycle (`ant:lifecycle:*`) — pub/sub

| Channel                                    | Direction         | Payload                                  |
|--------------------------------------------|-------------------|------------------------------------------|
| `ant:lifecycle:cleanup:request`            | api → preview / ide | `{ kind, projectId, featureId? }` |
| `ant:lifecycle:cleanup:ack`                | preview / ide → api | `{ requestId, status }`           |

### Streaming (`chat:*`, `workflow:*`, `job:status:updates`)

| Channel                                    | Producer        | Consumer        | Payload                       |
|--------------------------------------------|-----------------|-----------------|-------------------------------|
| `chat:tokens:<feature>`                    | job-runner      | ant-realtime    | LLM token chunks              |
| `workflow:<feature>`                       | job-runner      | ant-realtime    | Phase / node lifecycle events |
| `job:status:updates`                       | job-runner      | ant-api         | Terminal job state            |

### Locks (`ant:lock:*`)

Used for distributed coordination of git operations (clone, init, fetch).

| Key                                              | TTL  | Purpose                  |
|--------------------------------------------------|------|--------------------------|
| `ant:lock:clone:<org>:<user>:<projectId>`        | 600s | Single clone in flight   |
| `ant:lock:init:<org>:<user>:<projectId>`         | 300s | Single init in flight    |
| `ant:lock:fetch:<org>:<user>:<projectId>:<feature>` | 180s | Single fetch in flight |

Acquisition is `SETNX EX <ttl>`. Failure throws `GitConflictError`
(HTTP 409). See [AGENTS.md § Project / Feature Lifecycle](../../AGENTS.md#project--feature-lifecycle).

### Throttles (`ant:throttle:*`)

| Key                                              | TTL    | Purpose                                  |
|--------------------------------------------------|--------|------------------------------------------|
| `ant:throttle:worktree-prune:<projectId>`        | 3600s  | Per-project worktree corrupt-meta sweep  |

### BullMQ-managed (`ant:queue:ant-jobs:*`)

BullMQ owns these. Don't manipulate them directly except for ops:

| Key                                              | Purpose                              |
|--------------------------------------------------|--------------------------------------|
| `ant:queue:ant-jobs:meta`                        | Queue metadata.                      |
| `ant:queue:ant-jobs:wait`                        | Pending jobs list.                   |
| `ant:queue:ant-jobs:active`                      | In-flight jobs list.                 |
| `ant:queue:ant-jobs:failed`                      | Failed jobs (retryable budget).      |

For queue depth metrics, `LLEN ant:queue:ant-jobs:wait` is the right
gauge.

## TLS / cloud notes

When using ElastiCache Serverless with a custom CNAME, TLS hostname
verification must be skipped. Ant handles this in:

- `RedisStateStore.ts`
- `BullMQJobQueue.ts`
- `JobWorker.ts`

The bypass uses `checkServerIdentity` and is gated to ElastiCache-shaped
URLs only. Don't disable verification for general Redis hosts.

## Cluster mode

Single-node Redis is the default. Cluster mode is supported when:

- All keys for a given operation hash to the same slot.
- BullMQ's pipeline operations are within a single key group.

In practice, Ant's per-feature key groups (`ant:job:*:<feature>`,
`ant:state:feature:<featureId>`) all hash on the feature id when you set
`ANT_REDIS_HASHTAG=feature` (off by default; see internals).

## Read next

- [internals/02-infrastructure.md](../internals/02-infrastructure.md) —
  full SSOT including pub/sub fan-out, BullMQ retry semantics, and TLS.
- [cloud-mode/install.md](../cloud-mode/install.md) — production
  Redis setup.
