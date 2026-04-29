# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This file mirrors [`.cursorrules`](.cursorrules) body verbatim. Both files share an identical body so that Cursor (`.cursorrules`) and Claude Code (`CLAUDE.md`) see the same SSOT. Edit one, sync the other.

---

## Commands

### Development

```bash
# Start infrastructure (Redis + ChromaDB via Docker)
pnpm dev:infra

# Local mode (all processes together)
pnpm dev:local:all

# Local mode (individual processes)
pnpm dev:local            # API server (port 4100)
pnpm dev:realtime-server  # Realtime SSE server (port 4101)
pnpm dev:job-worker       # BullMQ job worker
pnpm dev:preview-server   # Preview server (port 4102)

# Frontend only
pnpm dev:ui               # Vite dev server
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

---

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

**Local vs Cloud mode**: Both modes share the same distributed-system code path (Redis + BullMQ + Pub/Sub). The intentional fork points are auth tenant resolution (`local:local` vs OAuth) and Figma MCP transport (desktop MCP vs cloud bridge — desktop is local-only by nature). There are NO in-memory fallbacks for Redis/BullMQ. Set via `ANT_SERVER_MODE=local|cloud`. See `## Unified Distributed System Principle` below for the binding contract.

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

Templates live in `core/prompt/templates/` and are rendered via Handlebars. The [`PromptBuilder`](packages/ant-cli/src/core/prompt/builder/PromptBuilder.ts) is the single entry point — it replaces the legacy 6-layer PromptEngine pipeline with **4 declarative tiers** (Tier I = injections, A = agents, D = domain/job, N = nodes) and a single `build(config)` call. It returns both merged system/user strings and granular sections for cache-block-aware callers.

All prompt templates are auto-registered as Handlebars partials at server startup via `initPartials()`. Adding/removing/renaming a `.md` file in `templates/` requires no code change — except files under `templates/basis/**`, which are intentionally NOT registered as partials (see "Basis Partial Invariant" below).

**FPOP principle** for writing prompts: Principles over Examples, What over How, Observable over Assumed, Universal over Specific, Constraints over Instructions, Reminders for Blind Spots. See `## Prompt Engineering` below for the full workflow + checklist.

**SBS principle** (complement to FPOP): specificity is bounded by activation scope. Gated templates (techTier / intent / taskType / mode / role / artifact-presence) MUST be specific along the gate's axis; always-on templates MUST stay universal. Citing FPOP's "Universal over Specific" against a gated file to demand its discriminator name be removed is itself an SBS violation.

**Mock-use prompt SSOTs (MECE)** — three orthogonal partials cover the mock surface, do NOT merge them:

| Partial | Scope | Activation |
|---------|-------|------------|
| [`mock-adapter-contract`](packages/ant-cli/src/core/prompt/templates/jobs/code/base/injections/mock-adapter-contract.md) | Mock data body (text, count, timestamp, IDs) via port/adapter | unconditional in plan/execute |
| [`mock-content-imagery`](packages/ant-cli/src/core/prompt/templates/jobs/code/base/injections/mock-content-imagery.md) | Content imagery (user-uploaded / DB-fetched images: avatar, thumbnail, cover) | gate = `service ∧ hasFrontend ∧ taskType==='feature'`, Handlebars-gated `{{> }}` in plan + execute rules.md |
| `ui-source-*` (`ui-assets.json`) | Design-system assets (logo, icon, decorative illustration) | per-source via `ui-source-dispatch` (ui/design-system tasks) |

Regression guards: [tests/mock-content-imagery.test.ts](packages/ant-cli/tests/mock-content-imagery.test.ts) locks the gate matrix end-to-end (10-row truth table × 2 nodes = 20 render cases + body discipline + wiring checks).

### Frontend Architecture (ant-ui)

Clean Architecture layers:
- `presentation/` → `application/` → `domain/` ← `infrastructure/`
- Presentation uses Application hooks only (no direct domain access)

State is managed by a single **Zustand store with 15 slices** composed in [`packages/ant-ui/src/domain/store/index.ts`](packages/ant-ui/src/domain/store/index.ts) (the spread order is the SSOT):

```
project, file, job, sse, ui, gitWorld, preview, auth, config,
projectConfig, reset, chat, featureLog, transfer, deploy
```

`gitWorld` is composed from `application/git-world/createGitWorldSlice` — there is no `gitSlice.ts` under `domain/store/slices/`. Slices that represent remote resources store flat `AsyncFields<T>` (status / data / error / refreshing); see [docs/architecture/ui-async-policy.md](docs/architecture/ui-async-policy.md).

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

---

## Documentation

Detailed architecture docs live in [`docs/architecture/`](docs/architecture). The numeric range is currently **00–35**, with three intentionally-shared prefixes for distinct topics:

- `17-` → [`17-ask-system.md`](docs/architecture/17-ask-system.md), [`17-verification-consolidation-handoff.md`](docs/architecture/17-verification-consolidation-handoff.md)
- `18-` → [`18-visual-job.md`](docs/architecture/18-visual-job.md), [`18-session-redesign.md`](docs/architecture/18-session-redesign.md)
- `35-` → [`35-codebase-meta-policy.md`](docs/architecture/35-codebase-meta-policy.md), [`35-token-usage-tracking.md`](docs/architecture/35-token-usage-tracking.md)

Two documents have no numeric prefix: [`NODE_GRAPH_LAYOUT.md`](docs/architecture/NODE_GRAPH_LAYOUT.md) and [`ui-async-policy.md`](docs/architecture/ui-async-policy.md). Testing strategy lives in `docs/testing/`.

---

## Workspace Layout Enforcement

Workspace 1차 분류 축이 도메인 의미(`plan` / `architecture` / `visual` / `assets` / `meta` / `sessions` / `codebase`)로 정렬된 후, 옛 I/O 트리 경로 잔존을 막는 manual sweep:

```bash
# ripgrep 의 `ts` 타입은 *.ts / *.tsx / *.cts / *.mts 를 모두 매칭한다 (`rg --type-list` 참고).
rg "outputs/design|inputs/sources|inputs/assets|inputs/references|inputs/directives|outputs/evals" \
  packages/ant-cli/src packages/ant-shared/src packages/ant-ui/src \
  packages/ant-cli/src/core/prompt/templates docs \
  --type ts --type md \
  --glob '!**/changelog/**' \
  --glob '!**/migrate-workspace-layout.mjs' \
  --glob '!**/docs/tmp/**'
# Expected: 0 matches
```

위 명령으로 수동 sweep 한다.

디스크 마이그레이션은 1회성: `pnpm migrate:workspace --apply --workspaces-path <ANT_WORKSPACE_BASE_PATH>`.

---

## Codebase Meta Document Policy

**워크스페이스는 도메인 축으로 배타 분리: `codebase/` (코드 + 코드의 메타, git 추적), `plan/` · `architecture/` · `visual/` · `assets/` (디자인·생성 산출물, 세션 간 영속), `meta/` (잡 메타 트랙: directives / evals), `sessions/` (에이전트 런타임/디버그, 일시).** 새 파일을 추가할 때 반드시 이 중 하나를 고르고, 경계를 넘지 않는다.

**`codebase/ANTRULES.md` 는 3-조건 필터를 통과한 codebase-local deviation 만 담는 ledger.** 기록 자격: (1) codebase-local (techTier / framework 기본값 아님), (2) not auto-derivable (`package.json` / `tsconfig.json` / config 파일 / 기존 파일에서 유추 불가능), (3) cross-task invariant (후속 task 가 같은 선택을 반복해야 함). 세 조건을 **모두** 만족할 때만 적는다. 정당한 예: 파일 네이밍 케이스, hooks 파일명 prefix, export 스타일 선호, `lucide` vs `heroicons` 아이콘 라이브러리 선호 같은 **코드가 기록 안 하는 프로젝트 고유 컨벤션**; 또는 시점-국지 패키지 pinning rationale (`shadcn X v0.4` incompatible with `react@19` → pinned 18). **금지**: Framework / Test runner / Source root / Alias / Config file location 재선언 — 이들은 `package.json` / `tsconfig.json` / 파일시스템이 이미 SSOT. decompose (무엇을 할지) / prompt (일반 원칙) / config 파일 (기계가 읽는 사실) 의 책임을 침범 금지. 1500자 상한. **허위 금지 문구 금지** (`Do not add test files` 같은 선제적 prohibition). 모든 code-job 태스크가 read + write 가능; 3-조건 필터 통과 사실이 없으면 파일 생성 자체를 하지 않는다. 매 plan/execute 프롬프트에 자동 주입되며 LLM 은 stale 의심 시 `read_file codebase/ANTRULES.md` 로 확인 후 **실제 code 를 SSOT 로 신뢰**.

"라이브러리를 쓰려면 설치해야 한다" 같은 class-of-bug 기본 원칙은 ANTRULES 가 아니라 별도 partial `jobs/code/base/injections/dep-self-contained.md` 가 모든 code-job execute / plan variant 에 고정 주입한다 (doc / explain 제외).

전체 정책은 [docs/architecture/35-codebase-meta-policy.md](docs/architecture/35-codebase-meta-policy.md).

---

## Unified Distributed System Principle

**Ant is ALWAYS a distributed system. There is NO separate "local mode" implementation.**

Local server and cloud server differ ONLY in where the infrastructure runs (single machine vs. cloud) and in a small set of intentional fork points (auth tenant, Figma transport — desktop MCP is local-only by nature, launch-time logging). The core data plane — Redis, BullMQ, Pub/Sub, separate API / Worker / Realtime processes on individual ports — is identical. Therefore:

### ❌ ABSOLUTELY FORBIDDEN

- `if (mode === 'local')` / `if (mode === 'cloud')` conditional branches that produce **divergent business logic** (auth tenant resolution and Figma MCP transport selection are the documented exceptions; everything else must converge after the branch)
- In-memory Maps/Sets that **mirror Redis SSOT state** (user-stopped flags, kanban snapshots, job-completion status) as a "local mode fallback" when Redis is unavailable. The mirrors that previously lived inside `JobStateTracker` for these purposes have been retired — see `RedisStateStore.markUserStopped` / `RedisStateStore.kanbanSnapshot` for the canonical reads
- Re-introducing in-memory job-completion or user-stop tracking outside the `RedisStateStore` SSOT
- Any code path that assumes Redis or BullMQ might not exist
- Skipping authentication middleware based on mode
- Separate function/class for local vs. cloud (e.g., `createCloudExecuteJob` vs. `jobManager.executeJob`) when the work is the same

### ℹ️ Permitted lifecycle helpers (NOT fallbacks)

`JobExecutionManager` and `JobStateTracker` (under `packages/ant-cli/src/periphery/adapters/http/express/managers/`) are the HTTP-adapter-side lifecycle helpers — they spawn the `job-runner.ts` child process for the API route, stream logs, and hold per-process bookkeeping (child handles, log streams, SSE responses). They are NOT a Redis fallback. The actual job queue, state store, and pub/sub are all Redis/BullMQ-backed. The forbidden pattern is **mirroring Redis-owned state in-process**, not the existence of these classes.

### ✅ CORRECT

- Single code path using Redis, BullMQ, and Pub/Sub unconditionally for queuing, state, and pub/sub
- `StateStore` (Redis) is always available — never `undefined` or behind `if (stateStore)`
- Job execution always goes through BullMQ queue
- Job completion always processed via Redis Pub/Sub subscription
- Authentication always enforced (local uses `local:local` tenant, not "skip auth")
- Figma MCP transport selection (`detectFigmaSource.ts`) is a documented exception: desktop MCP is local-only by nature, cloud uses an HTTP bridge

### Why This Matters

Every time a "local-only" fallback is added, it creates a parallel code path that:
1. Is never tested in production (cloud)
2. Hides distributed-system bugs that only appear in cloud
3. Doubles maintenance burden for every feature change
4. Breaks the guarantee that local testing reflects cloud behavior

**If it doesn't work without Redis, it's broken — fix it, don't add an in-memory fallback.**

---

## Node Graph Layout — Task Type Blind Phases (R1)

**Phase nodes, routers, parallel orchestrators, and common tool handlers MUST be blind to `task.type`. Task-specific logic lives ONLY in `tasks/{taskType}/hooks/`.**

