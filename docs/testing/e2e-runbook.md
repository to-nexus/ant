# E2E Smoke Test Runbook

수동 E2E 테스트: 인프라(Redis, BullMQ, SSE) 기반 핵심 플로우 검증.

---

## 환경 설정

### Prerequisites

- Node.js 20+, Docker (Redis용)

### 서버 시작

```bash
# 1. Redis
pnpm dev:infra:redis

# 2. 4개 프로세스 (각각 별도 터미널)
pnpm --filter @ant/cli dev:server            # API (4100)
pnpm --filter @ant/cli dev:realtime-server   # SSE (4101)
pnpm --filter @ant/cli dev:job-worker        # Worker
pnpm --filter @ant/cli dev:preview-server    # Preview (4102)
```

### 환경변수

```bash
export ANT_SERVER_MODE="local"
export ANT_REDIS_URL="redis://localhost:16379"
export ANT_WORKSPACE_BASE_PATH="/Users/probe/dev/ant-workspaces"
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

### 테스트 데이터 생성

```bash
# Project (409 = 이미 존재, 정상)
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

### Smoke 1 — Job enqueue + status 조회

```bash
# Execute
curl -sS -X POST \
  "http://localhost:4100/api/projects/${PROJECT_ID}/features/${FEATURE_NAME}/execute?user-email=${USER_EMAIL}" \
  -H "Content-Type: application/json" \
  -d '{"task":"code","agent":"architect","chatSource":true}'

# Status
export JOB_ID="<응답의 jobId>"
curl -sS "http://localhost:4100/api/jobs/${JOB_ID}/status?user-email=${USER_EMAIL}"
```

**PASS**: jobId 반환, status가 `queued|running|completed|failed|paused` 중 하나.
**FAIL**: 500 → API route 문제. 404 → Redis/JobQueue 문제.

### Smoke 2 — Unified SSE 초기 상태

```bash
curl -N \
  "http://localhost:4101/realtime/projects/${PROJECT_ID}/features/${FEATURE_NAME}/stream?job=code&user-email=${USER_EMAIL}"
```

**PASS**: ~10초 내 `kanban`, `chat`, `fileTree` 초기 상태 수신.
**FAIL**: 연결 거부 → Realtime 서버 미실행. 연결만 되고 데이터 없음 → `ANT_WORKSPACE_BASE_PATH` 확인.

### Smoke 3 — Workflow SSE 업데이트

```bash
curl -N \
  "http://localhost:4101/realtime/jobs/${JOB_ID}/workflow/stream?user-email=${USER_EMAIL}"
```

**PASS**: ~30초 내 workflow state 또는 update 메시지 수신.
**FAIL**: Worker 미실행 또는 Redis Pub/Sub 미연결.

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

**PASS**: Resume 성공, workflow 재개.
**FAIL**: 404 "No interrupted job" → 세션 파일/interruption 저장 확인.

### Smoke 5 — Continue (revise)

```bash
curl -sS -X POST \
  "http://localhost:4100/api/jobs/${JOB_ID}/continue?user-email=${USER_EMAIL}" \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"${PROJECT_ID}\",\"featureName\":\"${FEATURE_NAME}\",\"newDirective\":\"Make a tiny safe change and then stop.\",\"chatSource\":true}"
```

**PASS**: 성공 + workflow에 새 activity.
**FAIL**: 404 → 세션 파일에 jobId 미기록.

---

## CI Gate 정책

| 게이트 | 내용 |
|--------|------|
| 필수 | Build + typecheck, `pnpm test:cli` (자동 테스트), 위 smoke 5개 |
| 불필요 (현재) | 대규모 unit test suite, 브라우저 UI E2E |

**Flaky test 규칙**: flaky 발생 시 새 테스트 추가 금지. sleep 대신 상태 전환/SSE 이벤트 대기로 수정.

---

## Backlog

| 항목 | 목적 |
|------|------|
| SSE envelope contract test | 초기 상태 메시지 형식 잠금 |
| Preview proxy routing test | preview 접근 가능성 확인 |
| Resume stale-interruption guard | 빈 taskQueue + completedTasks → 404 regression |
| Daily internal flow suite | open → chat → job → preview → continue → resume 1회 E2E |
