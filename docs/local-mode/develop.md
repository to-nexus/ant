# Local Mode — Develop

For contributors building **Ant core** locally — or maintainers of a
private fork. If you only want to run Ant against your own codebase, see
[install.md](install.md) instead.

## Monorepo layout

```
packages/
├── ant-cli/        Backend: API + Job worker + Realtime + Preview entry points
├── ant-ui/         Frontend: React + Vite SPA
└── ant-shared/     Cross-package TypeScript types (no runtime code)
```

`ant-shared` has no build step — it's referenced directly from source via
pnpm workspace resolution.

There's also:

```
packages/ant-site/   Marketing site (Next.js). Not part of the runtime.
```

## Four-process architecture

`ant-cli` is one codebase that ships as four separate processes. The
entry point and env vars decide which one starts:

| Process | Port | Entry point |
|---------|------|-------------|
| `ant-api` | 4100 | `composition/server.ts` |
| `ant-realtime` | 4101 | `infrastructure/realtime/start-realtime-server.ts` |
| `ant-job` | — | `infrastructure/worker/start-job-worker.ts` |
| `ant-preview` | 4102 | `infrastructure/preview/start-preview-server.ts` |

Inter-process communication is exclusively via Redis (Pub/Sub, KV,
BullMQ). **There is no direct HTTP between processes.** Local mode and
cloud mode share the same data plane; local just runs all four on one
machine.

Read [../internals/02-infrastructure.md](../internals/02-infrastructure.md)
for the canonical Redis key layout, queues, and pub/sub channels.

## Architectural rules

Ant has a small set of binding rules that protect the core contract.
The full SSOT lives in [AGENTS.md](../../AGENTS.md) — what follows is a
contributor's pocket version:

- **Unified Distributed System Principle.** No in-memory fallbacks for
  Redis or BullMQ. If a feature can't work without Redis, fix it; don't
  add a Map.
- **Phase nodes are task-type blind.** No `if (task.type === 'verification')`
  inside `nodes/`, `routers/`, `parallel/`, or `common/tool/handlers/`.
  Task-specific logic lives in `tasks/{type}/hooks/`.
- **PromptBuilder is the only prompt entry point.** Don't call
  Handlebars or `render()` directly — that bypasses the system / rules /
  base / domain / basis / node layering.
- **`state.artifacts` is RAC-bound.** Only `loadResolvedArtifacts` and
  `appendOrUpdatePool` may write to the artifact pool. No wholesale
  disk scans in `resolve`.
- **Tier-Verification matrix.** Tier 2 = 1 task with `selfVerifyOnDone:
  true`. Tier 3/4 = 2+ tasks including a final verification task.
- **`launchMode` SSOT (Phase 1).** FE state field is `launchMode`, not
  `backendMode`. localStorage key is `ant-ui:launch-mode`. Origin
  detection helper is `domain/store/launchModeInit.ts`.
- **Project Lifecycle SSOT.** `repoType` default is `'cloud'`; do not
  auto-map `launchMode` → `repoType`.

When in doubt, read [AGENTS.md](../../AGENTS.md). It includes
regression-guard test names next to every rule.

## Daily loop

```bash
pnpm dev:local:all            # boot everything with hot reload
pnpm test:cli                 # ant-cli vitest suite
pnpm typecheck                # all packages
pnpm build                    # type-check + test + build
```

`pnpm build` runs the full test suite as a prebuild gate — failing
tests abort the build. Don't bypass it (`--no-verify`, `[skip ci]`).

To run a single test file:

```bash
cd packages/ant-cli
pnpm vitest run tests/<area>/<file>.test.ts
```

Frontend-only:

```bash
cd packages/ant-ui
pnpm test
pnpm dev                      # only the Vite dev server
```

## Coding conventions

### TypeScript

- Strict mode is on. Don't turn it off in a PR.
- Explicit types at module boundaries (exported functions, public
  classes). Local inference is fine.
- Prefer `unknown` over `any`; if you need `any`, justify it in a
  comment.

### Comments

- Lean by default. Don't translate code line-by-line. One short
  sentence for non-obvious invariants only.
- JSDoc only for public APIs and `@deprecated` markers.
- The rationale + boundaries are in [AGENTS.md § "Comments — lean by
  default"](../../AGENTS.md).

### Commit messages

- **English only**, regardless of the conversation or comment language.
- **Conventional Commits** format: `<type>(<scope>): <summary>`.
- Common types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`,
  `perf`.

Real-world examples from the repo:

```
feat(preview): Phase 1 service virtualization — ConnectionDetector + @connection grammar
fix(decompose): retry on JsonSyntaxViolation in LLM task JSON parse
refactor(preview): drop mock:* annotation tokens
```

### Prompt templates

If you touch any file under
`packages/ant-cli/src/core/prompt/templates/`, read [AGENTS.md §
"Prompt Engineering"](../../AGENTS.md) first. Prompts are part of the
public surface the agents stand on; small drifts produce hard-to-debug
regressions.

The three policies to remember: **FPOP** (Principles over Examples,
What over How, Observable over Assumed, Universal over Specific,
Constraints over Instructions, Reminders for Blind Spots), **SBS**
(gated templates must be specific along the gate axis; always-on
templates must stay universal), **MECE** (the Service Virtualization
SSOT table is a worked example).

Prompt files are **English only**. Source comments may be Korean if
that's the team's working language, but `.md` templates are not.

## Pull requests

Quick checklist:

- [ ] `pnpm build` succeeds locally (tests run as the prebuild gate).
- [ ] `pnpm typecheck` is clean.
- [ ] You added or updated tests when changing behavior.
- [ ] No incident codenames or internal hostnames in code or docs.
- [ ] If you touched prompts, you ran the relevant prompt-policy tests
      ([AGENTS.md](../../AGENTS.md) "Enforcement" blocks).
- [ ] PR description follows the template
      (`.github/PULL_REQUEST_TEMPLATE.md`).

### Sizing

- Target **< 400 changed lines** of production code per PR.
- One concern per PR (refactor + feature in separate PRs).
- Tests in the same PR as the behavior they cover.

Large refactors land as a stack of PRs; describe the stacking order in
the first PR's body.

### Phase-split work

For multi-phase plans (see this branch's plan files in
`.claude/plans/`), the convention is:

- One PR per phase.
- Each phase merges before the next phase opens.
- Cross-phase contracts (e.g. `/auth/me`'s `needsOnboarding` field
  between Phase 2 and Phase 3) are documented in the plan and locked in
  by regression tests in the earlier phase.

This sequencing keeps each PR independently reviewable and reversible.

## Next steps

- [AGENTS.md](../../AGENTS.md) — binding SSOT for human and AI
  contributors.
- [../internals/](../internals/) — deep dives (Redis key layout,
  prompt system, node graph, debug logging).
- [../testing/](../testing/) — testing strategy and runbooks.
- [../../CONTRIBUTING.md](../../CONTRIBUTING.md) — PR workflow and
  Code of Conduct.