This is the **R1 invariant** from [docs/architecture/NODE_GRAPH_LAYOUT.md](docs/architecture/NODE_GRAPH_LAYOUT.md). It applies to every agent graph under `packages/ant-cli/src/agents/{agent}/graph/{job}/`.

### ❌ ABSOLUTELY FORBIDDEN

- `if (task.type === 'verification')` / `task.type === 'error'` / any `task.type === '...'` branch inside `nodes/`, `routers/`, `parallel/`, `common/tool/handlers/`
- `{ currentTask: { type: '...' } } as any` fake state casts to sneak task-type logic into state-less contexts
- Domain state fields (`_verificationTracker`, `_fooAttempts`, `_barHistory`, etc.) accumulating on `state.ts` — they belong in `tasks/{type}/model/Session.ts`
- Domain-named files in `utils/` (e.g., `verificationFoo.ts`, `taskClassification.ts`) — `utils/` is pure helpers only
- Routers mutating state (`state.llmResponse = ...`) — routers are pure predicates
- A `TaskResumeState` shared across jobs mixing code-only and design-only fields — split into `BaseTaskResumeState` + `{Job}TaskResumeState`

### ✅ CORRECT

- `hooksIfActive(state)?.{hook}?.(...)` at phase-node / router call sites (state available)
- `hooksForTaskType(ctx.currentTaskType)?.{hook}?.(...)` at tool-handler / orchestrator call sites (no state, just ctx)
- Each task type has its own `tasks/{type}/index.ts` exporting `{ hooks: TaskHooks }` and is registered in `tasks/_shared/registry.ts`
- Depth varies: verification has full `model/` + all hooks; test-code / doc may have only `scheduling.ts` + `conversations.ts`. **What is uniform is the absence of `task.type` branches in phases.**
- Domain state lives as `state.{type}?: {Type}Session` (one field per task type) with Session/Snapshot APIs as the only mutation surface

### Why This Matters

Every `if (task.type === 'x')` in a phase node creates a hidden contract: "phase X knows about task X's internals." As task types multiply (verification, error, setup, ui, design-system, test-code, doc, feature, ...), these branches scatter across phases, routers, parallel, and tool handlers. Symptoms:

1. Same task-type predicate duplicated in 6+ files — drift guaranteed
2. Changing one task type's behavior requires edits in 8 phases instead of 1 hook folder
3. verification-specific state fields pollute `state.ts`, leaking into design / planner jobs via shared types
4. New task types must grep-and-copy existing `if` cascades — the pattern propagates

**The only durable fix is polymorphic dispatch via hooks. Phase nodes treat all task types identically; divergence is opt-in per hook.**

### Enforcement

```bash
rg "task\.type === '(verification|error|setup|ui|design-system|test-code|doc|feature)'" \
  packages/ant-cli/src/agents/architect/graph/code \
  --glob '!packages/ant-cli/src/agents/architect/graph/code/tasks/**'
# Expected: 0 matches
```

For full 8-axis layout and rules R1~R5, see [docs/architecture/NODE_GRAPH_LAYOUT.md](docs/architecture/NODE_GRAPH_LAYOUT.md).

---

## Retry Authority SSOT — `violation.isRetryable`

**재시도 가능 여부는 `violation.isRetryable` 플래그 하나가 SSOT다. `checkTaskStatus` 는 이 플래그만 읽어 라우팅하고, 절대 score / retry count / 타입 매핑표로 재판단하지 않는다.** (기존 `enforce/` 노드 표현은 리팩터링으로 `nodes/checkTaskStatus/` 에 통합되었다. `enforce` 는 더 이상 노드 이름이 아닌 함수적 역할 이름이다.)

이는 R1 의 자연스러운 확장이다. 재시도 판정을 task hook 이 소유해야 하는 이유 — `check.evaluate` 가 violation 의 성격(회복 가능한 일시적 실패 vs. 구조적 blocker)을 가장 정확히 안다. 이 판단을 phase 노드가 score 로 뒤집는 순간, task hook 의 의사결정은 무효화되고 "phase가 task-type 내부를 알아야 하는" 반패턴이 재발한다.

### ❌ ABSOLUTELY FORBIDDEN

- `checkTaskStatus/` (또는 임의의 phase 노드) 에서 violation 에 score 를 매기거나 retry count 기반 감점으로 재시도 여부를 뒤집기
- `criticalTypes` 같은 violation 타입 배열을 phase 노드에 두고 "중요 타입은 예외적으로 retry" 논리 작성
- `top-N same-type slice` / `focusedViolations` 같은 "plan 에 보낼 violation 을 phase 가 사전 필터" 하는 코드
- violation 생성 지점(`tasks/*/hooks/check.ts`, `nodes/checkTaskStatus/evaluate.ts`) 에서 `isRetryable` 를 누락(`undefined`) 한 채 반환 — `checkTaskStatus` 가 `v.isRetryable === true` 로 strict 비교하므로 누락 시 모두 drop 된다

### ✅ CORRECT

- violation 생성 지점에서 `isRetryable: true | false` 를 명시 선언. 재시도로 해결 가능한 transient error 는 true, warning-only / structural blocker 는 false.
- `nodes/checkTaskStatus/index.ts` (및 `workerIndex.ts`) 는 `violations.filter(v => v.isRetryable === true)` 만 수행. 결과가 비면 `violations: []` 로 클리어 + (currentTask 살아있으면) `_nextPlanEntry: 'retry'` 세팅.
- violation 그룹핑 / 우선순위 / root-cause 선택은 plan 프롬프트 (`Error Grouping Principle` / `Fix Priority Principle` / `rootCauseSelfCheck`) 가 담당. phase 코드는 관여하지 않는다.

### Why This Matters

score 매핑표는 LLM 의사결정 전에 violation 을 절단하는 anti-pattern 이다. priority 시스템이 한때 `verification_incomplete` 을 retry 2+ 에서 drop 시켰고, 그 결과 `_nextPlanEntry: undefined` 상태로 plan 에 재진입해 `handleFreshTaskEntry` 로 낙하, 한 태스크가 5 cycle 로 부풀어 9분+ 소요하는 회귀를 일으켰다. score 로 재판단할 유혹은 항상 같은 장애를 재생산한다.

### Enforcement

```bash
# 1. priority 잔재 0 보장 (-w / --word-regexp 로 camelCase 합성어 보호 — 예: isErrorContext 변수명은 ErrorContext 검출 대상이 아님)
rg -w "prioritizeViolations|calculateErrorImpact|errorPriority|ErrorImpact|ErrorContext|logErrorPriority|getTopPriorityError|areErrorsRepeating|generateErrorFingerprint" packages/ant-cli/src
# Expected: 0 matches

# 2. 신규 violation type 이 isRetryable 을 세팅하는지 확인
rg "type:\s*'\w+' as ViolationType" packages/ant-cli/src -A 5 | rg -c "isRetryable"
# Expected: violation 생성 지점 개수와 동일
```

---

## Tier-Verification Alignment SSOT (Phase 1: 코드잡)

**5-tier × task × verification matrix는 core/executionTier 에 정의된 잡-중립 SSOT이며, 코드잡은 Phase 1에서 이 matrix를 준수한다. 다른 잡은 Phase 2에서 채택 예정이지만 enum/파서/`isDirectTier`/`isTaskTier` helper는 이미 공유된다.**

### 검증 책임 SSOT — `tasks/_shared/verify/`

**검증 인프라(Session, plan/execute prompt, command guard, check evaluate, router, orchestrator attempt counter, tool side-effect)는 [`tasks/_shared/verify/`](packages/ant-cli/src/agents/architect/graph/code/tasks/_shared/verify/) 에 단일 SSOT로 존재한다. Tier 3/4 dedicated verification task ([`tasks/verification/`](packages/ant-cli/src/agents/architect/graph/code/tasks/verification/) thin shim)와 Tier 2 self-verify task (error/feature/ui/setup with `selfVerifyOnDone:true`)는 동일 인프라를 공유한다 — `composeBundle({...})` helper 가 task type 별로 apply-mode hook 과 verify-mode dispatch 를 합성한다.**

검증 책임자 식별 predicate: `requiresVerification(task) = isVerificationTask(task) || task.selfVerifyOnDone === true`

phase mode 채널: `state._verifyEntered` — single writer 는 `tasks/_shared/verify/markVerifyEntered.ts`. 두 호출 지점:
- verification task: `_shared/verify/initSession` 첫 호출 시 자동 set (fresh entry)
- self-verify Tier 2 task: `executeRouter` `<done>` 분기에서 `routeAfterDone === 'plan'` 결정 직후 helper 호출 (apply→reverify 전환)

### 5-Tier × Verification 매트릭스 (코드잡)

| Tier | 의미 | 쓰기 | tasks (decompose 시점) | 검증 |
|---|---|---|---|---|
| 0 Reflex | 읽기+텍스트 답변 | 금지 | 0 | N/A (direct) |
| 1 OneShot | 검증 불필요한 제한적 쓰기 | 허용 (2 step) | 0 | 없음 (direct) |
| **2 Exploratory** | 단일 작업 단위 (single unit of work) | 허용 | **정확히 1** | **two-cycle 실행** — apply phase 에서 task 자체 plan/execute 가 fix 적용, `<done>` emit 시 `executeRouter` 가 reverify 로 자동 라우팅하여 `_shared/verify/` 인프라(initSession → buildPlanPrompt → executeHook → commandGuard → checkEvaluate)로 gate 검증. 결정 SSOT 는 `selfVerifyOnDone:true` 필드 + `requiresVerification(task)` predicate. plan 단계에서 작업량이 임계치를 넘으면 `batchSplit` 이 Tier 3 구조로 runtime escalate — 아래 "Tier 2 runtime escalate" 참고. |
| 3 Task | 다중 작업 단위 | 허용 | **>= 2 with verification task** | verification task가 동일 `_shared/verify/` 인프라로 gate 담당 |
| 4 RefsGrounded | Tier 3 + refs-grounded | 허용 | >= 2 | Tier 3와 동일 |

### batchSplit 의 두 경로

**`batchSplit.ts` 는 parent 태스크의 성격에 따라 두 경로로 분기한다. `state.executionTier` channel 은 두 경로 모두에서 바뀌지 않으며, Tier 2 escalate 는 tier 승격이 아닌 큐-구조 확장이다.**

**Path A — parent = verification (Tier 3/4 Final Verification split)**

기존 동작 유지: 원본 verification 을 **재큐** + N 개 error 서브태스크. `_failedAttempts` orchestrator 재시도 버짓을 보존하기 위해 동일 식별자로 재큐한다 (`still-lacing-north` 인시던트 주석: 버짓 리셋 시 무한 재시도 회귀).

**Path B — parent = error (Tier 3/4) 또는 Tier 2 runtime escalate**

원본을 **큐에서 제거** + N 개 서브태스크(type 계승) + (이미 Final Verification 이 없으면) 새 Final Verification (priority 1000) 을 추가. 원본을 `{...nextTask}` 로 재큐하면 표현(type=error) 과 역할(gate) 이 어긋나 execute 프롬프트가 "remediation plan 을 새로 내라" 로 잘못 안내되고, `prePlanText` 없이 diagnostic 을 처음부터 재생성해 `firm-jolting-horse` 류 재탐색 루프를 일으킨다.

| | Path A (verification parent) | Path B (error parent / Tier 2 escalate) |
|---|---|---|
| 발동 조건 | `isVerificationTask(nextTask)` | `isErrorTask(nextTask)` OR `state.executionTier === 2 && nextTask.selfVerifyOnDone === true` |
| 원본 처리 | **재큐** (identity / `_failedAttempts` 보존, clean state: timing/_failed/_failureReason 만 클리어) | **소멸** |
| 서브태스크 type | `'error'` (verification plan 이 fix batch 로 쪼갠 것이므로 적용 주체는 error) | `nextTask.type` 계승 (Tier 3/4 error → error, Tier 2 feature → feature, ui → ui, setup → setup) |
| 서브태스크 `selfVerifyOnDone` | 설정 안 함 — gate 는 재큐된 원본 verification 이 담당 | 설정 안 함 — gate 는 Final Verification 이 담당 |
| 새 Final Verification 추가 | 없음 (원본이 역할 수행) | `hasFinalVerification(queue, running, completed)` 이 false 면 push. priority 1000, `resumeState.verification` = Session snapshot |
| Session snapshot 이관 | 재큐된 원본의 `resumeState.verification` | 새 Final Verification 의 `resumeState.verification` |
| 공통 상한 | `MAX_BATCH_SPLIT_CYCLES = 10` (Session.batchSplitCount) — 초과 시 `VerificationTerminalError` |

