# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development

```bash
# Start infrastructure (Redis + ChromaDB via Docker)
pnpm dev:infra

# Local mode (all processes together)
pnpm dev:local:all

# Local mode (individual processes)
pnpm dev:local          # API server (port 4100)
pnpm dev:realtime-server  # Realtime SSE server (port 4101)
pnpm dev:job-worker     # BullMQ job worker
pnpm dev:preview-worker # Preview server (port 4102)

# Frontend only
pnpm dev:ui             # Vite dev server
```

### Build & Test

```bash
pnpm build              # Build all packages (runs tests first)
pnpm build:cli          # Build ant-cli only
pnpm build:ui           # Build ant-ui only

pnpm test:cli           # Run ant-cli tests (vitest)
# Or from packages/ant-cli:
pnpm test

# Run a single test file
cd packages/ant-cli && pnpm vitest run tests/triage-parser.test.ts
```

Test files live in `packages/ant-cli/tests/` and match `tests/**/*.test.ts`. Build runs tests as a prebuild gate — failing tests abort the build.

### Workspace Init

```bash
pnpm init:workspace     # Initialize a new workspace
pnpm init:feature       # Initialize a new feature
```

### Native-Binary Dependencies (pnpm build-deps whitelisting)

pnpm 10+ blocks `postinstall` scripts by default. Packages that download native binaries during `postinstall` (e.g. `@vscode/ripgrep`, `sharp`) must be whitelisted in `package.json` → `pnpm.onlyBuiltDependencies`. A missing entry produces silent `ENOENT` at runtime when the binary is invoked.

If `search_code` / ripgrep-dependent tools fail with `ENOENT` (spawn rg), inspect `node_modules/.pnpm/@vscode+ripgrep@*/node_modules/@vscode/ripgrep/bin/` — an empty `bin/` means postinstall was skipped. Recovery:

```bash
cd node_modules/.pnpm/@vscode+ripgrep@*/node_modules/@vscode/ripgrep \
  && env -u GITHUB_TOKEN -u GH_TOKEN node ./lib/postinstall.js --force
```

An invalid `GITHUB_TOKEN` / `GH_TOKEN` in the shell env causes the download to fail with `401`; unset them for the postinstall run (the script falls back to anonymous public release downloads).

**Docker builds: never pass `--ignore-scripts` to `pnpm install`.** That flag overrides the `onlyBuiltDependencies` whitelist and silently skips ripgrep's binary download, producing the same ENOENT inside the container. `packages/ant-cli/Dockerfile` runs an explicit `test -x .../@vscode/ripgrep/bin/rg` after each install so a regression fails the image build instead of surfacing at runtime.

## Architecture

### Monorepo Structure

| Package | Role |
|---------|------|
| `@ant/cli` (`packages/ant-cli`) | Backend: API server, Job worker, Realtime server, Preview server |
| `@ant/ui` (`packages/ant-ui`) | Frontend: React + Vite SPA |
| `@ant/shared` (`packages/ant-shared`) | Shared TypeScript types only — no runtime code |

`@ant/shared` is referenced directly from source (no build step) via pnpm workspace.

### Backend: Modular Monolith with 4 Processes

`ant-cli` is a single codebase deployed as 4 separate processes. The entry point and environment variables determine each process's role:

| Process | Port | Entry Point |
|---------|------|-------------|
| ant-api | 4100 | `composition/server.ts` |
| ant-realtime | 4101 | `infrastructure/realtime/start-realtime-server.ts` |
| ant-job | — | `infrastructure/worker/start-job-worker.ts` |
| ant-preview | 4102 | `infrastructure/preview/start-preview-server.ts` |

Inter-process communication is exclusively via Redis (Pub/Sub, Key-Value, BullMQ). No direct HTTP between processes.

**Local vs Cloud mode**: Identical code paths. Only authentication differs — local uses a fixed `local:local` tenant; cloud uses OAuth. Set via `ANT_SERVER_MODE=local|cloud`.

### Backend Internal Structure (Hexagonal Architecture)

```
src/
  composition/       # Entry points (server.ts, job-runner.ts, orchestrator.ts, gracefulShutdown.ts)
  core/              # Domain logic: usecases, ports (interfaces), prompt engine, types
  agents/            # LangGraph agent implementations (architect, planner, creator, common)
  infrastructure/    # Technical adapters: queue, worker, realtime, IDE, preview, workspace
  periphery/         # External adapters: HTTP (Express), auth, git, LLM, memory, filesystem, integrations
  cli/               # CLI runtime: Commander.js parser, command handlers, init, help
  utils/             # Shared utilities: logger, humanId, languageUtils, userConfig
```

