# Contributing to Ant

Thanks for your interest in Ant. This document describes how to set up the
project locally, the conventions we follow, and how to send a pull request
that has the best chance of getting merged quickly.

If you only have a few minutes, please read **[Quick checklist](#quick-checklist)**.

---

## Code of Conduct

By participating you agree to follow our Code of Conduct (Contributor Covenant
2.1). Be kind, assume good faith, and call out violations privately to the
maintainers.

## Project Layout

```
packages/
├── ant-cli/        Backend: API / Job worker / Realtime / Preview
├── ant-ui/         Frontend: React + Vite SPA
└── ant-shared/     Shared TypeScript types (no runtime code)
docs/
├── local-mode/       install + develop on your own machine
├── cloud-mode/       install + develop for managed or self-host cloud
├── getting-started/  first-feature walkthrough, troubleshooting
├── concepts/         architecture, agents, jobs, execution tiers
├── guides/           design input, custom prompts, observability
├── reference/        CLI, env vars, API, shared types
└── internals/        contributor-only deep-dives (SSOT, debug logging)
```

`ant-shared` is a source-only workspace package — no build step. Both
`ant-cli` and `ant-ui` import from it directly through pnpm workspace
resolution.

## Prerequisites

- **Node.js** 18.17+ (LTS recommended)
- **pnpm** 9 or 10 (`corepack enable && corepack prepare pnpm@10 --activate`)
- **Docker** + Docker Compose for local infra (Redis, ChromaDB)
- **Git** 2.40+
- An LLM provider API key — Anthropic Claude is the primary supported model.
  OpenAI works for most jobs.

## Local Setup

- **Install** — [docs/local-mode/install.md](docs/local-mode/install.md)
- **Develop conventions** — [docs/develop.md](docs/develop.md)

Open http://localhost:5173 after `pnpm dev:all`.

## Daily Loop

| Task                          | Command                                       |
|-------------------------------|-----------------------------------------------|
| Run all tests (CLI)           | `pnpm test:cli`                               |
| Run a single test file        | `cd packages/ant-cli && pnpm vitest run tests/<path>` |
| Type-check everything         | `pnpm typecheck`                              |
| Build the project             | `pnpm build`                                  |
| Tear down infra               | `pnpm dev:infra:down`                         |

The build runs the full test suite as a prebuild gate — failing tests abort
the build.

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

- [ ] `pnpm build` succeeds locally (this also runs the tests)
- [ ] `pnpm typecheck` is clean
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
- If a review takes more than 5 days to get a response, ping in Discord
  (link in the README).

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

## Getting Help

- **Documentation**: start with `docs/local-mode/install.md` and `docs/concepts/`.
- **Discussions**: for open-ended questions, use GitHub Discussions.
- **Real-time chat**: see the Discord invite in the README.

Thanks again for contributing.