### ❌ batchSplit 관련 추가 금지

- Path B 에서 원본을 `{...nextTask}` 로 재큐하는 옛 패턴 부활. 표현-역할 불일치 + 맥락 손실로 `firm-jolting-horse` 회귀 (수정 후 재큐된 원본이 9분 재탐색 루프 돌다 plan-format 위반으로 task_fail).
- Path A 에서 원본을 drop-and-replace 로 바꾸기. 새 verification task 는 `_failedAttempts` 를 0 으로 리셋하므로 각 split cycle 마다 full retry budget 이 재발급되어 `still-lacing-north` 무한 재시도 회귀.
- `batchSplit` 서브태스크의 `type` 을 parent 와 무관하게 하드코딩. Path B 에서 Tier 2 escalate feature task 가 `type='error'` 서브로 쪼개지면 execute variant / hooks 가 실제 작업 semantic 과 어긋난다. Path A 는 반대 방향: fix 적용 주체이므로 항상 `'error'`.
- Path B 에서 Final Verification 의 `resumeState.verification` 누락 — 맥락 없이 처음부터 진단/plan 을 재생성하게 되어 재탐색 루프 재발.

### ❌ ABSOLUTELY FORBIDDEN

- `tasks.length` 기반으로 verification 전략을 런타임 분기하는 코드 — Tier가 이미 이 결정을 인코딩한다.
- Tier 3/4에서 `tasks.length < 2` 허용 (responseParser가 throw). "error-only n=1 허용" 같은 `allTasksAreRemediation` 분기 부활 금지.
- Tier 2에서 task 2개 이상 생성. 1개를 초과하는 단위는 Tier 3으로 분류.
- Tier 2 task에서 `selfVerifyOnDone: true`를 누락 (explain 제외) — 누락 시 `requiresVerification(task)` 가 false 가 되어 verify-mode dispatch 가 발동하지 않는 silent-bug. (`onyx-building-fence` 인시던트.)
- `direct` 노드에서 `promptBuilder.render()` 로 base layer (agents/architect, jobs/code/base/system, antrules, tool-calling-rules 등) 를 우회한 프롬프트 조립 — `build()` 만 사용.
- 검증 책임을 task type 단위로 fork (`tasks/error/hooks/check.ts` 같은 verification 인프라 복제) — `tasks/_shared/verify/` 가 단일 SSOT 이며 task type 별 번들은 `composeBundle({...})` 로 합성한다. 새로운 검증 동작은 `_shared/verify/` 에 추가하고 4번들이 자동 상속.
- `state._verifyEntered` 직접 mutation. 단일 writer 는 `tasks/_shared/verify/markVerifyEntered.ts`. 다른 코드는 `isVerifyEntered(state)` 로만 read.
- Apply phase 에서 build/test/typecheck 허용 (`selfVerifyOnDone:true` 에 한해서도 금지). Apply phase 는 fix 적용만 담당하고 gate 실행은 reverify phase 의 `_shared/verify/commandGuard` 가 담당. `error/hooks/command.ts` 의 `selfVerifyOnDone === true` 분기는 retired.
- `tasks/verification/model/{Session,gates,snapshot,planHash,errors,configSnapshot}.ts` 또는 `tasks/verification/hooks/{plan,execute,command,check,router,orchestrator,tool}.ts` 에서 import. 모두 `_shared/verify/` 로 이전됨 (model/is.ts, hooks/decompose.ts, hooks/conversations.ts 만 verification 잔존).

### ✅ CORRECT

- decompose 프롬프트가 Tier 2면 `<tasks>` 안에 정확히 1개 (+ `selfVerifyOnDone: true`) 만 emit. **runtime escalate 후 큐 크기 변화는 decompose 불변식과 무관** — decompose 시점 1개가 기준.
- Tier 3/4 decompose가 feature/error/ui/setup 중 무엇을 포함하든 반드시 verification task (priority 1000) 동반.
- Tier 2 runtime escalate 후 모양: 서브태스크 N (type 계승) + verification 1 — Tier 3 decompose 결과와 동형.
- 4번들 (`error`/`feature`/`ui`/`setup`) 은 `composeBundle({apply, taskTypeSpecific})` 한 호출로 합성. apply hook 은 task type 고유 (e.g. error 의 remediation plan), verify-mode dispatch 는 `_shared/verify/` 에서 자동 주입.
- `direct` 노드는 `PromptBuilder.build()` 를 task-blind config로 호출 (currentTask/planText/violations 제외, system/rules/base/vars는 execute와 동등).
- `error/hooks/orchestrator.ts::onTaskComplete` 의 Final Verification auto-enqueue는 defense-in-depth 로깅만 — 정상 경로(Tier 2 self-verify / Tier 2 escalate / Tier 3/4 decompose) 에서 fires-never 이 기대값.
- Self-verify task 의 phase 전환: apply phase `<done>` → `executeRouter.routeAfterDone === 'plan'` → `_nextPlanEntry='reverify'` 와 `markVerifyEntered(state)` 동시 set → `handleReverifyEntry` 가 `initSession` 호출하여 Session 생성 → verify-mode plan/execute 사이클.

### Enforcement

```bash
# 1. allTasksAreRemediation 류 n=1 허용 분기 부활 금지 (active code only — JSDoc references are OK)
rg "const\s+allTasksAreRemediation|if\s*\(allTasksAreRemediation" packages/ant-cli/src
# Expected: 0 matches

# 2. direct 노드가 promptBuilder.render()로 base layer 우회하는지 확인
rg "promptBuilder\.render\('jobs/code/nodes/direct" packages/ant-cli/src
# Expected: 0 matches (build() 로 대체)

# 3. isDirectTier 경계가 tier<=1인지 확인
rg "isDirectTier" packages/ant-cli/src/core/executionTier/derive.ts -A 2 | rg "tier <= 1"
# Expected: 1 match

# 4. legacy verification model/hooks import 잔존 0건 (_shared/verify/ 단일 SSOT)
rg "from\s+['\"][^'\"]*tasks/verification/model/(?!is)" packages/ant-cli/src packages/ant-cli/tests
rg "from\s+['\"][^'\"]*tasks/verification/hooks/(plan|execute|command|check|router|orchestrator|tool)" packages/ant-cli/src packages/ant-cli/tests
# Expected: 0 matches each

# 5. _verifyEntered 직접 mutation 잔존 0건 (markVerifyEntered helper 만이 writer)
rg "state\._verifyEntered\s*=\s*[^=]" packages/ant-cli/src --files-without-match -g "*markVerifyEntered.ts" -g "*checkTaskStatus/index.ts"
# Expected: 0 matches (markVerifyEntered.ts 와 checkTaskStatus/index.ts 외에는 없어야 함)

# 6. self-verify-inline.md partial 이 사라졌는지 확인 (two-cycle 설계로 obsolete)
ls packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/execute/injections/self-verify-inline.md 2>&1 | grep -q "No such file"
# Expected: file should NOT exist (deleted)
```

전체 배경은 docs/architecture/ 의 Tier 관련 문서 또는 `core/executionTier/index.ts` JSDoc 참고.

---

## LangGraph State Management

### channels Definition Required

When using state fields in LangGraph, always define them in `channels` first.

```typescript
// ❌ WRONG: Using state as any without channels definition
(state as any).parsedUiDocs = value;

// ✅ CORRECT: Define in channels first
const graph = new StateGraph<GraphState>({
  channels: {
    parsedUiDocs: null as any,  // reducer definition
    // ...
  }
});

// Then use
state.parsedUiDocs = value;
```

### Derived Channels — `state.executionTier`

`state.executionTier?: ExecutionTierId` is a **derived** channel. Decompose writes it once after the LLM emits `<executionTier>N</executionTier>`; the tag is parsed by `parseExecutionTierTag` and validated by `validateExecutionTier` (see `core/executionTier/parseExecutionTierTag.ts`). Downstream phase nodes access the execution tier through `getExecutionTier(state)` only.

Violations of the LLM contract (missing tag OR Tier 0 for `generate`/`refactor`) throw `ExecutionTierViolation` inside decompose's inline retry loop (max 2 retries, framing appended on each retry). This replaces the earlier silent-default-to-Reflex behavior that masked prompt drift as successful 0-task completion.

```typescript
// ✅ Phase nodes use the facade:
import { getExecutionTier } from '../../../../../../core/executionTier';

const executionTier = getExecutionTier(state);
await executionTier.breadcrumb(state, touched);
await executionTier.boundary(state);

// ❌ Do NOT inspect `mode` / `complexity` literals in phase code:
if (state.resolvedAction?.mode === 'explain' && state.complexity === 'task') { ... }
```

Mode dispatch lives in **exactly one place**: `Tier3Task`'s constructor in `core/executionTier/tiers/Tier3Task.ts`. See [docs/architecture/18-session-redesign.md §5.1.1](docs/architecture/18-session-redesign.md) for the tier strategy matrix and the D11 invariant guard.

---

## Canonical Tag Rendering SSOT

**Every canonical `<tag>` emitted by a node — LLM-streamed or back-channel emit — MUST be registered in `packages/ant-cli/src/core/streaming/transformers/SpecialTagTransformer.ts`, and rendering rules MUST live there only.**

This is the central authority for how XML-style markers become chat UI. Fragmentation (duplicate formatting in nodes, parsers, or chat helpers) is explicitly forbidden — the transformer's `register({pattern, transform})` list is the complete inventory.

### ❌ ABSOLUTELY FORBIDDEN

- Emitting a new `<tag>` from any node without adding a transformer entry for it
- Calling `formatRACForChat` / building tag-formatted text anywhere outside `SpecialTagTransformer` (and the `emitDetectOutcome` helper that delegates to it)
- Adding `insideXxx` state flags to `XMLStreamParser` to suppress a tag — suppression belongs in the transformer (`{ consumed: true }`) so the parser stays payload-agnostic
- Duplicating a tag's regex in a streaming parser AND in a post-stream response parser without a transformer policy — the transformer is the one place that decides "render vs. suppress"
- `try { await chatAPI.sendLLMEvent(...) } catch {}` silently swallowing chat-emit failures — use `console.warn` so renderer drift is visible

### ✅ CORRECT

- New canonical tag → add `this.register({pattern, transform})` in `SpecialTagTransformer.initializeTransformers()` with either a `transform*` method (formatted output) or a `() => ({ consumed: true })` suppressor
- Nodes that need back-channel emit (e.g. detect, decompose-final) build the canonical JSON payload and delegate to `core/streaming/emitDetectOutcome.ts` (or a similar helper) which runs the payload through the transformer
- Locale-dependent labels for tags live in sibling SSOT modules (e.g. `core/executionTier/labels.ts`) and are imported by the transformer — never hard-coded in node files

### Registered tags (current inventory)

| Tag | Policy | Surface |
|---|---|---|
| `<done>` | formatted | completion notice |
| `<learn_command>` | formatted | learn summary |
| `<tasks>` | consumed | rendered by Kanban |
| `<references>` | formatted | reference repo list |
| `<detect>` | formatted | RAC + basis (detect / decompose-final phases) |
| `<executionTier>` | formatted | 5-tier strategy label |
| `<techTier>`, `<boundary>`, `<directHints>`, `<specClarify>` | consumed | internal state only |
| `<domain>`, `<gameArtTier>`, `<gameContentTier>` | consumed | DecisionTagRegistry payload — re-emitted via `<detect>` / `decompose-final`, direct emission suppressed to avoid double-render |

### Why This Matters

Without a single authority:

1. Raw XML leaks into the chat stream whenever a node adds a tag faster than its renderer
2. Formatting drifts across Korean / English surfaces because each node reinvents the wheel
3. Suppression logic accumulates in parsers that have no business knowing about domain payloads
4. Renamed tags silently break chat UI because no registry exists to fail-fast on mismatch

The transformer registry is the self-documenting inventory. If it isn't there, it isn't canonical.

