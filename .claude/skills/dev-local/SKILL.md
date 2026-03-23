---
name: dev-local
description: ANT 로컬 개발 환경을 시작할 때 사용. 개발 서버 기동, 인프라 시작, 환경 설정 확인 시 자동 호출.
disable-model-invocation: true
allowed-tools: Bash, Read
---

ANT 로컬 개발 환경을 기동한다.

## 필수 환경변수 확인

`packages/ant-cli/.env` 파일에 다음이 있어야 한다:

```
ANT_ENCRYPTION_KEY=...     # 필수 — 없으면 서버 시작 시 경고
ANT_SERVER_MODE=local      # local 모드 (인증 없음, local:local 테넌트)
```

Cloud 모드로 실행할 때는 추가로:
```
ANT_REDIS_URL=redis://localhost:16379
ANT_PREVIEW_WORKERS=http://localhost:8080
```

## 기동 순서

**1단계: 인프라 시작** (Redis + ChromaDB)

```bash
pnpm dev:infra
```

Redis가 없으면 Job 큐, 실시간 브로드캐스트, 상태 저장이 모두 동작하지 않는다.

**2단계: 백엔드 + 프론트엔드 동시 시작**

```bash
pnpm dev:local:all
```

또는 개별 프로세스:

```bash
pnpm dev:local          # API 서버 port 4100
pnpm dev:ui             # Vite 프론트엔드
```

Cloud 모드 전체 기동 (4개 프로세스):

```bash
pnpm dev:cloud:all
# 내부적으로: api(4100) + realtime(4101) + job-worker + preview(4102) 동시 실행
```

## 프로세스별 포트

| 프로세스 | 포트 | 용도 |
|----------|------|------|
| ant-api | 4100 | REST API, IDE 프록시 |
| ant-realtime | 4101 | SSE 연결 관리 |
| ant-preview | 4102 | Dev Server 프록시 |
| Vite UI | 5173 | 프론트엔드 (기본값) |

## 인프라만 내리기

```bash
pnpm dev:infra:down          # Redis + ChromaDB
pnpm dev:infra:redis:down    # Redis만
pnpm dev:infra:vector:down   # ChromaDB만
```

## 자주 발생하는 문제

- **`ANT_ENCRYPTION_KEY not found`**: `.env` 파일 경로 확인. 서버 실행 경로 기준 `../../.env` (src/composition 기준)
- **Redis 연결 실패**: `pnpm dev:infra` 실행 후 Docker Desktop이 켜져 있는지 확인
- **포트 충돌**: `lsof -i :4100` 으로 기존 프로세스 확인
