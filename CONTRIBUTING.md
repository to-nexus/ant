# Contributing to Ant

Thanks for your interest in Ant. This document describes how to set up the
project locally, the conventions we follow, and how to send a pull request
that has the best chance of getting merged quickly.

If you only have a few minutes, please read **[Quick checklist](#quick-checklist)**.

This project and everyone participating in it is governed by our
[Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to
uphold it.

---

## Project Layout

```
packages/
├── ant-cli/          Backend: API / Job worker / Realtime / Preview
├── ant-ui/           Frontend: React + Vite SPA
├── ant-site/         Marketing site (Next.js, static export) — not part of the runtime
├── ant-auth-client/  Shared browser auth helpers (ant-ui + ant-site)
└── ant-shared/       Types + shared runtime used by every package
docs/
├── local-mode/       install + develop on your own machine
├── cloud-mode/       install + develop for managed or self-host cloud
├── getting-started/  first-feature walkthrough, troubleshooting
├── concepts/         architecture, agents, jobs, execution tiers
├── guides/           design input, custom prompts, observability
├── reference/        CLI, env vars, API, shared types
└── internals/        contributor-only deep-dives (SSOT, debug logging)
```

`ant-shared` exports both types and runtime code (canonical paths, the
action-config matrix, pricing, tier matrices). Consumers resolve `types` to
`src/` directly through pnpm workspace resolution, so type changes need no
build — but **runtime** changes do: run
`pnpm --filter @ant/shared build` after editing them.

## Prerequisites

- **Node.js** >= 22.13 (enforced by the root `engines` field)
- **pnpm** 11.1.0 — pinned via `packageManager`
  (`corepack enable && corepack prepare pnpm@11.1.0 --activate`)
- **Docker** + Docker Compose — Redis is required; ChromaDB and the
  visual-processor are optional sidecars
- **Git** 2.40+
- An LLM provider API key — Anthropic Claude is the primary supported model.
  Five other providers are wired; see the [README](README.md#providers).

## Local Setup

- **Install** — [docs/local-mode/install.md](docs/local-mode/install.md)
- **Develop conventions** — [docs/develop.md](docs/develop.md)

Open http://localhost:4200 after `pnpm dev:all`.

## Daily Loop

| Task                          | Command                                       |
|-------------------------------|-----------------------------------------------|
| Run all tests (CLI)           | `pnpm test:cli`                               |
| Run all tests (UI)            | `pnpm --filter @ant/ui test`                  |
| Run a single test file        | `cd packages/ant-cli && pnpm vitest run tests/<path>` |
| Type-check everything         | `pnpm typecheck`                              |
| Type-check the test suite     | `pnpm typecheck:tests`                        |
| Build the project             | `pnpm build`                                  |
| Tear down infra               | `pnpm dev:infra:down`                         |

**`pnpm build` does not run tests, and no `prebuild` hook should be added** —
the Dockerfile builds with `pnpm build:cli`, and charging every image build the
full suite is a deliberate non-goal. **CI is the only gate**
([.github/workflows/ci.yml](.github/workflows/ci.yml)): `typecheck:cli`,
`typecheck:ui`, `typecheck:tests`, `test:cli`, `@ant/ui test`, plus the
`oss-guard` and `boot-smoke` jobs. Run those four commands locally before you
push.

## Coding Conventions

### TypeScript

- **Strict mode** is on. Do not turn it off in PRs.
- Prefer **explicit types** at module boundaries (exported functions, public
  classes). Local inference is fine.
- Use `unknown` over `any`. If you need `any`, justify it in a code comment.
- Keep modules small and cohesive — one concept per file.

### Code Style

- ESLint + Prettier are authoritative. `pnpm lint` (when configured per
  package) and editor format-on-save handle the basics.
- Console logs use **emoji prefixes** for grep-ability:
  `📄 [DocGen]`, `🔧 [Tool]`, `🚀 [JobWorker]`, etc. Keep them consistent
  with the surrounding module.
- Comments are lean. Don't translate code line-by-line. Add comments only for
  non-obvious invariants, external contracts, or tricky trade-offs (one
  sentence is usually enough). See [AGENTS.md](AGENTS.md) "Comments — lean by
  default" for the full rationale.
- JSDoc only for public APIs and `@deprecated` markers. Don't JSDoc every
  function.

### Architecture Rules

Ant has a small set of binding architectural rules that protect the core
contract. The full SSOT lives in [AGENTS.md](AGENTS.md), but the most common
ones to remember:

- **Distributed-system principle**: no in-memory fallbacks for Redis / BullMQ.
  If it doesn't work without Redis, fix it; don't add a Map.
- **Phase nodes are task-type blind**: never write
  `if (task.type === 'verification')` inside `nodes/`, `routers/`, or
  `parallel/` — task-specific logic lives in `tasks/{type}/hooks/`.
- **PromptBuilder is the only entry point for prompts.** Do not call
  Handlebars or `render()` directly to bypass system layers.
- **state.artifacts is RAC-bound.** Only `loadResolvedArtifacts` and
  `appendOrUpdatePool` may write to the artifact pool.

When in doubt, read [AGENTS.md](AGENTS.md). It is the canonical reference and
includes regression-guard test names for every rule.

### Tests

- Test files live next to the package they cover, e.g.
  `packages/ant-cli/tests/<area>/*.test.ts`.
- Use **Vitest**. Prefer behaviour-level tests over implementation tests.
- New invariants in core agent / orchestrator code should ship with a test
  that fails when the invariant is violated.
- Snapshot tests are allowed but should be small and reviewed.

### Prompt Templates

If you touch any file under
`packages/ant-cli/src/core/prompt/templates/`, read the **Prompt Engineering**
section in [AGENTS.md](AGENTS.md) first. Prompts are part of the public API
the agents stand on; small drifts produce hard-to-debug regressions.

Key disciplines:

- **FPOP**: principles over examples, what over how, observable over assumed.
- **SBS**: gated templates must be specific along the gate axis; always-on
  templates must stay universal.
- **Language**: prompt templates are **English only**. Comments in source
  files may be Korean if helpful, but no Korean lands in `.md` templates.

## Pull Requests

### Quick Checklist

Before opening a PR, please confirm:

- [ ] `pnpm typecheck` and `pnpm typecheck:tests` are clean
- [ ] `pnpm test:cli` and `pnpm --filter @ant/ui test` pass
- [ ] You added or updated tests when changing behaviour
- [ ] No incident codenames or internal hostnames in code, comments, or docs
- [ ] If you touched prompts, you ran the relevant prompt-policy tests (see
      [AGENTS.md](AGENTS.md) "Enforcement" blocks)
- [ ] PR description follows the template (`.github/PULL_REQUEST_TEMPLATE.md`)

### Sizing

Keep PRs small. A good target:

- **< 400 changed lines** of production code.
- One concern per PR (refactor + feature in separate PRs).
- Tests in the same PR as the behaviour they cover.

If a refactor is large, split it into a stack of PRs and describe the order in
the first PR's description.

### Commit Messages

We use **Conventional Commits**:

```
<type>(<scope>): <short summary>

<body — optional, wrap at 72 cols>
```

Common types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`.

Examples (from real commits):

```
feat(preview): Phase 1 service virtualization — ConnectionDetector + @connection grammar
fix(decompose): retry on JsonSyntaxViolation in LLM task JSON parse
refactor(preview): drop mock:* annotation tokens
```

### Review Process

- One maintainer approval is required to merge.
- We use **squash merge** by default — your branch's commit history will be
  squashed into one commit on `main`.
- CI must be green. Don't `[skip ci]` to bypass.
- Ant is maintained by one person, so reviews are best-effort. If a PR has had
  no response after a week, bump it with a comment — that is not rude, it is
  helpful.

## Reporting Bugs

- For **security** issues, see [SECURITY.md](SECURITY.md). Please do not file
  public issues for vulnerabilities.
- For **functional** bugs, open an issue using the bug-report template
  (`.github/ISSUE_TEMPLATE/bug_report.yml`). Include reproduction steps, the
  command you ran, and the relevant logs (redact API keys).

## Proposing Features

- Open an issue using the feature-request template before writing a large
  patch. We want to align on direction first.
- For changes that affect cross-package contracts (`@ant/shared` types, SSE
  events, Redis keys), include a short design note in the issue.

## License

By contributing you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), the same license that covers the project. This
is the default Apache-2.0 §5 behaviour — there is **no CLA to sign and no DCO
sign-off required**.

If you add a dependency whose license is not MIT / ISC / Apache-2.0 / BSD, note
it in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) in the same PR.

## Getting Help

- **Documentation**: start with `docs/local-mode/install.md` and `docs/concepts/`.
- **Discussions**: for open-ended questions, use
  [GitHub Discussions](https://github.com/to-nexus/ant/discussions). There is no Discord or other chat
  channel — a one-person project cannot staff one, and a dead server is worse
  than none.

Thanks again for contributing.
