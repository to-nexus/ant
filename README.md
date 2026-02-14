# ANT Works

AI 에이전트 기반 소프트웨어 개발 플랫폼.

## 패키지 구성

| 패키지 | 이름 | 역할 |
|--------|------|------|
| [ant-cli](packages/ant-cli/) | `@ant/cli` | 백엔드. API 서버, Job Worker, Realtime 서버, Preview 서버 |
| [ant-ui](packages/ant-ui/) | `@ant/ui` | 프론트엔드. React + Vite SPA |
| [ant-shared](packages/ant-shared/) | `@ant/shared` | 공유 타입. 패키지 간 타입 계약 |

## 아키텍처

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
| planner | PRD 작성/수정 | plan |
| architect | 설계, 구현, 학습, 질의응답 | design, code, learn, ask |
| reviewer | 코드 리뷰 (예정) | review |
| doc | 문서 생성 (예정) | doc |

## 기술 스택

**백엔드**: Node.js 18+, TypeScript, Express, LangGraph, Anthropic/OpenAI SDK, BullMQ, ioredis, Handlebars, Zod

**프론트엔드**: React 18, Vite, Zustand, Tailwind CSS, Radix UI, ReactFlow

**인프라**: pnpm workspaces, Redis, Docker, Kubernetes, EFS

## 문서

- [Architecture](docs/architecture/) - 시스템 설계 문서
- [Guides](docs/guides/) - 사용 가이드
- [Testing](docs/testing/) - 테스트 전략

## 라이선스

MIT
