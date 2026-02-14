# @ant/cli

ANT 백엔드 패키지. 단일 코드베이스에서 4개 프로세스(ant-api, ant-realtime, ant-job, ant-preview)로 분리 실행된다.

## 디렉토리 구조

```
src/
    cli/                    CLI 명령 (init workspace, feature)
    composition/            진입점 및 구성
        server.ts           API 서버 진입점
        job-runner.ts       Job 자식 프로세스 진입점
        orchestrator.ts     에이전트 라우팅
        gracefulShutdown.ts SIGTERM 처리
    core/                   도메인 로직
        adapters/           내부 어댑터
        codebase/           코드 검색, 크기 추정
        chat/               ContentMerger, MessageBroadcaster
        llm-response/       LLMResponseService, 핸들러
        ports/              포트 인터페이스 (queue, http, state, workflow)
        prompt/             프롬프트 엔진, 템플릿
        realtime/           KanbanBroadcaster, WorkflowBroadcaster
        streaming/          XMLStreamParser, 렌더링 전략
        types/              공유 타입, processEnv
    agents/                 AI 에이전트 그래프
        architect/          design, code, learn, ask 그래프
        planner/            plan 그래프
        reviewer/           (예정)
        doc/                (예정)
        common/             Triage, AgentRegistry
    infrastructure/         인프라 구현체
        adapters/           InfrastructureFactory, AdapterFactory
        queue/              BullMQJobQueue
        state/              RedisStateStore, redisConstants
        worker/             JobWorker
        realtime/           RealtimeServer
        preview/            PreviewServer
        workspace/          WorkspaceResolver, ArtifactService
        networking/         PortManager
        ide/                IDE 오케스트레이터 (Docker/K8s)
    periphery/              외부 어댑터
        adapters/
            http/           Express 서버, 라우트, 서비스
            llm/            LLMClientFactory
            prompt/         FilePromptAdapter
        integrations/       docker-compose (Redis, Chroma)
```

## 프로세스 모델

| 프로세스 | 진입점 | 기본 포트 |
|----------|--------|----------|
| ant-api | `composition/server.ts` | 4100 |
| ant-realtime | `infrastructure/realtime/RealtimeServer.ts` | 4101 |
| ant-job | `infrastructure/worker/JobWorker.ts` | - |
| ant-preview | `infrastructure/preview/PreviewServer.ts` | 4102 |

## 주요 의존성

| 카테고리 | 패키지 |
|----------|--------|
| AI | @anthropic-ai/sdk, @langchain/*, openai |
| Queue | bullmq, ioredis |
| Web | express, cors, http-proxy-middleware |
| Template | handlebars |
| Validation | zod |
| VCS | simple-git |
| Container | dockerode |

## 환경변수

인프라 환경변수(`ANT_REDIS_URL`, `ANT_SERVER_MODE` 등)와 런타임 환경변수(`ANT_JOB_ID`, `ANT_USER_ID` 등)로 구분된다. 상세는 [01-infrastructure.md](../../docs/architecture/01-infrastructure.md) 참조.