---

## Tier Matrix SSOT — `isTierActive(tier, slot, domain, runtime)` (Phase 1 → D23 / D27 / D28)

**모든 tier (`techTier` / `visualTier` / `gameArtTier` / `gameContentTier`) 의 활성 여부 는 [`@ant/shared/tier-matrix.ts`](packages/ant-shared/src/tier-matrix.ts) 의 `isTierActive` 하나가 SSOT다. 산발 predicate (`isVisualTierActive`, `isGameArtTierActive` 등) 는 만들지 않는다. FE wizard / FE summary / BE code decompose / BE design decompose / BE PromptBuilder.buildBasisSection 5 지점 모두 이 predicate 만 호출한다.**

**`domain` 은 TierKey 가 아니다 (D23 — Phase 2).** 워크스페이스 1급 selector (`WorkspaceConfig.domain` — D22) 로서 basis (= 활성 tier set) **위** 에 있으며, `isTierActive(tier, slot, domain, runtime)` 에 게이트 인자로만 전달된다. 도메인 정체성 본문은 `templates/domain/{d}.md` + `templates/jobs/<job>/domain/{d}.md` 에 산다 (D27 — v6). PromptBuilder 는 tier loop **밖** 에서 `renderDomainTier` 한 번 호출한다.

**Domain-Tier 1:1 (D28 — vertical split)**: `visualTier` 는 service 전용, `gameArtTier` 는 game 전용. 두 surface 는 직교가 아니라 도메인별로 단일 활성된다 — 한 워크스페이스가 동시에 양쪽 tier 를 갖지 않는다. `techTier` 만 도메인-universal (모든 도메인 공통).

```
active(tier) ⇔ slot.tiers?.includes(tier)
            AND TIER_DOMAIN_MATRIX[tier].includes(domain)
            AND !RUNTIME_SUPPRESSORS[tier]?.(runtime)
```

| 축 | 닫히는 조건 | 출처 |
|---|---|---|
| slot | `slot.tiers` 에 tier 미포함 | 인텐트별 정적 config (`getConfigSlots(intent).basis.tiers`) |
| domain | `TIER_DOMAIN_MATRIX[tier]` 에 domain 미포함 | 매트릭스 (D28: `visualTier=['service']`, `gameArtTier=['game']`, `gameContentTier=['game']`, `techTier=['service','game']`) |
| runtime | `visualTier`: `techTier.stack === 'backend'` 또는 `hasUiDoc === true` (service 도메인 only — game 에선 visualTier 가 매트릭스에서 막힘) | 런타임 RAC basis / post-RAC pool |

`hasUiDoc` 은 **사용자가 RAC 에 포함시킨 UI 디자인 문서**(ant / figma / handoff)의 존재 여부다. 파일시스템에 존재하는 것만으로는 부족하고, `refs` 또는 `context` 슬롯으로 사용자가 결정해 넣어야 true. UI 디자인 문서 자체가 디자인 시스템 권위이므로 병렬 visual tier 주입은 중복이다.

### ❌ ABSOLUTELY FORBIDDEN

- tier 활성 여부를 판단하는 자체 헬퍼 / 인라인 조건식을 새로 만들기. 모든 지점에서 `isTierActive(tier, slot, domain, runtime)` 만 호출한다.
- `{{#if visualTierActive}}` 이외의 템플릿 이름으로 같은 게이트를 이중화하기 (`{{#if hasVisualTier}}`, `{{#if hasUiDoc}}` 등 alias 금지). 템플릿 변수는 node-level 에서 `isTierActive('visualTier', ...)` 결과를 `visualTierActive` 로 넘긴다. 동일 패턴 — `gameArtTierActive`, `gameContentTierActive`. (`domain` 은 tier 가 아니므로 `domainTierActive` 같은 변수는 신설 금지 — 도메인 분기가 필요하면 `templates/domain/` 또는 `templates/jobs/<job>/domain/` 에 본문을 둔다.)
- `hasUiDoc` 을 "파일시스템에 UI artifact 가 있는가" 로 해석하기. 항상 post-RAC pool (BE) 또는 `actionMetadata.refs`/`context` (FE) 기준.
- `hasUi` 가 true 인데 `resolvedAction.basis.visualTier` 를 계속 downstream 으로 흘려보내기. `decompose` 는 UI doc 감지 시 preset 을 `undefined` 로 비워 downstream 프롬프트가 스테일 값을 읽지 못하게 한다.

### ✅ CORRECT

- BE 노드에서 `isTierActive('visualTier', slot, getEffectiveDomain(domain), { techTier, hasUiDoc: pool.hasUi() })` 호출 → 결과를 `visualTierActive` 템플릿 변수로 주입.
- FE 에서 `pathsContainUiDoc([...refs, ...context])` 로 `hasUiDoc` 계산 후 `isTierActive('visualTier', slot, domain, ...)` 호출 (`useBasisWizard`, `BasisSummaryBar`).
- UI doc 이 RAC 에 들어오면 visual tier 관련 모든 프롬프트 (`visual-tier-detection` 주입, basis 의 visualTier 블록) 를 스킵.
- 새 도메인 추가 (Phase 4+) 는 `Domain` union 확장 + `TIER_DOMAIN_MATRIX[tier]` row 한 줄 변경으로 끝나야 한다 — predicate / wizard / decompose 어디에도 if 분기 추가 금지.

### Enforcement

```bash
# 산발 predicate 가 부활하지 않았는지 확인
rg -n "(isVisualTierActive|isArtTierActive|isGameContentTierActive)\(" --type ts
# Expected: 0 matches (모두 isTierActive 로 통합됨)

rg -n "isTierActive\(" --type ts
# Expected: FE wizard/summary + BE code decompose / design decompose / PromptBuilder.buildBasisSection
```

전체 설계는 [docs/tmp/domain-and-game-tier-system-handoff.md](docs/tmp/domain-and-game-tier-system-handoff.md) 의 §4.1 / §4.3 참고.

---

## Domain-Branching Locality SSOT — domain/** + basis/** 안에서만 (Phase 1 → D27/v6, I1)

**도메인 콘텐츠 분기 (`{{#if (eq domain 'game')}}` 등) 는 다음 4 디렉토리 안에서만 합법이다.** 노드 본체 / variants / rules / system / injections / examples 어디에도 도메인 이름 비교를 넣지 않는다. 결정 슬롯 분기 (`{{#if gameEngineCandidates}}`) 는 메타-프로세스이므로 허용된다.

| 디렉토리 | 책임 |
|---|---|
| `templates/domain/**` | 워크스페이스 1급 selector — 도메인 정체성 (job-agnostic) |
| `templates/basis/**` | tier-gated 콘텐츠 (활성 tier set 의 본문) |
| `templates/jobs/<job>/domain/**` | job × domain overlay (예: 게임 기획서 / SaaS PRD 골격) |
| `templates/jobs/<job>/basis/**` | job × tier overlay |

**위계** (D22 + D23 → D27): `domain` (워크스페이스 selector) → 매트릭스 게이트 (`isTierActive`) → `basis` (= 활성 tier set) → tier 별 본문. domain 은 selector 이지 selectee 가 아니므로 `basis/` 안이 아닌 sibling 으로 둔다 (v1 시점의 `basis/domain/` 잔재는 D27 로 정정).

회귀 가드: `tests/domain-branching-locality.test.ts` 가 위 4 디렉토리 외에서 도메인 이름 비교 0 hit 강제.

---

## Basis Partial Invariant — `templates/basis/**` 안에서 `{{> }}` 금지 (Phase 1, I4)

`templates/basis/**` 의 `.md` 파일들은 [`FilePromptAdapter.ts`](packages/ant-cli/src/periphery/adapters/prompt/FilePromptAdapter.ts) 의 `initPartials` 에서 **의도적으로 등록 제외** 된다. 이 디렉토리 안에서 `{{> }}` partial include 를 시도하면 partial 이름이 등록되지 않아 런타임에 깨진다. private partial 이 필요하면 `templates/jobs/.../basis/.../_*-private.md` 명명 규약으로 `jobs/...` 트리에 둔다 (이 트리는 등록됨).

회귀 가드: `tests/basis-partial-invariant.test.ts`.

---

## Motion Locality SSOT — UI motion ≠ engine art motion (Phase 1, I5)

`interactionGrammar` (visualTier layer 4) 는 **UI/HUD 표면의 페이지 전환 / 호버 / 포커스** motion 만 다룬다. `gameartTier.{motionPattern, particleProfile, projectilePolicy}` 는 **엔진 내부 sprite tween / 파티클 / 투사체** motion 만 다룬다. 두 motion 의 cross-pollution (sprite/projectile 키워드를 interactionGrammar 에, page-transition/hover 키워드를 gameartTier 에) 은 금지.

회귀 가드: `tests/motion-locality.test.ts`.

---

## Asset Surface Boundary SSOT — service vs game pool (Phase 2, I6)

**`assets/` 는 도메인 1:1 로 분리된다 (D19-revised).** `assets/service/` 는 `visual/ui/ant/ui-assets.json` 만 참조하고, `assets/game/` 은 `visual/game-art/ant/game-art-assets.json` (D24-revised v8 — sub-sourced canonical) 의 `kind: 'external'` 항목만 참조한다. `kind: 'inline'` 항목은 `src` 가 없으므로 lint 대상에서 제외된다 (D20).

워크스페이스의 도메인 (D22 — `WorkspaceConfig.domain`) 이 `service` 면 `assets/game/` 트리는 `download_asset` / `list_assets` 핸들러에서 라우팅되지 않으며, 도메인이 `game` 이면 그 반대다. 게임 프로젝트도 HUD 자산은 `assets/game/icons/`, sprite 자산은 `assets/game/entities/` 처럼 한 풀 안에서 카테고리만 다르게 잡는다 — 두 풀을 동시에 쓰지 않는다.

### ❌ 금지

- `ui-assets.json` 의 `src` 가 `assets/game/...` 로 시작
- `game-art-assets.json` 의 `kind: 'external'` 항목의 `src` 가 `assets/service/...` 로 시작
- `download_asset` / `list_assets` 가 `intentGroup` 을 무시하고 단일 풀만 가리키도록 하드코딩

### ✅ 정책

- 풀 라우팅은 `state.workspaceConfig.domain` 한 곳에서 결정 — handler 는 그 결과만 소비
- 마이그레이션이 필요할 때 (`assets/{icons,images,misc}` 잔재) `migrateAssetsToDomain(workspaceDomain)` 한 번 실행 — idempotent
- 도메인 전환 시 자산은 사용자 책임으로 이동 — 시스템은 조용히 한 쪽만 활성화한다

회귀 가드: `tests/asset-surface-boundary.test.ts` + `tests/assets-dir-canonical.test.ts`.

---

## Domain-Surface Boundary SSOT — service ↔ game vertical split (Phase 2, I7-revised / D28)

**`visualTier` is service-domain-only and `gameArtTier` is game-domain-only — vertical split (D28).** The two surfaces never coexist in the same workspace:

- **service domain** → `visualTier` (6 layers) + `visual/ui/` artifacts + `design-ui` intents (`gen-ui-figma` / `gen-ui-desc` / `rev-ui` / `explain-ui`).
- **game domain** → `gameArtTier` (7 axes, including HUD CSS tokens) + `visual/game-art/ant/` artifacts (D24-revised v8 — sub-sourced canonical, mirrors `visual/ui/ant/`) + `design-game-art` intents (`gen-game-art-figma` / `gen-game-art-desc` / `rev-game-art` / `explain-game-art`).

The matrix layer (`TIER_DOMAIN_MATRIX.visualTier=['service']` and `TIER_DOMAIN_MATRIX.gameArtTier=['game']`) and the `domainGate` on each action card mirror each other so a domain switch in `WorkspaceConfig.domain` is the single source of truth that decides which surface is active.

For the game domain, `gameArtTier` is the **single visual SSOT** — both the in-canvas surface (sprites / particles / projectiles / audio) and the React HUD overlay (menus / score / dialog) pull from the same `game-art-tokens.json` palette / silhouette / lighting / motion-tone + HUD CSS tokens. There is no separate `visualTier` for a game project; HUD layout decisions (spacing rhythm / surface treatment / typography / radius / focus ring) come from concept-derived defaults in `basis/gameArtTier/concept/{name}.md`.

