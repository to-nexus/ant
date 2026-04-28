# ANT Works

AI 에이전트 기반 소프트웨어 개발 플랫폼.

> **이 파일의 역할**: 레포지토리 진입점. 구조와 실행 방법을 빠르게 파악하는 데 집중한다. 세부 설계는 `docs/architecture/`를 참고하라.

## 패키지 구성

| 패키지 | 이름 | 역할 |
|--------|------|------|
| [ant-cli](packages/ant-cli/) | `@ant/cli` | 백엔드. API 서버, Job Worker, Realtime 서버, Preview 서버 |
| [ant-ui](packages/ant-ui/) | `@ant/ui` | 프론트엔드. React + Vite SPA |
| [ant-shared](packages/ant-shared/) | `@ant/shared` | 공유 타입. 패키지 간 타입 계약 (런타임 코드 없음) |

## 프로세스 구조

단일 코드베이스(ant-cli)에서 4개 프로세스로 분리 배포되는 Modular Monolith 구조.

| 프로세스 | 역할 | 포트 (로컬) |
|----------|------|------------|
| ant-api | REST API, IDE 프록시 | 4100 |
| ant-realtime | SSE 연결 관리 | 4101 |
| ant-job | BullMQ Job Worker | - |
| ant-preview | Dev Server 생명주기, Preview 프록시 | 4102 |

프로세스 간 통신은 Redis(Pub/Sub, Key-Value, BullMQ)를 통해 이루어진다. Local과 Cloud 모드의 코드 경로는 동일하며, 인프라가 실행되는 위치만 다르다.

## 에이전트

| Agent | 역할 | Job 타입 |
|-------|------|----------|
| architect | 설계, 구현, 학습, 질의응답 | design, code, learn, ask, inline-ask |
| planner | PRD 작성/수정 | plan |
| reviewer | 코드 리뷰 (stub) | review |
| doc | 문서 생성 (stub) | doc |

## 빠른 시작

```bash
# 인프라 기동 (Redis + ChromaDB)
pnpm dev:infra

# 전체 프로세스 동시 실행
pnpm dev:local:all
```

개별 프로세스 실행이 필요하면:

```bash
pnpm dev:local          # API 서버 (4100)
pnpm dev:realtime-server  # Realtime SSE 서버 (4101)
pnpm dev:job-worker     # BullMQ Job Worker
pnpm dev:preview-server # Preview 서버 (4102)
pnpm dev:ui             # 프론트엔드 Vite dev server
```

## 빌드 & 테스트

```bash
pnpm build              # 전체 빌드 (테스트 선행)
pnpm test:cli           # ant-cli 테스트 (vitest)
```

## 기술 스택

**백엔드**: Node.js 18+, TypeScript, Express, LangGraph, Anthropic/OpenAI SDK, BullMQ, ioredis, Handlebars, Zod

**프론트엔드**: React 18, Vite, Zustand, Tailwind CSS, Radix UI, ReactFlow

**인프라**: pnpm workspaces, Redis, Docker, Kubernetes, EFS

## 문서

### 설계 문서 (`docs/architecture/`)

**Foundation**
- [00 System Overview](docs/architecture/00-system-overview.md)
- [01 Shared Contracts](docs/architecture/01-shared-contracts.md)
- [02 Infrastructure](docs/architecture/02-infrastructure.md) — Redis 키/채널, BullMQ, 환경변수

**Job 실행 파이프라인**
- [10 Job Lifecycle](docs/architecture/10-job-lifecycle.md)
- [11 Agent Architecture](docs/architecture/11-agent-architecture.md)
- [12 Triage & Routing](docs/architecture/12-triage-routing.md)
- [13 Prompt System](docs/architecture/13-prompt-system.md)
- [14 Code Job](docs/architecture/14-code-job.md)
- [15 Design Job](docs/architecture/15-design-job.md)
- [16 Planner Job](docs/architecture/16-planner-job.md)
- [17 Ask System](docs/architecture/17-ask-system.md)

**실행 환경 (Runtime)**
- [20 Workspace & Isolation](docs/architecture/20-workspace-isolation.md)
- [21 Realtime System](docs/architecture/21-realtime-system.md)
- [22 Preview System](docs/architecture/22-preview-system.md)
- [23 Cloud IDE](docs/architecture/23-cloud-ide.md)
- [24 Git Operations](docs/architecture/24-git-operations.md)

**프론트엔드**
- [30 Frontend Architecture](docs/architecture/30-frontend-architecture.md)
- [31 Chat System](docs/architecture/31-chat-system.md)

### 기타 문서

- [Testing](docs/testing/) — 핵심 스모크 테스트, 로컬 런북, CI 게이트
- [Cloud Deployment](docs/infra/cloud-deployment-guide.md) — EKS 배포 가이드 (DevOps)
- [Figma → UI Docs](docs/figma/figma-to-ui-docs-workflow.md) — Figma에서 ui-tokens/ui-spec 추출 워크플로우
- [Rubrics](docs/rubric/) — Code/PRD/Design 산출물 평가 기준

## 라이선스

MIT
