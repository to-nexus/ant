# Local runbook (repeatable)

This is the shortest path to a repeatable local run for the core smoke suite.

## 0) Prereqs

- Node.js (project targets Node 20 in builds)
- Docker (for Redis via `pnpm dev:infra:redis`)

## 1) Start Redis

From repo root:

```bash
pnpm dev:infra:redis
```

## 2) Start servers (API + Realtime + Worker + Preview)

Ant’s core flows require all of these running:

- API server (HTTP /api, job enqueue, resume/continue)
- Realtime server (SSE under `/realtime/*`)
- Job worker (BullMQ consumer)
- Preview server (separate host)

Minimal env you should set explicitly:

```bash
export ANT_SERVER_MODE="local"
export ANT_REDIS_URL="redis://localhost:16379"
export ANT_WORKSPACE_BASE_PATH="/Users/probe/dev/ant-workspaces"  # adjust if different
```

Then run each process in its own terminal:

```bash
# API (4100)
pnpm --filter @ant/cli dev:server

# Realtime/SSE (4101)
pnpm --filter @ant/cli dev:realtime-server

# Worker (BullMQ)
pnpm --filter @ant/cli dev:job-worker

# Preview (4102)
pnpm --filter @ant/cli dev:preview-server
```

Notes:
- The scripts set ports (4100/4101/4102). Realtime/Preview entry points default to 8080 but scripts override via `PORT=...`.
- Realtime requires `ANT_WORKSPACE_BASE_PATH` (see `start-realtime-server.ts`).

## 3) Quick health checks

```bash
curl -sS "http://localhost:4100/api/health" | jq .
curl -sS "http://localhost:4101/health" | jq .
curl -sS "http://localhost:4102/health" | jq .
```

If you don’t have `jq`, just run without it.

## 4) Ensure a stable project + feature exist

Pick a stable pair:

```bash
export USER_EMAIL="local@local"
export PROJECT_ID="probe"
export FEATURE_NAME="skeleton"
```

Create project (idempotent-ish; 409 means it already exists):

```bash
curl -sS -X POST \
  "http://localhost:4100/api/projects?user-email=${USER_EMAIL}" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"${PROJECT_ID}\"}"
```

Create feature:

```bash
curl -sS -X POST \
  "http://localhost:4100/api/projects/${PROJECT_ID}/features?user-email=${USER_EMAIL}" \
  -H "Content-Type: application/json" \
  -d "{\"featureName\":\"${FEATURE_NAME}\",\"language\":\"typescript\"}"
```

## 5) Run the smoke suite

Follow:
- `docs/testing/01-core-smoke-suite.md`

## Common gotchas (only the real ones)

- **SSE auth context**: SSE should use `?user-email=...` (EventSource cannot send headers). Curl examples already do this.
- **Nothing happens after execute**: API can enqueue but worker isn’t running, or Redis URL mismatch.
- **Realtime connects but no initial state**: `ANT_WORKSPACE_BASE_PATH` is wrong, or workspace tree doesn’t contain the project/feature shape the services expect.

