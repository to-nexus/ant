# System Overview

## Overview

ANT is an AI-agent-based software development platform. It is organized as a pnpm
monorepo and follows a Modular Monolith structure in which a single codebase
(ant-cli) is deployed as 4 separate processes.

## Package Layout

| Package | npm name | Role |
|--------|----------|------|
| `ant-cli` | `@ant/cli` | Backend. API server, Job Worker, Realtime server, Preview server |
| `ant-ui` | `@ant/ui` | Frontend. React 19 + Vite SPA |
| `ant-shared` | `@ant/shared` | Shared types. Defines contracts between packages |
| `ant-site` | - | Marketing site. Next.js SSG |

At deployment time, `ant-cli` runs as 4 processes split by role. There is one
codebase; the entry point and environment variables determine each process's role.

## Process Topology

| Process | Port (local) | Entry point | Role |
|----------|------------|--------|------|
| ant-api | 4100 | `composition/server.ts` | REST API, IDE proxy, static file serving |
| ant-realtime | 4101 | `infrastructure/realtime/start-realtime-server.ts` | SSE connection management, Redis Pub/Sub subscription |
| ant-job | - | `infrastructure/worker/start-job-worker.ts` | BullMQ Worker, spawns child processes (job-runner) |
| ant-preview | 4102 | `infrastructure/preview/start-preview-server.ts` | Dev Server lifecycle, Preview proxy |

Inter-process communication happens through Redis. There are no direct
process-to-process HTTP calls.

## Deployment Model

### Local mode

All 4 processes run on a single machine. Redis is started locally via Docker
Compose. Authentication uses the fixed `local:local` tenant. File storage is the
local filesystem.

### Cloud mode

Each process is deployed as an independent Pod in a Kubernetes environment. Redis
is ElastiCache, and file storage is EFS (NFS). Authentication is OAuth-based.

| Service | Scaling | LB policy |
|--------|---------|---------|
| ant-api | HPA (CPU) | Round-robin |
| ant-realtime | KEDA (connections) | Round-robin |
| ant-job | KEDA (queue depth) | N/A (queue-based) |
| ant-preview | HPA (CPU) | Round-robin |

Because every service uses Redis-based state management, sticky sessions are
unnecessary.

### Ingress Routing

| Host | Path | Target |
|--------|------|------|
| `ant.example.com` | `/realtime/*` | ant-realtime |
| `ant.example.com` | `/bridge/*` | ant-realtime |
| `ant.example.com` | `/api/*` | ant-api |
| `ant.example.com` | `/ide/*` | ant-api |
| `ant.example.com` | `/*` | ant-api (default) |
| `ant-preview.example.com` | `/*` | ant-preview |

Preview uses a separate host. Host-based routing solves the problem of SSR apps'
absolute-path resources bypassing URI-based routing.

## Technology Stack

### Backend (ant-cli)

- Runtime: Node.js 18+, TypeScript 5.0+
- Web: Express
- AI: LangGraph, @langchain/*, Anthropic SDK, OpenAI SDK
- Queue: BullMQ, ioredis
- Template: Handlebars
- Validation: Zod
- VCS: simple-git

### Frontend (ant-ui)

- Framework: React 19, Vite
- State: Zustand
- Styling: Tailwind CSS
- UI: Radix UI, Lucide React, Framer Motion
- Visualization: ReactFlow (workflow graph)

### Infrastructure

- Monorepo: pnpm workspaces
- Container: Docker (local IDE), Kubernetes (cloud)
- Storage: Redis (state, Pub/Sub, queue), EFS (files)

## Per-Environment Differences

| Item | Local | Cloud |
|------|-------|-------|
| Authentication | `local:local` automatic | OAuth |
| State storage | Redis | Redis |
| Job queue | BullMQ | BullMQ |
| File storage | Local FS | EFS |
| IDE | Docker container | Kubernetes Pod |
| Preview | Local process | In-pod process |

Local and Cloud share the same code path. Only where the infrastructure runs
differs.

## Boundaries

- Internal structure of each process: see the per-process documents
- Redis key/channel conventions: [02-infrastructure.md](02-infrastructure.md)
- Job execution flow: [10-job-lifecycle.md](10-job-lifecycle.md)
- Frontend architecture: [30-frontend-architecture.md](30-frontend-architecture.md)