### Job Lifecycle

1. **Enqueue**: API receives HTTP request → enqueues to BullMQ (`ant-jobs` queue in Redis)
2. **Dequeue & Spawn**: `JobWorker` dequeues → spawns `job-runner.ts` as a child process (env vars passed via whitelist, not `...process.env`)
3. **Orchestrate**: Child process runs `orchestrator.ts` → routes to LangGraph agent graph by `agent + jobType`
4. **Execute**: Agent graph runs nodes (LLM calls, file I/O, tools); state broadcast via Redis Pub/Sub
5. **Complete**: `job:status:updates` channel notifies API server → frontend updated

| JobType | Agent | Output |
|---------|-------|--------|
| `code` | architect | Source code |
| `design` | architect | Design docs (MD, JSON) |
| `learn` | architect | Vector DB index |
| `plan` | planner | PRD |
| `ask` / `inline-ask` | architect | Chat response |

Jobs support interruption and resumption. Checkpoints are saved to `{featurePath}/sessions/{agent}/{jobType}.json`.

### Agent Architecture

All agents are implemented as **LangGraph StateGraphs**. Each graph has:
- A `resolve` node (loads state, determines resume path)
- A `triage` node (intent classification, routing)
- Job-specific execution nodes
- A `learn` node (saves session, ends workflow)

The **architect** agent has separate sub-graphs for each job type: `runCodeGraph()`, `runDesignGraph()`, `runLearnGraph()`, `runInlineAsk()`. The **planner** agent runs `runPlanGraph()`.

Parallel task execution uses `TaskOrchestrator` / `TaskWorker` pattern (active when `ANT_TASK_CONCURRENCY > 1`, default 3). Tasks have `exclusive`, `parallelGroup`, and `priority` attributes controlling scheduling. Worker subgraphs are separate `StateGraph` instances — they must declare all channels they need. Channel definitions use the SSOT pattern: main graph exports `CodeGraphChannels` / `DesignGraphChannels`, worker subgraph spreads it (`...CodeGraphChannels`). New channels go in `*GraphChannels` only.

### Prompt System

Prompts follow a **WHAT/HOW separation**:
- `base-*.md` templates: context, data, task definition (no rules/constraints)
- `rules-*.md` templates: rules, format, constraints (no dynamic data)

Templates live in `core/prompt/templates/` and are rendered via Handlebars. The **6-stage PromptEngine pipeline**: InputNormalizer → ContextAssembler → ModeController → TemplateComposer → PolicyInjector → PromptFormatter.

All prompt templates are auto-registered as Handlebars partials at server startup via `initPartials()`. Adding/removing/renaming a `.md` file in `templates/` requires no code change.

**FPOP principle** for writing prompts: Principles over Examples, What over How, Observable over Assumed, Universal over Specific, Constraints over Instructions.

**SBS principle** (complement to FPOP): specificity is bounded by activation scope. Gated templates (techTier / intent / taskType / mode / role / artifact-presence) MUST be specific along the gate's axis; always-on templates MUST stay universal. Citing FPOP's "Universal over Specific" against a gated file to demand its discriminator name be removed is itself an SBS violation. See `.cursorrules` §5 and [docs/architecture/13-prompt-system.md](docs/architecture/13-prompt-system.md) "SBS 원칙".

**Mock-use prompt SSOTs (MECE)** — three orthogonal partials cover the mock surface, do NOT merge them:

| Partial | Scope | Activation |
|---------|-------|------------|
| [`mock-adapter-contract`](packages/ant-cli/src/core/prompt/templates/jobs/code/base/injections/mock-adapter-contract.md) | Mock data body (text, count, timestamp, IDs) via port/adapter | unconditional in plan/execute |
| [`mock-content-imagery`](packages/ant-cli/src/core/prompt/templates/jobs/code/base/injections/mock-content-imagery.md) | Content imagery (user-uploaded / DB-fetched images: avatar, thumbnail, cover) | gate = `service ∧ hasFrontend ∧ taskType==='feature'`, derived in code by [`isMockContentImageryActive`](packages/ant-cli/src/core/prompt/builder/mockContentImageryGate.ts) (Domain-Branching Locality I1) and surfaced as `mockContentImageryActive` boolean to plan + execute rules.md |
| `ui-source-*` (`ui-assets.json`) | Design-system assets (logo, icon, decorative illustration) | per-source via `ui-source-dispatch` (ui/design-system tasks) |