game-art design's responsibility limit is **css-only inline + external mapping** (D21). LLM authors inline `kind: 'inline'` payloads (single-color shapes, ≤5 svg primitives, OscillatorNode configs); production-quality sprites / mp3 / 3D models go through user placement (`kind: 'external'`) under `assets/game/` or the future `visual` job (Phase 5+).

### ❌ 금지 (cross-pollination)

- game-art design template body uses `visualLanguage` / `surfaceSystem` / `spatialSystem` / `interactionGrammar` / `componentSemantics` / `visualHierarchy` — those belong to service-domain `visualTier`. Backticked boundary disclaimers (`` `visualLanguage` is service-only ``) are allowed.
- UI design template body uses `sprite tween` / `OscillatorNode` / `particle system` / `projectile spawn` — those belong to game-domain `gameArtTier`.
- A code job in a game workspace consumes `visual/ui/ant/ui-*.json` (or vice versa for service) — `filterSlotsByDomain` drops the wrong-domain slot before any prompt sees it.
- Game-art design's LLM response emits `<visualTier>`, UI design emits `<gameArtTier>` — the matrix gate (D18) closes automatically.

### ✅ 정책

- The two surfaces share the same upstream RAC pool (PRD + system design) but live in different output directories with different asset pools (`assets/{service,game}/`).
- HUD CSS tokens (spacing / typography / radius / shadow) for game projects are emitted into `game-art-tokens.json`, NOT into a parallel `ui-tokens.json`. game-art-spec.json carries `hud` / `menu` / `dialog` categories alongside the in-canvas categories.
- game-art design emits `<gameArtTier>` only; decompose absorbs the response via `parseDecisionTags` and applies it to `state.resolvedAction.basis.gameArtTier`.
- Inline payloads exceeding the css-only ceiling (svg path 5+ primitives, css 100 chars+) auto-escalate to `kind: 'external'` candidates.
- Code-job dispatch (`AutoInjectionResolver`) routes `domain === 'game'` to the `game-art-source` partial and other domains to the per-`UiSource` `ui-source-dispatch` partial.

회귀 가드: `tests/game-art-design-surface.test.ts` + `tests/domain-gate.test.ts` + `tests/domain-surface-boundary.test.ts`.

---

## Genre × CoreLoop Matrix Gate SSOT — I9 (D31-revised v9)

**`gameContentTier` 의 `(genre, coreLoop)` 후보 set 은 `GENRE_CORELOOP_MATRIX` lookup 의 결과만 노출한다.** 모든 narrowing 은 `coreLoopCandidatesFor(genre)` SSOT 에 위임 — 노드 본체에 `if (genre === 'match3') ...` 같은 short-circuit 분기는 도입 금지 (D6 / I1 — Domain-Branching Locality 그대로). 장르 partial 은 GUIDE 이며 contract 가 아니다 — systems-shape 카테고리는 고정이지만 카테고리 안의 axes (steering axis, op universe, threat shape 등) 는 PRD 의 surface 다.

`packages/ant-shared/src/game-content-tier-registry.ts`:

```ts
export const GENRE_CORELOOP_MATRIX = {
  match3:        ['solve', 'collect'],
  slidingPuzzle: ['solve'],
  cardSolitaire: ['solve', 'collect'],
  arcadePaddle:  ['survive', 'collect'],
  arcadeSnake:   ['survive', 'collect'],
  crowdRunner:   ['survive', 'collect'],
} as const;

export function coreLoopCandidatesFor(genre): readonly GameCoreLoopVariant[];
```

### ❌ 금지

- 노드 본체 / decompose / parser 어디에도 `if (genre === 'match3') coreLoop = 'solve'` 같은 short-circuit 코드 도입.
- `GENRE_CORELOOP_MATRIX` 와 동일한 매핑을 다른 파일에서 hard-code 재현 (SSOT 분기).
- `gameCoreLoopCandidates` enrichedVar 직렬화 시 `coreLoopCandidatesFor` 우회.

### ✅ 정책

- `decompose/index.ts` enrichedVars 가 `coreLoopCandidatesFor(state.resolvedAction?.basis?.gameContentTier?.genre)` 만 호출. 결정된 genre 가 없으면 union (`GAME_CORE_LOOP_VARIANTS`) 노출.
- `DecisionTagRegistry` 의 `gameContentTier` 파서가 매트릭스 위반 페어 (`cardSolitaire × survive` 등) 의 `coreLoop` 필드를 drop — 다음 retry 에서 LLM 이 narrowed candidate set 으로 재emission.
- 새 genre 추가 / 매트릭스 row 변경은 단일 파일 (`game-content-tier-registry.ts`) 한 줄 편집.

회귀 가드: `tests/genre-coreloop-matrix.test.ts`.

---

## Design Sub-Source Symmetry SSOT — I10 (D24-revised v8)

**`visual/ui/` 와 `visual/game-art/` 는 동형 sub-source 구조 (`ant/` + Phase 5+ hook `figma/` / `handoff/`) 를 갖는다.** 한쪽은 sub 분리, 다른 쪽은 flat 인 비대칭 도입 금지.

`packages/ant-shared/src/canonical.ts`:

- 두 surface 모두 `ant/` 가 LLM-generated canonical sub-source (필수 등록).
- `figma/` / `handoff/` 는 parser-only Phase 5+ hook (canonical-dirs 등록은 ui/ 에만; game-art/ 는 prefix 만 `ARTIFACT_PREFIX.GAME_ART_FIGMA` / `GAME_ART_HANDOFF` 미리 등록).
- `pathsContainGameArtDoc` / `gameArtSourceOfPath` 가 ui 의 `pathsContainUiDoc` / `uiSourceOfPath` 와 1:1 동형 (sub-source prefix 매칭만; non-canonical path BC 분기는 두지 않는다 — 단방향 원칙).
- `designSubdirOf('game-art-X.json') === 'gameArt'`, `designDirOf` 가 `'visual/game-art/ant'` 반환.

### ❌ 금지

- `game-art-*.json` 파일을 `visual/game-art/` 에 직접 생성 (flat 회귀). LLM 산출물은 반드시 `ant/` 안.
- `ARTIFACT_PREFIX.GAME_ART` 한 prefix 만으로 `pathsContainGameArtDoc` 체크 (sub-source 누적 매칭이 SSOT).
- ui surface 만 sub-sourced 이고 game-art 는 flat (또는 그 역) 이 되는 비대칭 변경.

### ✅ 정책

- 새 game-art 파일은 `designDirOf` 헬퍼를 통해 자동으로 `visual/game-art/ant/` 로 라우팅. 모든 prompt template (`game-art-*-guide-by-{figma,desc}.md`) 의 output path 도 동일.
- `migrateGameArtToAntSubdir` 가 `ensureCanonicalStructure` 에서 호출 — 기존 flat 산출물은 워크스페이스 부팅 시 자동 이동 (idempotent).
- Phase 5+ visual job 활성 시 `figma/` / `handoff/` 도 canonical-dirs 등록 한 줄 추가만으로 활성.

회귀 가드: `tests/design-subsource-symmetry.test.ts` + `tests/assets-dir-canonical.test.ts`.

---

## Prompt Body Stale Variant Discipline — D39 (v9) + D45 (v9.1)

**Prompt template 본문 (`templates/**/*.md`) 은 registry 에서 폐기된 variant 어휘를 인용하지 않는다.** v8 후보 set 으로 좁혀진 `concept` (5종) / `genre` (5종) / `coreLoop` (3종) / `perspective` (1종) / `gameEngine` (1종) 외 폐기된 어휘는 LLM 결정 시 parser 가 reject + retry 비용 증가 또는 default 로 silent fallback 시 token mood-table disconnect 를 일으키므로, prompt body 가 등록 가능 후보만 인용해야 한다.

### ❌ 금지 (slot-keyed pattern — D39)

- `concept=modernCasual` / `concept=sfFantasy` / `concept=darkFantasy` / `concept=threeKingdoms` / `concept=martialArts`
- `genre=puzzle` / `genre=casual` / `genre=arcade` / `genre=action` / `genre=platformer` / `genre=shooter` / `genre=rpg` / `genre=strategy`
- `coreLoop=fight` / `coreLoop=build` / `coreLoop=explore`
- `perspective=3d`
- `gameEngine=godot` / `gameEngine=cocos-creator`
- bare-word `modernCasual` / `sfFantasy` / `darkFantasy` / `threeKingdoms` / `martialArts` (PascalCase concept ids — 일반 영어와 안 겹침)

### ❌ 금지 (4-file strict bare-word — D45 v9.1)

다음 4 preamble 파일은 genre / coreLoop 표를 직접 enumeration 하므로, plain-English 폐기 어휘 (`puzzle` / `casual` / `arcade` / `action` / `platformer` / `shooter` / `rpg` / `strategy` / `fight` / `build` / `explore`) 를 word-boundary 단위로 인용하면 거의 항상 stale registry citation 이다 (일반 prose 사용까지 lint 차단):

- `templates/basis/gameContentTier/_preamble.md`
- `templates/jobs/plan/basis/gameContentTier/_preamble.md`
- `templates/jobs/code/basis/gameContentTier/_preamble.md`
- `templates/jobs/design/basis/gameContentTier/_preamble.md`

(다른 prompt 본문은 일반 영단어 자유 — D45 strict scan 대상 아님. camelCase 합성어 `slidingPuzzle` / `cardSolitaire` / `arcadePaddle` / `arcadeSnake` 은 word-boundary 안 매칭되어 OK.)

### ✅ Allowlist — 의도된 Phase 5+ hook 인용

같은 줄 또는 인접 줄에 `Phase 5+` / `archive` / `deferred` / `hook` / `legacy` / `폐기` 마커가 있으면 OK (D39 + D45 공통). 예: `basis/techTier/gameEngine/_preamble.md` 의 "godot / cocos-creator (Phase 5+ hook) ... deferred ..." 인용 / `jobs/plan/basis/gameContentTier/_preamble.md` 의 "(action, platformer, shooter, rpg, strategy) are deferred to Phase 5+ ... legacy super-categories archived" 인용.

회귀 가드: `tests/prompt-stale-variant-lint.test.ts` (D39 3 cases + D45 3 cases — 6 cases 묶음).

---

## Decision Default × Matrix Consistency — D40 (v9)

**`DecisionTagRegistry` 의 `defaultOnRetryExhaustion` 값은 모든 시점에서 현행 registry / matrix 를 통과해야 한다.** retry 소진 시 fallback 으로 채워 넣는 default 가 parser 자신이 reject 하는 값이면 시스템이 무한 루프 또는 빈 결정으로 진행한다.

`packages/ant-cli/src/core/llm-response/DecisionTagRegistry.ts`:

- `domainTagDef.defaultOnRetryExhaustion ∈ {'service', 'game'}`
- `gameContentTierTagDef.defaultOnRetryExhaustion = { genre, coreLoop }` 가 (a) `genre ∈ GAME_GENRE_VARIANTS` (b) `coreLoop ∈ GAME_CORE_LOOP_VARIANTS` (c) `(genre, coreLoop) ∈ GENRE_CORELOOP_MATRIX[genre]` — 즉 I9 매트릭스 통과
- `gameArtTierTagDef.defaultOnRetryExhaustion` 의 7 axis 값이 각 `GAME_ART_*_VARIANTS` 통과 + 7 axis 모두 채움 (Phase 4 emit)

### ❌ 금지

- 매트릭스 변경 / variant set 좁힘 시 default 갱신 누락.
- registry 에 없는 임의 default 값 도입.

### ✅ 정책

- 매트릭스 / variant set 변경은 default 와 한 commit 안에서 함께 갱신 (`tests/decision-tag-default-matrix-consistency.test.ts` 가 빌드 차단).
- `SUPPORTED_GAME_ENGINES` 가 single-element 인 동안에는 implicit default = `'phaser'` 가 deterministic — Phase 5+ 에 widen 시 default 명시.

회귀 가드: `tests/decision-tag-default-matrix-consistency.test.ts`.

---

## Post-RAC Template Condition SSOT

