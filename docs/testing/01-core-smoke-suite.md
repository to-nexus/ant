# Core smoke suite (API + SSE, fast & high-signal)

This suite is intentionally small. If these pass, Ant’s core loop is alive.

## Base URLs (local dev default)

- **API server**: `http://localhost:4100/api`
- **Realtime (SSE) server**: `http://localhost:4101/realtime`
- **Preview server**: `http://localhost:4102`

Notes:
- Realtime mounts SSE routes under `/realtime` (see `packages/ant-cli/src/infrastructure/realtime/RealtimeServer.ts`).
- Preview is a separate service (see `packages/ant-cli/src/infrastructure/preview/PreviewServer.ts`).

## User context (important for deterministic runs)

Most endpoints resolve tenant/user via:
- `?user-email=<userId>@<orgId>` (query) **or**
- `x-user-email: <userId>@<orgId>` (header)

SSE (EventSource) cannot set headers, so **SSE should use query** (see `packages/ant-cli/src/periphery/adapters/http/routes/helpers/userContext.ts`).

For local mode, server can infer a default, but for tests you should pass it explicitly:

```bash
export USER_EMAIL="local@local"
```

## Test data (project/feature)

Pick one stable project + feature for smoke tests (don’t rotate constantly):

```bash
export PROJECT_ID="probe"
export FEATURE_NAME="skeleton"
```

If they don’t exist yet, create them via API (see `02-local-runbook.md`).

---

## Smoke 1 — API can enqueue a job and status is readable

### Action

Execute a code job:

```bash
curl -sS -X POST \
  "http://localhost:4100/api/projects/${PROJECT_ID}/features/${FEATURE_NAME}/execute?user-email=${USER_EMAIL}" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "code",
    "agent": "architect",
    "chatSource": true
  }'
```

### Assert (PASS conditions)

- Response JSON contains `jobId`.
- `GET /jobs/:jobId/status` returns 200 and shows a known status (`queued|running|completed|failed|paused`).

```bash
export JOB_ID="<paste-from-response>"

curl -sS \
  "http://localhost:4100/api/jobs/${JOB_ID}/status?user-email=${USER_EMAIL}"
```

### If FAIL

- 500 on execute: API server issue (route is `packages/ant-cli/src/periphery/adapters/http/routes/job.routes.ts`).
- 404 on status: job mapping/status not written to Redis (check Redis + JobQueue enqueue path in `RouteConfigurator.ts`).

---

## Smoke 2 — Unified SSE initial state arrives (kanban/chat/fileTree)

### Action

Open an SSE connection:

```bash
curl -N \
  "http://localhost:4101/realtime/projects/${PROJECT_ID}/features/${FEATURE_NAME}/stream?job=code&user-email=${USER_EMAIL}"
```

### Assert (PASS conditions)

Within ~10 seconds, you see at least one `event:` or `data:` block for initial states.

The server sends initial states for:
- `kanban`
- `chat`
- `fileTree`

(Implementation: `packages/ant-cli/src/periphery/adapters/http/routes/sse.routes.ts`)

### If FAIL

- Connection refused: realtime server not running or wrong port.
- Connection opens but no initial states: service error reading session/Redis/workspace; check realtime server logs first.

---

## Smoke 3 — Workflow SSE produces updates for the jobId

### Action

Open workflow SSE:

```bash
curl -N \
  "http://localhost:4101/realtime/jobs/${JOB_ID}/workflow/stream?user-email=${USER_EMAIL}"
```

### Assert (PASS conditions)

Within ~30 seconds, you get either:
- an initial workflow state, or
- at least one workflow update message.

### If FAIL

- No messages at all: worker may not be running / job not executing.
- Unified SSE shows job running but workflow SSE is silent: workflow broadcaster/state not being written to Redis.

---

## Smoke 4 — Stop → resume works (resumable interruption)

### Action

Stop:

```bash
curl -sS -X POST \
  "http://localhost:4100/api/jobs/${JOB_ID}/stop?user-email=${USER_EMAIL}" \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"${PROJECT_ID}\",\"featureName\":\"${FEATURE_NAME}\",\"jobType\":\"code\"}"
```

Resume:

```bash
curl -sS -X POST \
  "http://localhost:4100/api/jobs/${JOB_ID}/resume?user-email=${USER_EMAIL}" \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"${PROJECT_ID}\",\"featureName\":\"${FEATURE_NAME}\",\"chatSource\":true}"
```

### Assert (PASS conditions)

- Resume returns success and keeps (or reuses) the session jobId.
- Status/workflow starts moving again (use Smoke 1/3 checks).

### If FAIL

- 404 “No interrupted job found”: session files don’t contain an interruption + taskQueue; verify the stop path and session persistence.

---

## Smoke 5 — Continue (revise) triggers additional activity (does not dead-end)

### Action

```bash
curl -sS -X POST \
  "http://localhost:4100/api/jobs/${JOB_ID}/continue?user-email=${USER_EMAIL}" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\":\"${PROJECT_ID}\",
    \"featureName\":\"${FEATURE_NAME}\",
    \"newDirective\":\"Make a tiny safe change and then stop.\",
    \"chatSource\":true
  }"
```

### Assert (PASS conditions)

- API returns success.
- Workflow SSE shows new activity (new nodes, transitions) OR job status progresses beyond idle.

### If FAIL

- 404 “Job not found in session files”: session file mismatch (jobId not recorded where you expect); inspect session resolution logic in `job.routes.ts`.

