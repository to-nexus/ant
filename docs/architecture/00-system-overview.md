# System Overview

## 개요

ANT는 AI 에이전트 기반 소프트웨어 개발 플랫폼이다. pnpm 모노레포로 구성되며, 단일 코드베이스(ant-cli)에서 4개 프로세스로 분리 배포되는 Modular Monolith 구조를 따른다.

## 패키지 구성

| 패키지 | npm 이름 | 역할 |
|--------|----------|------|
| `ant-cli` | `@ant/cli` | 백엔드. API 서버, Job Worker, Realtime 서버, Preview 서버 |
| `ant-ui` | `@ant/ui` | 프론트엔드. React + Vite SPA |
| `ant-shared` | `@ant/shared` | 공유 타입. 패키지 간 계약 정의 |

`ant-cli`는 배포 시 역할별로 4개 프로세스로 실행된다. 코드베이스는 하나이며, 진입점과 환경변수로 역할이 결정된다.

## 프로세스 토폴로지

| 프로세스 | 포트 (로컬) | 진입점 | 역할 |
|----------|------------|--------|------|
| ant-api | 4100 | `composition/server.ts` | REST API, IDE 프록시, 정적 파일 서빙 |
| ant-realtime | 4101 | `infrastructure/realtime/start-realtime-server.ts` | SSE 연결 관리, Redis Pub/Sub 구독 |
| ant-job | - | `infrastructure/worker/start-job-worker.ts` | BullMQ Worker, 자식 프로세스(job-runner) 스폰 |
| ant-preview | 4102 | `infrastructure/preview/start-preview-server.ts` | Dev Server 생명주기, Preview 프록시 |

프로세스 간 통신은 Redis를 통해 이루어진다. 직접적인 프로세스 간 HTTP 호출은 없다.

## 배포 모델

### Local 모드

단일 머신에서 4개 프로세스가 실행된다. Redis는 Docker Compose로 로컬에 기동한다. 인증은 `local:local` 고정 테넌트를 사용한다. 파일 저장은 로컬 파일시스템이다.

### Cloud 모드

Kubernetes 환경에서 각 프로세스가 독립 Pod으로 배포된다. Redis는 ElastiCache, 파일 저장은 EFS(NFS)를 사용한다. 인증은 OAuth 기반이다.

| 서비스 | 스케일링 | LB 정책 |
|--------|---------|---------|
| ant-api | HPA (CPU) | Round-robin |
| ant-realtime | KEDA (connections) | Round-robin |
| ant-job | KEDA (queue depth) | N/A (큐 기반) |
| ant-preview | HPA (CPU) | Round-robin |

모든 서비스가 Redis 기반 상태 관리를 사용하므로 Sticky Session이 불필요하다.

### Ingress 라우팅

| 호스트 | 경로 | 대상 |
|--------|------|------|
| `ant.crosstoken.io` | `/realtime/*` | ant-realtime |
| `ant.crosstoken.io` | `/api/*` | ant-api |
| `ant.crosstoken.io` | `/ide/*` | ant-api |
| `ant.crosstoken.io` | `/*` | ant-api (default) |
| `ant-preview.crosstoken.io` | `/*` | ant-preview |

Preview는 별도 호스트를 사용한다. SSR 앱의 절대 경로 리소스가 URI 기반 라우팅을 우회하는 문제를 호스트 기반 라우팅으로 해결한다.

## 기술 스택

### 백엔드 (ant-cli)

- Runtime: Node.js 18+, TypeScript 5.0+
- Web: Express
- AI: LangGraph, @langchain/*, Anthropic SDK, OpenAI SDK
- Queue: BullMQ, ioredis
- Template: Handlebars
- Validation: Zod
- VCS: simple-git

### 프론트엔드 (ant-ui)

- Framework: React 18, Vite
- State: Zustand
- Styling: Tailwind CSS
- UI: Radix UI, Lucide React, Framer Motion
- Visualization: ReactFlow (워크플로우 그래프)

### 인프라

- Monorepo: pnpm workspaces
- Container: Docker (로컬 IDE), Kubernetes (클라우드)
- Storage: Redis (상태, Pub/Sub, 큐), EFS (파일)

## 환경별 차이

| 항목 | Local | Cloud |
|------|-------|-------|
| 인증 | `local:local` 자동 | OAuth |
| 상태 저장 | Redis | Redis |
| Job 큐 | BullMQ | BullMQ |
| 파일 저장 | 로컬 FS | EFS |
| IDE | Docker 컨테이너 | Kubernetes Pod |
| Preview | 로컬 프로세스 | Pod 내 프로세스 |

Local과 Cloud의 코드 경로는 동일하다. 인프라가 실행되는 위치만 다르다.

## 경계

- 각 프로세스의 내부 구조: 해당 프로세스별 문서 참조
- Redis 키/채널 규약: [02-infrastructure.md](02-infrastructure.md)
- Job 실행 흐름: [10-job-lifecycle.md](10-job-lifecycle.md)
- 프론트엔드 아키텍처: [30-frontend-architecture.md](30-frontend-architecture.md)
