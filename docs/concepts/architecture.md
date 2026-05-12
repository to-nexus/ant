# Architecture overview

Ant is a **modular monolith**: one codebase that runs as four independent
processes communicating exclusively through Redis. The same code path runs
locally and in cloud (Kubernetes) deployments. Local mode is just "all
processes on one machine".

For the regression-grade, incident-driven version of this document, see
[internals/00-system-overview.md](../internals/00-system-overview.md).

## Process topology

```
┌──────────────────────┐      ┌──────────────────────┐      ┌──────────────────────┐
│   ant-api    :4100   │      │   ant-realtime :4101 │      │   ant-preview :4102  │
│ REST + IDE proxy     │      │   SSE for chat /     │      │   per-feature dev    │
│ + auth                │     │   workflow streams   │      │   server lifecycle   │
└──────────┬───────────┘      └──────────┬───────────┘      └──────────┬───────────┘
           │                              │                              │
           └────────────── Redis: Pub/Sub + KV + BullMQ ────────────────┘
                                          │
                              ┌───────────┴───────────┐
                              │   ant-job             │
                              │   BullMQ worker;      │
                              │   spawns job-runner   │
                              │   per dequeued task   │
                              └───────────┬───────────┘
                                          │
                                          ▼
                                ┌─────────────────────┐
                                │   job-runner        │
                                │   child process;    │
                                │   runs LangGraph    │
                                │   agent for the job │
                                └─────────────────────┘
```

| Process       | Port | Entry point                                                |
|---------------|------|------------------------------------------------------------|
| `ant-api`     | 4100 | `composition/server.ts`                                    |
| `ant-realtime`| 4101 | `infrastructure/realtime/start-realtime-server.ts`         |
| `ant-job`     | —    | `infrastructure/worker/start-job-worker.ts`                |
| `ant-preview` | 4102 | `infrastructure/preview/start-preview-server.ts`           |

There is **no direct HTTP between processes**. Every cross-process call
flows through Redis: BullMQ for the job queue, Pub/Sub for state and
lifecycle events, and KV for canonical state (kanban snapshots,
job-completion flags, user-stopped markers).

## Why four processes?

Each process owns a single responsibility:

- `ant-api` is the user-facing edge. It validates requests, authenticates,
  and enqueues work. It must stay responsive even when a job is heavy.
- `ant-realtime` is the streaming edge. SSE connections for chat tokens
  and workflow events live here so they don't compete with REST traffic.
- `ant-job` runs the LangGraph agents. Spawning child `job-runner`
  processes per request means a misbehaving job can't take down the
  worker.
- `ant-preview` manages dev servers. Each feature gets its own preview
  server with its own port and proxy entry. Lifecycle is reference-counted
  via Redis pub/sub.

All four run on your laptop with `pnpm dev:all` (the `:cloud`
prefix names the topology, not the deployment target — `.env`'s
`ANT_SERVER_MODE=local` activates the local-tenant auth path). In
cloud production, each ships as a separate Kubernetes Deployment.

## What flows where

| Channel                       | Producer        | Consumer        | Payload                            |
|-------------------------------|-----------------|-----------------|------------------------------------|
| BullMQ queue `ant-jobs`       | ant-api         | ant-job         | Job descriptor (job id, type, args)|
| Redis Pub/Sub `chat:tokens:*` | job-runner      | ant-realtime    | Streamed LLM tokens                |
| Redis Pub/Sub `workflow:*`    | job-runner      | ant-realtime    | LangGraph node lifecycle events    |
| Redis Pub/Sub `job:status:*`  | job-runner      | ant-api         | Terminal job state                 |
| Redis Pub/Sub `lifecycle:*`   | ant-api         | ant-preview     | Cleanup ack/request                |
| Redis KV `state:*`            | job-runner      | ant-api / job   | Canonical state snapshots          |

The full key catalog is in [internals/02-infrastructure.md](../internals/02-infrastructure.md).

## Inside the codebase

`packages/ant-cli/src/` follows a hexagonal layout:

```
composition/    Entry points. Nothing else lives here. Wires DI.
core/           Domain logic, prompt engine, types, ports (interfaces).
agents/         LangGraph agent graphs (architect, planner).
infrastructure/ Adapters: queue, worker, realtime, IDE, preview.
periphery/      External adapters: HTTP, auth, git, LLM, memory, filesystem.
cli/            CLI runtime — Commander parser, command handlers.
utils/          Shared utilities.
```

The discipline is one-way: `composition/` depends on everything;
`core/` depends only on itself. Adapters in `infrastructure/` and
`periphery/` implement ports defined in `core/ports/`.

## Frontend

`packages/ant-ui/` is a single-page React + Vite app following clean
architecture layers:

```
presentation/     React components, pages.
application/      Hooks, slices that bridge presentation to domain.
domain/           Zustand store (15 slices) + domain types.
infrastructure/   HTTP, SSE, file system adapters.
```

State is one Zustand store with 15 slices. The composition order in
`domain/store/index.ts` is the SSOT.

## Local vs cloud

**Same data plane, different operator concerns.**

| Concern                     | Local                                  | Cloud                                          |
|-----------------------------|----------------------------------------|------------------------------------------------|
| Redis                       | Docker Compose                         | ElastiCache / managed Redis                     |
| Worker scale-out            | One process                            | Kubernetes Deployment with N replicas           |
| IDE pods                    | Local Docker                           | Kubernetes (KubernetesIDEOrchestrator)          |
| Workspace storage           | Host filesystem                        | EFS shared volume                               |
| Auth                        | `local:local` tenant                   | OAuth (configurable provider)                   |
| Figma MCP                   | Desktop MCP server                     | Cloud HTTP bridge                               |

Two intentional fork points (auth tenant resolution, Figma MCP transport)
are documented exceptions. Everything else is unified. See
[AGENTS.md § Unified Distributed System Principle](../../AGENTS.md#unified-distributed-system-principle)
for the binding contract.

## Read next

- [**agents**](agents.md) — Planner and architect.
- [**jobs**](jobs.md) — Plan, design, code, learn, ask.
- [**execution-tiers**](execution-tiers.md) — How tiers map to verification.
- [internals/](../internals/) — Full SSOT (incident-grade).