**Post-RAC template `{{#if ...}}` conditions default to **Gate** (`hasX` — role-agnostic). Role-scoped flags (`hasXRef` / `hasXContext`) are reserved for the rare case where a block's language must distinguish `ref` vs `context` roles — under the 3-axis role model this is almost never warranted. `ArtifactPoolView` is the single source of truth. "Availability meta" blocks that duplicate content already injected via role sections are forbidden; "functional meta" (IDs that LLM output schemas reference) is allowed.**

The RAC-derived pool ([packages/ant-cli/src/agents/common/graph/loadDocumentsForRAC.ts](packages/ant-cli/src/agents/common/graph/loadDocumentsForRAC.ts)) annotates every artifact with `role='ref'` or `role='context'`. The intent matrix ([packages/ant-shared/src/action-config-matrix.ts](packages/ant-shared/src/action-config-matrix.ts)) assigns DIFFERENT roles to the same artifact kind across intents (e.g. UI=ref for `gen-code-sys` but UI=context for `gen-code-spec` / `rev-code`). Under the 3-axis role model, `ref` and `context` are BOTH authoritative inputs — the canonical role definition lives in [jobs/shared/injections/role-guide.md](packages/ant-cli/src/core/prompt/templates/jobs/shared/injections/role-guide.md) and is rendered wherever artifacts are injected. Consequently blocks whose guidance applies to either role MUST gate on presence (Gate), not role.

### 3-axis role model (SSOT: [role-guide.md](packages/ant-cli/src/core/prompt/templates/jobs/shared/injections/role-guide.md))

| Axis | What it decides | Determined by |
|---|---|---|
| **Authority** | Which input wins on conflict | `role` (ref wins over context; both are binding otherwise) |
| **Edit-scope** | Which file(s) are physically written this turn | `target.kind` / `refs.locked` (NOT role) |
| **Task-scope** | How broad the decomposition / plan goes | Presence of `ref` artifacts (or directive when absent); `context` never expands scope |

### 3-category taxonomy (template flags)

```
Template block
   │
   └─ What does this block's copy enforce?
      ├─ "The kind of doc is available; activate guidance/inventory/ladder"
      │      → Gate flag:     hasUi / hasSystemDesign / hasSpec / hasSources
      │                       (DEFAULT — covers every Authority-agnostic block)
      │
      ├─ "The block language must specifically discriminate `ref` vs `context`
      │   for conflict resolution — extremely rare under 3-axis model"
      │      → Contract flag:  hasUiRef / hasSystemDesignRef / hasSpecRef / hasSourcesRef
      │
      └─ "The block must specifically fire ONLY on `context` artifacts"
             → Background flag: hasUiContext / hasSystemDesignContext / …
                                (DEPRECATED — no known legitimate use-site)
```

| Category | Naming | Semantics | Current use-sites |
|---|---|---|---|
| **Gate** | `hasUi`, `hasSystemDesign`, `hasSpec`, `hasSources` | Post-RAC pool has the artifact kind (role-agnostic) | decompose design-system ladder; plan TOKEN / ASSET / LAYOUT INVENTORY; plan base "API Contract IMMUTABLE"; execute visual source hint |
| **Contract** | `hasUiRef`, `hasSystemDesignRef`, `hasSpecRef`, `hasSourcesRef` | `role='ref'` present AND the block's copy specifically discriminates ref vs context for conflict resolution | **no known legitimate use-site today** — the former `hasSystemDesignRef` user moved to Gate `hasSystemDesign` because the IMMUTABLE directive applies regardless of role |
| **Background** | `hasUiContext`, `hasSystemDesignContext`, … | `role='context'` present | **DEPRECATED** — reserved helper kept for test surfaces; no legitimate template use-site under 3-axis model |
| **UiSource discriminator** (Contract-flavoured exception) | `uiSource` | One of `'ant' \| 'figma' \| 'handoff' \| null`. Hard-exclusive by construction. | `ui-source-dispatch` partial (code job), `plan/injections/ui-source-inventory` — the three UI sources have fundamentally different interpretation contracts, so Gate (`hasUi`) alone cannot drive the right guidance. Any new site using `uiSource` MUST include a comment linking this row. |

**Gate-first principle (stronger under 3-axis model)**: Role-scoped flags (`*Ref` / `*Context`) are almost always WRONG. `ref` and `context` are both authoritative inputs — any block that gives guidance for either role should gate on Gate (`hasX`). Introducing a new `*Ref` / `*Context` flag requires a documented rationale explaining why the block's behaviour differs between the two roles.

### ❌ ABSOLUTELY FORBIDDEN

- `{{#if hasUiDoc}}` / `{{#if hasUiDocs}}` / `{{#if hasDesignDoc}}` / `{{#if hasUiInDocuments}}` / any ad-hoc alias — templates must use the exact `ArtifactPoolView` method names (`hasUi`, `hasSystemDesign`, …).
- Adding role-scoped conditions (`hasUiRef` / `hasUiContext`) without an explicit per-block rationale that the block MUST behave differently for `ref` vs `context`. Under the 3-axis model the default is Gate — role-scoped use is the exception, not the rule.
- Reintroducing "ref = authoritative, context = background" wording anywhere. The canonical Role Guide is [jobs/shared/injections/role-guide.md](packages/ant-cli/src/core/prompt/templates/jobs/shared/injections/role-guide.md); any phase needing to show role semantics MUST include that partial instead of reinventing wording.
- "Availability meta" blocks that repeat filenames / paths already visible in role sections (`designDocsMeta`, `uiSectionsSummary`, `uiHint`, "Available source files: …").
- Introducing `insideXxx` path-scan flags for post-RAC phases (those flags are valid ONLY for pre-RAC triage / detect).
- Passing raw `pool.hasUi()` as a template variable without a documented Gate rationale — wrap the call in a node-level constant with a comment citing this section.

### ✅ CORRECT

- Add helpers on `ArtifactPoolView` exactly once per (category × kind); nodes only consume them, never inline new path predicates.
- Per use-site, default to Gate. Only reach for Contract / Background if the block's copy genuinely requires per-role dispatch (document why in a comment).
- **Functional meta is allowed**: path / id lists that the LLM output schema binds to (e.g. `uiSections` IDs, refactor-mode `targetFile` enum) are not "availability meta" — they are inputs the LLM consumes. Keep them, sourced from the pool, clearly commented as "Functional meta".

### Pre-RAC exception

`triage` and `detect` run BEFORE RAC exists. They may keep path-based workspace-scan flags (`hasPrd`, `hasFigmaConfig`, `hasUiDocs`, `hasDesignDoc`, `artifactAvailability`) because no role-annotated pool is available yet. These flags decide WHAT to put into the RAC; once RAC is built, they are obsolete for every downstream phase.

### Why This Matters

The 3-axis model untangles three independent concerns that the legacy "ref=authoritative / context=background" wording had conflated: **which input wins on conflict** (Authority), **which file gets edited this turn** (Edit-scope), and **how wide the task decomposition goes** (Task-scope). Once the axes are separated, nearly every template block that previously looked "ref-specific" turns out to be Authority-agnostic — it applies to whichever artifact kind is present, regardless of role. Hence the stronger Gate-first default.

Historical regressions this SSOT prevents:

1. **Decompose / plan design-system ladder hidden for non-`ref` UI** — `hasUiRef` silently dropped `gen-code-spec` / `rev-code` (UI=context) into the no-ui-docs branch, so token inventory and design-system task guidance disappeared. Fixed by moving to `hasUi` (Gate).
2. **"API Contract IMMUTABLE" notice silently skipped for non-`ref` sys-design** — the legacy `hasSystemDesignRef` gate only fired for `gen-code-sys`; `gen-code-spec` / `rev-code` (sys=context) silently lost the immutability directive despite system-design being an authoritative input. Fixed by moving to `hasSystemDesign` (Gate).
3. **"Background Context / Do NOT treat as implementation source" wording** — the old action-context copy demoted every `context` artifact regardless of the intent's actual authority matrix, breaking `gen-ui-figma` (PRD as context is content SSOT), `gen-code-directive` (refs empty, PRD as context is sole authority), and every `rev-*` intent. Fixed by replacing with the 3-axis Role Guide partial.

### Enforcement

```bash
# Every post-RAC template condition must name an ArtifactPoolView method.
# Pre-RAC phases (triage / detect) are exempt — see "Pre-RAC exception" above.
rg "\{\{#if (hasUi|hasSystemDesign|hasSpec|hasSources)(Ref|Context)?\}\}" \
  packages/ant-cli/src/core/prompt/templates/jobs \
  --glob '!**/nodes/triage/**' --glob '!**/nodes/detect/**'
# Expected: Gate flags dominate; role-scoped use is rare and documented per-site.

# Legacy aliases must be absent from POST-RAC templates (pre-RAC is exempt).
rg "\{\{#if (hasUiDoc|hasUiDocs|hasDesignDoc|hasUiInDocuments)\}\}" \
  packages/ant-cli/src/core/prompt/templates/jobs \
  --glob '!**/nodes/triage/**' --glob '!**/nodes/detect/**'
# Expected: 0 matches.

# Legacy "context = background" wording must be absent.
rg -i "Background Context|Do NOT treat as implementation source|for understanding only|not prescriptive|secondary, for reference only" \
  packages/ant-cli/src/core/prompt/templates \
  packages/ant-cli/src/agents
# Expected: 0 matches.
```

The intent-matrix integration test ([packages/ant-cli/tests/role-flag-intent-matrix.test.ts](packages/ant-cli/tests/role-flag-intent-matrix.test.ts)) is the runtime guard: it asserts `hasUi=true` for every intent that surfaces UI as either ref or context, catching any regression that would re-introduce `hasUiRef` as a Gate.

---

## state.artifacts Post-RAC SSOT

**`state.artifacts` 는 항상 `resolvedAction.refs ∪ context` 의 부분집합이다.** 풀에 데이터를 넣는 SSOT 함수는 두 개뿐:

1. `loadResolvedArtifacts(resolvedAction, featurePath)` — RAC 기반 적재. 호출되는 지점은 (a) `detect` 노드의 정상 경로 + resume fast path, (b) `resolve` 노드의 `onResume` (resume 흐름이 `routeAfterResolve` 의 "Plain resume" / "no tasks" 분기로 detect 를 우회하는 경우의 보완 — 호출하는 함수는 동일).
2. `appendOrUpdatePool(pool, task.files)` — design 잡의 intra-job self-output (직렬 task-completion edge + 병렬 후 `result.completedTasks.flatMap(t => t.files)`).

### Channel A — explicit 파이프라인의 discovery tool RAC 화이트리스트

**`source === 'explicit'` AND `hasExplicitFields === true` AND `refs ∪ context` 비어있지 않을 때**, `code.decompose` 의 discovery tools (`list_files`, `read_file`, scope=`'artifact'`) 는 RAC 화이트리스트를 강제한다. 매칭 규칙:

- 요청 path === RAC entry (exact match — file slot)
- 요청 path 가 RAC entry 의 자식 (`entry/...`) — directory slot
- RAC entry 가 요청 path 의 자식 (`requestedPath/...`) — RAC 디렉토리의 부모 listing 허용 (예: RAC 가 `architecture/spec/` 일 때 `list_files('architecture')` 은 OK)

매칭 실패 시 tool 은 `Error: Path is outside the RAC selection (refs/context). ...` 반환. infer 파이프라인 (`source !== 'explicit'` 또는 RAC 비어있음) 은 racScope=undefined 로 전달되어 기존 동작 유지 (LLM 이 anchor 를 발견할 자유도가 필요).

단일 writer: `decompose/index.ts` 가 `state.resolvedAction` 을 보고 `discoveryCtx.racScope` 를 채운다. 검사 로직 SSOT 는 `discoveryTools.ts::isWithinRacWhitelist`.

### Channel B — explicit 파이프라인의 `deriveArtifactPolicy` mode 게이트

**explicit 파이프라인에서 `deriveArtifactPolicy(taskType, packages, ..., mode='explicit')` 는 `packages` → `fe-system-X.md` / `be-system-X.md` / `api-contract-*` 합성을 스킵한다.** 이유: 사용자가 RAC 를 직접 결정한 turn 에서 자동 ref 합성은 RAC 외부 파일을 task 의 `artifactPolicy.refs` / `include` 에 박는다. 그 path 들은 그 자체로 plan/execute 의 `read_file` tool 에 미끼가 되어 같은 RAC 우회를 후속 phase 에서 재현한다 (Channel B).

