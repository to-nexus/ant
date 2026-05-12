# 아키텍처 개요

Ant은 **모듈형 모놀리스 (modular monolith)** 입니다. 단일 코드베이스가
4개의 독립 프로세스로 분리되어, 오직 Redis 통해서만 통신합니다. 같은
코드 경로가 로컬과 클라우드(쿠버네티스) 환경에서 동일하게 돕니다.
로컬 모드는 단지 "모든 프로세스가 한 머신 안에" 일 뿐입니다.

회귀급 (regression-grade) SSOT는
[internals/00-system-overview.md](../../internals/00-system-overview.md)
참고.

## 프로세스 토폴로지

```
┌──────────────────────┐      ┌──────────────────────┐      ┌──────────────────────┐
│   ant-api    :4100   │      │   ant-realtime :4101 │      │   ant-preview :4102  │
│ REST + IDE proxy     │      │   chat / workflow    │      │   feature별 dev      │
│ + auth                │     │   SSE 스트림         │      │   server lifecycle   │
└──────────┬───────────┘      └──────────┬───────────┘      └──────────┬───────────┘
           │                              │                              │
           └────────────── Redis: Pub/Sub + KV + BullMQ ────────────────┘
                                          │
                              ┌───────────┴───────────┐
                              │   ant-job             │
                              │   BullMQ worker.      │
                              │   요청마다 job-runner │
                              │   spawn               │
                              └───────────┬───────────┘
                                          │
                                          ▼
                                ┌─────────────────────┐
                                │   job-runner        │
                                │   child process.    │
                                │   잡별 LangGraph    │
                                │   에이전트 실행      │
                                └─────────────────────┘
```

| 프로세스      | 포트 | Entry point                                                |
|---------------|------|------------------------------------------------------------|
| `ant-api`     | 4100 | `composition/server.ts`                                    |
| `ant-realtime`| 4101 | `infrastructure/realtime/start-realtime-server.ts`         |
| `ant-job`     | —    | `infrastructure/worker/start-job-worker.ts`                |
| `ant-preview` | 4102 | `infrastructure/preview/start-preview-server.ts`           |

**프로세스 간 직접 HTTP는 없습니다.** 모든 cross-process 호출은 Redis
경유: BullMQ가 잡 큐, Pub/Sub가 상태/라이프사이클 이벤트, KV가
정규 상태 (kanban 스냅샷, 잡 완료 플래그, 사용자 정지 마커).

## 왜 4개 프로세스인가

각 프로세스가 단일 책임을 갖습니다:

- `ant-api`는 사용자 측 edge. 요청 검증, 인증, 작업 enqueue. 잡이
  무거워도 응답성이 유지되어야 함.
- `ant-realtime`은 streaming edge. 챗 토큰과 workflow 이벤트의 SSE
  연결이 여기 살아 REST 트래픽과 경합하지 않음.
- `ant-job`은 LangGraph 에이전트 실행. 요청마다 `job-runner` child
  process를 spawn해서 한 잡의 오작동이 worker 자체를 망가뜨리지
  못하게 함.
- `ant-preview`는 dev server 관리. feature마다 자체 preview server
  (자체 포트, 자체 proxy 엔트리). 라이프사이클은 Redis pub/sub로
  reference-counted.

4개 모두 `pnpm dev:all` 로 노트북 위에 뜹니다 (`:cloud` 는
토폴로지 이름이고 배포 대상이 아닙니다 — `.env` 의
`ANT_SERVER_MODE=local` 이 로컬 테넌트 인증을 활성화). 클라우드
프로덕션에선 각각 별도 K8s Deployment.

## 무엇이 어디로 흐르나

| 채널                             | Producer        | Consumer        | Payload                            |
|---------------------------------|-----------------|-----------------|-----------------------------------|
| BullMQ 큐 `ant-jobs`             | ant-api         | ant-job         | 잡 디스크립터 (id, type, args)     |
| Redis Pub/Sub `chat:tokens:*`   | job-runner      | ant-realtime    | 스트리밍 LLM 토큰                  |
| Redis Pub/Sub `workflow:*`      | job-runner      | ant-realtime    | LangGraph 노드 라이프사이클        |
| Redis Pub/Sub `job:status:*`    | job-runner      | ant-api         | 터미널 잡 상태                     |
| Redis Pub/Sub `lifecycle:*`     | ant-api         | ant-preview     | cleanup ack/request                |
| Redis KV `state:*`              | job-runner      | ant-api / job   | 정규 상태 스냅샷                   |

전체 키 카탈로그:
[internals/02-infrastructure.md](../../internals/02-infrastructure.md) (영문).

## 코드베이스 안 구조

`packages/ant-cli/src/` 는 hexagonal 레이아웃을 따릅니다:

```
composition/    Entry point. 다른 건 안 둠. DI 와이어링.
core/           도메인 로직, prompt 엔진, 타입, port (interface).
agents/         LangGraph 에이전트 그래프 (architect, planner).
infrastructure/ 어댑터: queue, worker, realtime, IDE, preview.
periphery/      외부 어댑터: HTTP, auth, git, LLM, memory, filesystem.
cli/            CLI 런타임 — Commander 파서, 커맨드 핸들러.
utils/          공유 유틸.
```

방향성은 일방향: `composition/` 은 모든 것에 의존, `core/` 는 자기
자신에만 의존. `infrastructure/` 와 `periphery/` 의 어댑터는
`core/ports/` 에 정의된 port를 구현합니다.

## 프론트엔드

`packages/ant-ui/` 는 React + Vite SPA, clean architecture 레이어:

```
presentation/     React 컴포넌트, 페이지.
application/      hook, slice — presentation 과 domain 사이 다리.
domain/           Zustand store (15 slices) + domain 타입.
infrastructure/   HTTP, SSE, file system 어댑터.
```

State는 Zustand store 하나에 15개 slice. 합성 순서는
`domain/store/index.ts` 가 SSOT.

## 로컬 vs 클라우드

**같은 데이터 플레인, 다른 운영 관심사.**

| 관심사                      | 로컬                                   | 클라우드                                       |
|-----------------------------|----------------------------------------|------------------------------------------------|
| Redis                       | Docker Compose                         | ElastiCache / 매니지드 Redis                   |
| Worker scale-out            | 1 프로세스                              | K8s Deployment, N replica                      |
| IDE pods                    | 로컬 Docker                             | Kubernetes (KubernetesIDEOrchestrator)         |
| 워크스페이스 스토리지        | 호스트 파일시스템                        | EFS shared volume                              |
| 인증                        | `local:local` 테넌트                    | OAuth (provider configurable)                  |
| Figma MCP                   | Desktop MCP server                      | Cloud HTTP bridge                              |

두 의도된 fork point (인증 테넌트 해석, Figma MCP transport) 가
문서화된 예외. 다른 모든 것은 통일. 구속력 있는 컨트랙트는 영문
[AGENTS.md § Unified Distributed System Principle](../../../AGENTS.md#unified-distributed-system-principle).

## 다음으로 읽을 것

- [spec-driven](spec-driven.md) — 왜 vibe coding을 거부하는지.
- [design-input-channels](design-input-channels.md) — 디자인 입력 3채널.
- 영문 [agents](../../concepts/agents.md), [jobs](../../concepts/jobs.md),
  [execution-tiers](../../concepts/execution-tiers.md), [workspace](../../concepts/workspace.md).
- [internals/](../../internals/) — 풀 SSOT (영문).
