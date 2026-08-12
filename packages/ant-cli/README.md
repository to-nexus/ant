# @ant/cli

Ant's backend: one codebase deployed as **four processes**. The entry point
and environment decide each process's role; they communicate exclusively over
Redis (Pub/Sub, key-value, BullMQ) — never directly over HTTP.

## Processes

| Process | Entry point | Port |
|---|---|---|
| ant-api | `composition/server.ts` | 4100 |
| ant-realtime | `infrastructure/realtime/start-realtime-server.ts` | 4101 |
| ant-job | `infrastructure/worker/start-job-worker.ts` | — |
| ant-preview | `infrastructure/preview/start-preview-server.ts` | 4102 |

Local and cloud mode share this same data plane. There are no in-memory
fallbacks — if Redis is down, the process fails fast rather than degrading to
an in-process queue.

## Layout

Hexagonal: `core` holds domain logic and port interfaces, `infrastructure`
and `periphery` hold the adapters that implement them.

```
src/
    cli/                    CLI commands (init workspace / feature, index)
    composition/            entry points & wiring
        server.ts           API server
        job-runner.ts       job child process
        orchestrator.ts     composition root — agent routing, DI
        gracefulShutdown.ts SIGTERM handling
    core/                   domain logic — no I/O
        adapters/           internal adapters
        codebase/           code search, size estimation
        chat/               ContentMerger, MessageBroadcaster
        llm-response/       LLMResponseService, decision-tag registry
        ports/              port interfaces (queue, http, state, workflow)
        prompt/             PromptBuilder + Handlebars templates
        realtime/           Kanban / Workflow / Preview / Git broadcasters
        streaming/          XMLStreamParser, SpecialTagTransformer
        executionTier/      the 5-tier strategy matrix
        types/              shared types, processEnv
    agents/                 LangGraph agent graphs
        architect/          code, design, learn, ask sub-graphs
        planner/            plan graph
        creator/            visual graph
        common/             triage, shared tool handlers, RAC loading
    infrastructure/         technical adapters
        adapters/           InfrastructureFactory, AdapterFactory
        queue/              BullMQJobQueue
        state/              RedisStateStore
        worker/             JobWorker
        realtime/           RealtimeServer
        preview/            PreviewServer
        workspace/          WorkspaceResolver, ArtifactService
        networking/         PortManager
        ide/                IDE orchestration (Docker / Kubernetes)
    periphery/              external adapters
        adapters/
            http/           Express server, routes, services
            llm/            LLMClientFactory
            prompt/         FilePromptAdapter
            git/, memory/, auth/, command/
        integrations/       docker-compose sidecars:
                            cache-memory (Redis), vector-memory (ChromaDB),
                            visual-processor
```

## Commands

```bash
# from the repo root
pnpm dev:server            # all four processes
pnpm dev:api-server        # or one at a time
pnpm test:cli
pnpm typecheck:cli

# a single test file
cd packages/ant-cli && pnpm vitest run tests/triage-parser.test.ts
```

Tests live in `tests/` and are **not** part of `tsconfig.json` — that file is
a production artifact copied into the runtime image, since the server boots
via `tsx src/composition/server.ts`. Test type-checking lives in the sibling
`tsconfig.test.json`. Tests do not gate the build; CI is the only gate.

## Dependencies

| Category | Packages |
|---|---|
| AI | @anthropic-ai/sdk, @langchain/*, openai, @google/genai |
| Queue | bullmq, ioredis |
| Web | express, cors, http-proxy |
| Templates | handlebars |
| Validation | zod |
| VCS | simple-git |
| Containers | dockerode |
| Search | @vscode/ripgrep |

## Environment

Split between infrastructure variables (`ANT_REDIS_URL`, `ANT_SERVER_MODE`,
`ANT_ENCRYPTION_KEY`, …) and per-job runtime variables (`ANT_JOB_ID`,
`ANT_USER_ID`, …), which are passed to the job child through an explicit
allowlist rather than inheriting the parent environment.

Start from `.env.example.local` or `.env.example.cloud`. Full reference:
[docs/reference/env-vars.md](../../docs/reference/env-vars.md) and
[docs/internals/02-infrastructure.md](../../docs/internals/02-infrastructure.md).