UI / design-system 의 `uiSections` 분기는 mode 무관하게 살아있다 — UI 슬롯은 명시적으로 RAC 에 들어왔을 때만 의미가 있고, RAC 부분집합인 pool 에서 그 path 가 실재할 때만 selector 가 fire 한다. spec ref (`activeSpecRefFilename`) 도 RAC pool 에서 derive 되므로 mode 무관 보존.

`packages` 필드 자체는 explicit 파이프라인에서도 **유지** — `resolveTaskTechTiersFromMap` 이 task 별 techTier 매핑에 쓴다. 의미가 좁아질 뿐 (= "tech-tier hint" 만, "design-doc 자동 주입 hint" 아님). 이 분리를 prompt 에서도 강제: `decompose/variants/default/rules.md` 의 Package Tags 섹션과 cross-cutting 가이드는 `{{#if isExplicitPipeline}}` 로 게이트되어 explicit 모드에서는 매핑 표를 보여주지 않는다.

### ❌ ABSOLUTELY FORBIDDEN (Channel A/B 추가)

- discovery tool 의 `scope='artifact'` 처리에서 `racScope` 검사 우회 (path-traversal 검사만 두는 것)
- explicit 파이프라인에서 `deriveArtifactPolicy(..., mode='infer')` 호출 (mode 인자를 createTaskQueue 에서 항상 넘긴다)
- decompose `rules.md` 의 Package Tags 표를 always-on 으로 되돌리기 — `{{#if isExplicitPipeline}}` / `{{#unless isExplicitPipeline}}` 게이트 유지
- `task.artifactPolicy.refs` 또는 `task.include` 에 RAC 외부 path 가 박히는 동작 부활 (현재 회귀 가드: `tests/rac-scope-invariant.test.ts > createTaskQueue mode gate`)

resolve 노드는 새 wholesale 디스크 스캔을 추가할 수 없다. 폐기된 함수 / 호출: `ArtifactService.loadDesignDocuments` / `loadSpecDocuments` / `loadParsedUiContext` (resolve 에서의 호출), `scanDesignOutputs`, `buildArtifactPool`, `buildDesignArtifactPool`. resolve 는 인프라 헬퍼 (figma MCP detect, runtime assets, directive, session context, featureContext) + 위 SSOT 함수 호출만 담당.

`code resolve.loadArtifacts` 는 새 진입 시 `artifacts: []` 를 명시 시드 — 이 빈 배열이 *channel-presence sentinel* 로 detect 의 truthy 검사를 통과시켜 RAC 결과를 채우게 한다. `planner` 처럼 `artifacts` 채널이 없는 잡은 sentinel 을 안 넣으므로 detect 가 spread 자체를 생략 — 잡별 schema 일관성 보존.

pre-RAC presence 신호는 [`state.workspaceState`](packages/ant-cli/src/agents/common/graph/nodes/triage/types.ts) 가 SSOT — triage 의 `analyzeWorkspace` 가 채운다. detect strategy 는 `state.artifacts` 본문을 *읽지 않으며*, `state.workspaceState.{hasSystemDesignDoc, systemDesignFileNames, hasSpecDocs, specDocNames, sourceFileNames, ...}` 만 참조한다.

### ❌ ABSOLUTELY FORBIDDEN

- resolve 에서 `architecture/**` / `visual/**` 또는 `plan/**` 을 RAC 와 무관하게 읽어 `state.artifacts` 에 적재
- `scanDesignOutputs(featurePath)` 같은 전체 디렉토리 walk 결과를 풀에 합산 — 정당한 self-output 은 `task.files` 만
- `state.workspaceState` 와 의미 중복인 새 path-presence 채널 / availability 헬퍼 신설
- detect strategy 가 `state.artifacts[].content` 본문을 LLM 프롬프트에 주입 (path-only flag / 파일명 list 만 허용)
- execute / plan UI 셀프힐이 RAC UI 슬롯 없이 풀을 augment

### ✅ CORRECT

- `state.artifacts` writer 는 `loadResolvedArtifacts` 와 `appendOrUpdatePool(pool, task.files)` 두 곳뿐 — 새 writer 신설 금지
- pre-RAC presence 가 필요하면 `state.workspaceState` 또는 (필요 시) `WorkspaceState` 타입에 path-only 필드 추가
- execute UI 셀프힐 같은 본문 추가 동작은 `resolvedAction.refs ∪ context` 가 해당 슬롯을 가질 때만 허용
- `existingDesignDocs` 같은 잡 내부 본문 cache 는 RAC SSOT 와 별개 채널로 keep — `state.artifacts` 에는 합치지 않음

### Why This Matters

`prime-jetting-grate` 회귀 (`gen-code-directive` 인텐트가 RAC 에 system-design 슬롯을 갖지 않음에도 `architecture/system/fe-system-main.md` 본문이 decompose 프롬프트에 주입되고 task.artifactPolicy.refs 에 박혀 워커가 Cross SDK 레지스트리 코드를 그대로 옮긴 사건) 에서 입증된 것처럼, RAC 검증을 하지 않는 단일 wholesale-load 는 4 개 이상의 누수 채널 (resolve 풀 적재 → decompose tierRefs → decompose `documents` → deriveArtifactPolicy packages 매핑) 에 동시에 영향을 준다. 풀 자체를 RAC 부분집합으로 강제하면 모든 누수 채널이 *셀렉터 패턴* 으로 격하되어 RAC 외부 데이터를 끌어올 수 없게 된다.

`mossy-nearing-gleam` 후속 회귀 (Apr 26 2026) 는 풀-바운드 만으로는 부족함을 보였다 — 두 가지 보완 채널이 살아있었다: (1) decompose discovery tool 이 `scope='artifact'` 일 때 path-traversal 만 검사하고 RAC 화이트리스트를 적용하지 않아 LLM 이 `read_file('architecture/system/fe-system-main.md')` 로 디스크 직접 우회 가능 (Channel A); (2) `deriveArtifactPolicy` 가 `packages` 만 보고 RAC 외부 path 를 task `refs` 로 합성 (Channel B). 두 채널을 동시에 닫지 않으면 prompt 자체의 `fe-main → fe-system-main.md` 매핑 표가 LLM 에게 "이 파일이 분명히 권위" 라고 가르쳐 우회를 유발한다.

### Enforcement

```bash
# 풀 wholesale-load helper 호출 잔존 0 건 (주석 언급은 허용 — 호출 형태만 검사)
rg "scanDesignOutputs\(|buildDesignArtifactPool\(|buildArtifactPool\(" packages/ant-cli/src
# Expected: 0 matches

# resolve 노드가 design/spec/UI artifact 를 직접 읽는 호출 0 건
rg "loadDesignDocuments\(|loadSpecDocuments\(|loadParsedUiContext\(" \
  packages/ant-cli/src/agents/architect/graph/code/nodes/resolve \
  packages/ant-cli/src/agents/architect/graph/design/nodes/resolve.ts
# Expected: 0 matches (execute UI 셀프힐의 loadParsedUiContext 는 RAC UI 슬롯 가드 안에서만 호출됨 — 별도 위치)

# detect strategy 가 풀 본문에 의존하지 않는지 확인 (path-presence 만 허용)
rg "state\.artifacts\[" packages/ant-cli/src/agents/architect/graph/code/nodes/detect \
  packages/ant-cli/src/agents/architect/graph/design/nodes/detect
# Expected: 0 matches

# Channel A — discovery tool 이 racScope 를 받아 검사하는지 확인
rg "racScope" packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/discoveryTools.ts
# Expected: positive matches (DiscoveryToolContext.racScope + isWithinRacWhitelist)

# Channel B — deriveArtifactPolicy 가 mode 인자를 받고 explicit 분기가 있는지 확인
rg "ArtifactPolicyMode|mode === 'infer'" packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/responseParser.ts
# Expected: positive matches

# decompose 가 isExplicitPipeline 을 prompt vars 에 주입하는지 확인
rg "isExplicitPipeline" packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/index.ts
# Expected: positive matches (computed from resolvedAction.source + hasExplicitFields + RAC non-empty)
```

회귀 테스트: [`packages/ant-cli/tests/rac-scope-invariant.test.ts`](packages/ant-cli/tests/rac-scope-invariant.test.ts) 가 `gen-code-directive` + PRD-only RAC 시나리오에서 풀이 RAC 부분집합인지, discovery tool 이 RAC 외부 path 를 거부하는지, `createTaskQueue(..., 'explicit')` 결과의 `task.artifactPolicy` / `task.include` 가 RAC 외부 path 를 포함하지 않는지 모두 검증한다. 추가로 [`packages/ant-cli/tests/artifact-policy-decompose.test.ts`](packages/ant-cli/tests/artifact-policy-decompose.test.ts) 가 `deriveArtifactPolicy` 의 mode 별 동작을 잠근다.

---

## UiSource — three hard-exclusive UI inputs (code & design jobs)

**UI 설계 입력은 정확히 하나의 `UiSource` 만 선택된다. 세 값(`ant` / `figma` / `handoff`)은 RAC 슬롯 레벨에서 hard-exclusive 하게 강제되며, 혼합된 RAC 는 `validateUiSourceExclusivity` 가 throw 로 거부한다.**

| UiSource | 물리 경로 | 의미 | 해석 |
|---|---|---|---|
| `ant` | `visual/ui/ant/` | design job 산출물 (`ui-tokens/assets/spec.json`) | 스키마 기반 직접 해석 — 기존 파이프 |
| `figma` | `visual/ui/figma/figma.json` | figma 작업 파일 **참조** (URL 만) | MCP tool 로 실시간 탐색 — 저장된 탐색 결과는 없음 |
| `handoff` | `visual/ui/handoff/**` | 자유 형식 파일 번들 (html/css/md/json/png) | FPOP — 관찰만, 스키마 추론 금지 |

### ❌ ABSOLUTELY FORBIDDEN

- 한 RAC 안에 `visual/ui/ant/**` 와 `visual/ui/figma/**` (또는 handoff) 를 섞어 넣는 코드
- `figma.json` 에 탐색 결과 (variable dumps / frame JSON / screenshots) 를 persist 하려는 시도 — 이 파일은 **항상 URL+nodeId 메타만** 담는다
- `state.figmaAvailable` 같은 파생 scalar 를 state channel 로 부활시키기 — `resolvedAction.mcpSources.figma != null` 이 SSOT
- `ARTIFACT_PREFIX.UI_SPEC` 같은 legacy prefix 부활시키기 — 새 SSOT 는 `ARTIFACT_PREFIX.UI_ANT_SPEC` (`visual/ui/ant/spec/`)
- legacy 평탄 / 옛 트리 경로 지원을 되살리는 fallback (FLAT_UI_DOC_REGEX 는 영구 제거)

### ✅ CORRECT

- 슬롯 정의: `action-config-matrix.ts` 의 `uiSourceRef()` / `uiSourceCtx()` 헬퍼 사용. 커스텀 dir+label 튜플을 직접 작성하지 않는다
- 풀 discriminator: `new ArtifactPoolView(pool).uiSource()` — `'ant' | 'figma' | 'handoff' | null` 반환. 혼합 시 throw
- 프롬프트 dispatch: `{{> jobs/code/base/injections/ui-source-dispatch}}` 가 `uiSource` 변수에 따라 정확히 하나의 source partial 을 include
- figma MCP 가용성: `resolvedAction.mcpSources.figma` 존재 여부로 판단 — resolve 가 `detectFigmaSource` 헬퍼로 채움
- `BaseTask.uiSource` 필드는 BE-internal (FE 표시 안 함). decompose 가 풀에서 derive 해 task 생성 시 주입

### Why This Matters

세 UI 소스는 **해석 규약 자체가 다르다** — ant 는 스키마 있음, figma 는 실시간 MCP 탐색, handoff 는 규약 없음. 프롬프트가 이 셋을 한 블록에서 동시에 지원하려 들면 각 source 의 특수 규칙이 서로의 안내 문구에 섞이며 LLM 품질이 떨어진다. hard-exclusive + per-source partial 은 이 섞임을 구조적으로 차단한다.

### Enforcement