Regression guards: [tests/mock-content-imagery.test.ts](packages/ant-cli/tests/mock-content-imagery.test.ts) locks the gate matrix end-to-end (10-row truth table × 2 nodes = 20 render cases + body discipline + wiring checks).

### Frontend Architecture (ant-ui)

Clean Architecture layers:
- `presentation/` → `application/` → `domain/` ← `infrastructure/`
- Presentation uses Application hooks only (no direct domain access)

State is managed by a single **Zustand store** with 12 slices (project, file, job, sse, ui, git, preview, auth, config, chat, transfer, reset). Slices that represent remote resources store flat `AsyncFields<T>` (status / data / error / refreshing); see [docs/architecture/ui-async-policy.md](docs/architecture/ui-async-policy.md).

**Async UI Policy**: every loading / empty / error state flows through `<AsyncBoundary>` with one of five surfaces (page / panel / region / modal / inline) plus an ambient nav-bar progress bar. `Loader2` + `animate-spin` + `animate-pulse` are confined to the `common/async/primitives/` directory; ESLint and `pnpm legacy:sweep` enforce the boundary. Read `docs/architecture/ui-async-policy.md` before adding a new fetch, spinner, or status indicator.

Backend communication:
- **HTTP**: `infrastructure/http/api.ts` — local uses Vite proxy to `localhost:4100/4101`
- **SSE**: `infrastructure/sse/SSEManager.ts` singleton — unified stream + workflow stream; auto-reconnect with exponential backoff

**i18n**: i18next with `en/` and `ko/` locales, split by domain (artifacts, chat, common, config, etc.).

### Shared Types (`@ant/shared`)

Key types for cross-package contracts:
- `JobType`, `DecomposableJobType`, `SessionableJobType` — job classification
- `KanbanData`, `BaseTask`, `TaskStatus` — task queue state
- `WorkflowRealtimeState` — real-time workflow SSE events
- `InterruptionDetails`, `InterruptionReason` — job interruption metadata
- `InferredAction`, `Mode`, `IntentGroup` — detection types
- `ResolvedActionContext`, `TechTier`, `ResolvedArtifact` — RAC and tech tier

### Environment Variables

Key variables for `packages/ant-cli/.env`:
- `ANT_SERVER_MODE`: `local` (default) or `cloud`
- `ANT_REDIS_URL`: Redis connection URL (required for cloud; local uses Docker)
- `ANT_ENCRYPTION_KEY`: Encryption key (required)
- `ANT_WORKSPACE_BASE_PATH`: Physical workspace storage path
- `ANT_TASK_CONCURRENCY`: Parallel task count (default: 3)
- `ANT_PREVIEW_WORKERS`: Preview worker URL (cloud)
- `ANT_K8S_NAMESPACE`: Kubernetes namespace for IDE (uses Docker if unset)

## Documentation

Detailed architecture docs are in `docs/architecture/` (00–17). Testing strategy is in `docs/testing/`.

## Enforcement

Workspace 1차 분류 축이 도메인 의미(`plan` / `architecture` / `visual` / `assets` / `meta` / `sessions` / `codebase`)로 정렬된 후, 옛 I/O 트리 경로 잔존을 막는 manual sweep:

```bash
# ripgrep 의 `ts` 타입은 *.ts / *.tsx / *.cts / *.mts 를 모두 매칭한다 (`rg --type-list` 참고).
rg "outputs/design|inputs/sources|inputs/assets|inputs/references|inputs/directives|outputs/evals" \
  packages/ant-cli/src packages/ant-shared/src packages/ant-ui/src \
  packages/ant-cli/src/core/prompt/templates docs \
  --type ts --type md \
  --glob '!**/changelog/**' \
  --glob '!**/migrate-workspace-layout.mjs' \
  --glob '!**/legacy-path-residue.test.ts' \
  --glob '!**/no-legacy-references.test.ts' \
  --glob '!**/docs/tmp/**'
# Expected: 0 matches
```

자동 회귀 가드는 [packages/ant-cli/tests/legacy-path-residue.test.ts](packages/ant-cli/tests/legacy-path-residue.test.ts) 가 담당; 위 명령은 수동 sweep.

디스크 마이그레이션은 1회성: `pnpm migrate:workspace --apply --workspaces-path <ANT_WORKSPACE_BASE_PATH>`.
