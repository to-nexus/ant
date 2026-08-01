# E2E Smoke Test Runbook

Manual E2E testing: verifies the core flows on top of the infrastructure (Redis, BullMQ, SSE).

---

## Environment Setup

### Prerequisites

- Node.js 20+, Docker (for Redis)

### Starting the servers

```bash
pnpm dev:infra          # Redis + ChromaDB + Visual Processor (Docker)
pnpm dev:all      # 4-process backend + UI + Site
```

### Environment variables

If `.env` is configured, no separate exports are needed. Only the variables the curl tests require:

```bash
export USER_EMAIL="local@local"
export PROJECT_ID="probe"
export FEATURE_NAME="skeleton"
```

### Health check

```bash
curl -sS "http://localhost:4100/api/health" | jq .
curl -sS "http://localhost:4101/health" | jq .
curl -sS "http://localhost:4102/health" | jq .
```

### Creating test data

```bash
# Project (409 = already exists, which is fine)
curl -sS -X POST \
  "http://localhost:4100/api/projects?user-email=${USER_EMAIL}" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"${PROJECT_ID}\"}"

# Feature
curl -sS -X POST \
  "http://localhost:4100/api/projects/${PROJECT_ID}/features?user-email=${USER_EMAIL}" \
  -H "Content-Type: application/json" \
  -d "{\"featureName\":\"${FEATURE_NAME}\",\"language\":\"typescript\"}"
```

---

## Smoke Tests

### Smoke 1 — Job enqueue + status lookup

```bash
# Execute
curl -sS -X POST \
  "http://localhost:4100/api/projects/${PROJECT_ID}/features/${FEATURE_NAME}/execute?user-email=${USER_EMAIL}" \
  -H "Content-Type: application/json" \
  -d '{"task":"code","agent":"architect","chatSource":true}'

# Status
export JOB_ID="<jobId from the response>"
curl -sS "http://localhost:4100/api/jobs/${JOB_ID}/status?user-email=${USER_EMAIL}"
```

**PASS**: jobId returned; status is one of `queued|running|completed|failed|paused`.
**FAIL**: 500 → API route problem. 404 → Redis/JobQueue problem.

### Smoke 2 — Unified SSE initial state

```bash
curl -N \
  "http://localhost:4101/realtime/projects/${PROJECT_ID}/features/${FEATURE_NAME}/stream?job=code&user-email=${USER_EMAIL}"
```

**PASS**: initial `kanban`, `chat`, `fileTree` state received within ~10s.
**FAIL**: connection refused → Realtime server not running. Connects but no data → check `ANT_WORKSPACE_BASE_PATH`.

### Smoke 3 — Workflow SSE updates

```bash
curl -N \
  "http://localhost:4101/realtime/jobs/${JOB_ID}/workflow/stream?user-email=${USER_EMAIL}"
```

**PASS**: workflow state or update message received within ~30s.
**FAIL**: worker not running, or Redis Pub/Sub not connected.

### Smoke 4 — Stop → Resume

```bash
# Stop
curl -sS -X POST \
  "http://localhost:4100/api/jobs/${JOB_ID}/stop?user-email=${USER_EMAIL}" \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"${PROJECT_ID}\",\"featureName\":\"${FEATURE_NAME}\",\"jobType\":\"code\"}"

# Resume
curl -sS -X POST \
  "http://localhost:4100/api/jobs/${JOB_ID}/resume?user-email=${USER_EMAIL}" \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"${PROJECT_ID}\",\"featureName\":\"${FEATURE_NAME}\",\"chatSource\":true}"
```

**PASS**: resume succeeds, workflow resumes.
**FAIL**: 404 "No interrupted job" → check that the session file / interruption record was saved.

### Smoke 5 — Continue (revise)

```bash
curl -sS -X POST \
  "http://localhost:4100/api/jobs/${JOB_ID}/continue?user-email=${USER_EMAIL}" \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"${PROJECT_ID}\",\"featureName\":\"${FEATURE_NAME}\",\"newDirective\":\"Make a tiny safe change and then stop.\",\"chatSource\":true}"
```

**PASS**: succeeds + new activity in the workflow.
**FAIL**: 404 → jobId not recorded in the session file.

---

## CI Gate Policy

| Gate | Contents |
|--------|------|
| Required | Build + typecheck, `pnpm test:cli` (automated tests), the 5 smoke tests above |
| Not required (currently) | Large unit-test suites, browser UI E2E |

**Flaky test rule**: when a test goes flaky, do not add new tests. Fix it by waiting on state transitions / SSE events instead of sleeping.

---

## Backlog

| Item | Purpose |
|------|------|
| SSE envelope contract test | Lock the initial-state message format |
| Preview proxy routing test | Verify preview reachability |
| Resume stale-interruption guard | Empty taskQueue + completedTasks → 404 regression |
| Daily internal flow suite | One E2E pass of open → chat → job → preview → continue → resume |