```bash
# legacy 평탄 UI 경로 / 구 prefix 가 살아있지 않은지
rg "ARTIFACT_PREFIX\.UI_SPEC\b|FLAT_UI_DOC_REGEX" packages/ant-cli/src
# Expected: 0 matches

# state.figmaAvailable 가 code job state 에 부활하지 않았는지
rg "figmaAvailable\?\s*:\s*boolean" packages/ant-cli/src/agents/architect/graph/code
# Expected: 0 matches
```

### Contract exception note (Post-RAC Template Condition SSOT)

`uiSource` 는 Gate-first 원칙의 **문서화된 예외**다. 세 source 의 해석 규약이 원천적으로 다르므로 Gate (`hasUi`) 만으로는 올바른 안내를 낼 수 없다. partial 정의부에 "Contract exception — per-source interpretation is required" 주석을 남긴다.

---

## Code Style

- TypeScript strict mode
- ESLint + Prettier
- Console logs use emoji prefixes (e.g., `📄 [DocGen]`, `🔧 [Tool]`)

### Comments — lean by default (에이전트/인간 공통)

- **주석 과다 금지.** 줄마다 설명을 달거나, 블록 주석으로 구현을 “번역”하지 않는다. **한 파일·한 diff 안에서 주석(빈 줄 제외 non-code line)이 실행 코드보다 길거나 많아지는 패턴은 금지**다. 코드가 읽히게 이름·분리·타입으로 표현한다.
- 이미 있는 주석·코드를 “설명용 주석”으로 덮어쓰지 않는다. 새 주석은 **비명확한 불변식, 외부 계약, 왜 이 방식인지(안전/성능/회귀 한 줄)** 같이 코드만으로 전달하기 어려운 곳에만 최소한으로 추가한다.
- **JSDoc**은 공개 API·소비자가 봐야 할 계약·`@deprecated` 등 **필요할 때만 짧게**. 모든 함수에 장문 JSDoc을 의무로 붙이지 않는다. 당연한 동작을 JSDoc으로 반복하지 않는다.

---

## Prompt Engineering

Rules for authoring Handlebars prompt templates under `packages/ant-cli/src/core/prompt/templates/`. Three concerns, one section.

### 1. WHAT / HOW separation (file naming)

| Prefix | Role | Content |
|--------|------|---------|
| `base*.md` | **WHAT** | Context, data, current state, task definition, dynamic Handlebars interpolation |
| `rules*.md` | **HOW** | Rules, formats, constraints, prohibitions — no dynamic data |

**For all NEW or substantively REWRITTEN files**, follow the discipline strictly:

- **Do NOT** put rules/constraints (`⚠️ You MUST...`, `DO NOT ...`, `NEVER ...`) in `base*.md`.
- **Do NOT** put dynamic interpolation (`{{{fieldName}}}`, `{{#if ...}}`) in `rules*.md`.

**Transitional note**: A non-trivial number of pre-existing `base*.md` files contain `⚠️ You MUST` / `DO NOT` directives, and several `rules*.md` files contain Handlebars conditionals. These are tolerated for now and cleaned up opportunistically when the surrounding template is rewritten — they MUST NOT be cited as precedent for new violations. The split is enforced by reviewer judgement, not by a CI lock.

✅ Correct split:

```markdown
<!-- base.md (WHAT) -->
🎯 YOUR CURRENT TASK: {{taskId}}

### 📋 Task Description
{{{taskDescription}}}
```

```markdown
<!-- rules.md (HOW) -->
## CHAPTER SCOPE CONSTRAINT
1. ONLY generate content described in YOUR task description
2. NEVER generate content that belongs to OTHER chapters
```

### 2. Directory layout

```
packages/ant-cli/src/core/prompt/templates/
├── domain/{d}.md                            # workspace-level domain identity (D27 v6 — service / game)
├── basis/                                   # tier-gated content + shared policy partials
├── jobs/{job}/
│   ├── base/{system,user,injections}/       # job-level shared blocks (system, base, injections)
│   ├── domain/{d}.md                        # job × domain overlay (D27 v6)
│   ├── basis/                               # job × tier overlay
│   └── nodes/{node}/
│       ├── {base,rules}.md                  # default (when no variants)
│       └── variants/{variant}/{base,rules}.md   # variant-specific (e.g. verification, error, ui-design-by-figma)
├── jobs/shared/nodes/{node}/variants/{variant}/{base,rules}.md  # cross-job (e.g. triage)
└── infra/                                   # infra-level partials (compaction, etc.)
```

Note: there is no top-level `templates/agents/` directory. Agent-level system prompts live elsewhere in the codebase. The `domain/` tree is the workspace selector layer (D27 v6) and sits above the basis tier.

Templates are auto-registered as Handlebars partials by `initPartials()` at server startup. Adding/renaming a `.md` file requires no code change. (Files under `templates/basis/**` are intentionally NOT registered as partials — see "Basis Partial Invariant" above.)

### 3. Language & platform neutrality

**All prompt templates MUST be written in English only.**

- ❌ NO Korean or other non-English text
- ❌ NO project-specific examples (`Hero.tsx`, `page.tsx`, etc.)
- ❌ NO platform-specific terms (`React`, `Tailwind`, `Next.js`)
- ✅ Generic, platform/language-neutral wording (`component`, `container`, `element`)

Ant supports frontend / backend / fullstack across multiple languages. Prompts must not assume a stack.

### 4. FPOP — First-Principles Observation Prompting

**All prompts MUST follow FPOP.** The underlying rule:

> "Specify observation targets and constraints as principles, not concrete examples or methods."

#### The 6 principles

| Principle | ❌ Bad | ✅ Good |
|---|---|---|
| **Principles over Examples** | "Footer is column" | "Each container decides direction independently" |
| **What over How** | "Top → flex-start" | "Observe cross-axis position" |
| **Observable over Assumed** | "Add overlay" | "If not observed, do NOT add" |
| **Universal over Specific** | "React component" | "component" |
| **Constraints over Instructions** | "Do this way" | "Do NOT assume" |
| **Reminders for Blind Spots** | generic list | "⚠️ Cross-axis REQUIRED" |

#### Mandatory authoring workflow

Before writing or editing any prompt template, run this check silently:

```
❌ Any of these present? → remove / convert to principle
  - Concrete project examples (Footer, Hero, Card)
  - Method explanations (CSS properties LLM already knows)
  - Edge case enumeration (If A→X, B→Y, C→Z)
  - Platform-specific terms (React, Tailwind)
  - Value mappings (Top=flex-start)

✅ All of these present? → add if missing
  - Observation target stated
  - Constraint stated (what NOT to do)
  - Principle stated (applies to all cases)
  - Blind spots flagged with ⚠️ when easily missed
  - Universal language used (container / element / component)
```

#### FPOP vocabulary (use these terms in review)

| Term | Meaning |
|---|---|
| **Principle** | Rule applicable to all cases |
| **Constraint** | What NOT to do |
| **Blind Spot** | What LLM easily misses |
| **Observable** | What can be seen in screenshot / input data |
| **Edge Case Leakage** | Specific cases infiltrating a prompt |

Example review shortcuts: *"Remove edge case leakage, keep principles only"*, *"Convert this to FPOP format"*, *"Validate against FPOP checklist"*.

### 5. SBS — Scope-Bound Specificity

**A prompt fragment's required abstraction level is bounded by its activation scope. FPOP's "Universal over Specific" applies to unconditionally-injected content; gate-injected content MUST be specific along the gate's discriminator axis. Going more abstract than the gate erases the very signal that justifies the conditional injection.**

SBS sits beside FPOP and MECE as the third prompt-authoring policy. It exists because FPOP alone, read literally, would forbid `basis/techTier/framework/nextjs.md` from naming Next.js — yet that file's whole purpose is Next.js-specific blind-spot recall.

#### Specificity floor rule

```
specificity_floor(template) = activation_scope(template)
```

| Outcome | Diagnosis |
|---|---|
| more abstract than gate | **SBS violation** — gate's information payload = 0 |
| concrete on a non-gate axis | **FPOP violation** — scope creep ("Universal over Specific" bites) |
| concrete on the gate's axis only | **Compliant** |

#### Gate axes (broad scope — SBS applies whenever any of these gate the template)

| Axis | Examples |
|---|---|
| **techTier** | `framework=nextjs`, `language=typescript-browser`, `version=react@19`, runtime |
| **intent** | `gen-code-sys`, `rev-code`, `gen-code-spec`, `gen-ui-figma`, … |
| **taskType** | `verification`, `error`, `ui`, `feature`, `setup`, `test-code`, `doc` |
| **mode** | `generate` / `refactor` / `explain` |
| **role** | `ref` / `context` / `target` (3-axis Authority) |
| **artifact-presence** | `hasUi` / `hasSpec` / `hasSystemDesign` / `hasSources` / `uiSource` discriminator |

#### Activation-scope ladder

| Activation location | Gate | Specificity floor |
|---|---|---|
| `agents/{agent}/system.md` | always-on | Universal — FPOP only |
| `jobs/{job}/base/system.md` | job axis | job-axis specifics only |
| `basis/techTier/framework/<X>.md` | `framework=X` | X's versions / APIs / toolchain — REQUIRED |
| `basis/techTier/language/<X>.md` | `language=X` (+ stack) | X+stack specifics — REQUIRED |
| `nodes/{phase}/variants/<V>/*.md` | intent / taskType / mode variant | V-specifics — REQUIRED |
| `common/injections/refactor-guidance.md` | `mode=refactor` | refactor-mode specifics — REQUIRED |
| `common/injections/ui-source-{ant,figma,handoff}.md` | `uiSource=X` | source-X interpretation contract — REQUIRED |

#### ❌ ABSOLUTELY FORBIDDEN

- Citing FPOP's "Universal over Specific" against a gate-injected file to demand removal of the gate's discriminator name (e.g. asking `basis/techTier/framework/nextjs.md` to drop "Next.js" wording). The gate IS the justification.
- Authoring a gated file whose body would survive verbatim if the gate were a different value — that's a wasted gate (SBS violation).
- Mixing scopes inside one file: pulling generic React advice into `nextjs.md` instead of the shared `_react-core` partial; pulling refactor-only language into a default execute template.
- Always-on templates (`agents/*/system.md`, `jobs/*/base/system.md`) naming a specific framework/library/runtime version — that's still an FPOP violation; SBS does not relax FPOP for non-gated content.
- Hiding gate-specific content behind FPOP-style abstraction in the name of "generality" — e.g. an `intent=gen-ui-figma` variant that says only "read the design source" without the Figma MCP / live-fetch contract.

#### ✅ CORRECT

- `basis/techTier/framework/nextjs.md` MUST mention "Next.js" (and its versions, APIs, toolchain) by name. The framework gate makes this content SBS-required, not FPOP-prohibited.
- `common/injections/refactor-guidance.md` MUST encode refactor-mode invariants ("public API surface immutable") that would not apply in `generate` mode.
- Intent / taskType / mode variants must visibly differ from the default and from siblings — if you can't tell which variant a paragraph came from with the path hidden, the variant is SBS-empty.
- Always-on agent/system templates stay platform-/library-/version-agnostic; framework specifics live ONLY behind a techTier gate.

#### Reading SBS together with FPOP

For every paragraph in a template, run two checks:

1. **SBS check**: Is this paragraph specific along the file's activation gate? If no, it should be lifted to a less-gated location or rewritten to use the gate's discriminator name(s).
2. **FPOP check**: Is this paragraph specific along an axis OTHER than the file's activation gate? If yes, it should be lifted out (or removed) — that's scope creep.

A compliant paragraph passes both: specific exactly along the gate, generic everywhere else.

#### Enforcement

```bash
# Sanity grep: every gated framework hint file must reference its framework name.
for f in packages/ant-cli/src/core/prompt/templates/jobs/*/basis/techTier/framework/[a-z]*.md; do
  name=$(basename "$f" .md)
  rg -i -q -- "$name" "$f" || echo "SBS suspect (gate=$name not referenced): $f"
done
# Expected: no output. Files prefixed with `_` are partials and exempt — they
# inherit specificity from the consumer file that includes them.
```

This is a soft sanity check, not a build gate — SBS is a semantic policy and most violations require human review of "is this gate's discriminator actually addressed?". Use it as a reviewer aid, not a CI lock.
