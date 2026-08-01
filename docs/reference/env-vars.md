# Environment variables

All runtime-tunable configuration. The canonical source is
`packages/ant-cli/.env.example.local`; this page documents the meaning and
defaults.

For deployment-specific recommendations, see
[local-mode/install.md](../local-mode/install.md) and
[cloud-mode/install.md](../cloud-mode/install.md).

## Core

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANT_SERVER_MODE` | `local` | `local` or `cloud`. Decides auth tenant, IDE orchestrator, and Figma transport. |
| `ANT_REDIS_URL` | `redis://localhost:16379` | Redis connection URL. Required in cloud mode. |
| `ANT_ENCRYPTION_KEY` | — | 32+ byte random string. Required. Generate with `openssl rand -base64 32`. |
| `ANT_WORKSPACE_BASE_PATH` | `./workspaces` | Where Ant stores per-feature data. EFS mount root in cloud. |

## LLM providers

| Variable | Default | Purpose |
|----------|---------|---------|
Key names are unprefixed — the SSOT is `PROVIDER_API_KEY_ENV` in [`@ant/shared/models.ts`](../../packages/ant-shared/src/models.ts); the `/models` endpoint reports a provider as configured iff its variable is non-empty.

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | — | Primary supported provider. Highly recommended. |
| `OPENAI_API_KEY` | — | GPT-5.6 family (Responses API). |
| `GEMINI_API_KEY` | — | Gemini text + image models (visual / creator jobs). |
| `DEEPSEEK_API_KEY` | — | DeepSeek (OpenAI-compatible endpoint). |
| `GLM_API_KEY` | — | GLM / Z.ai (OpenAI-compatible endpoint). |
| `KIMI_API_KEY` | — | Kimi / Moonshot (OpenAI-compatible endpoint). |
| `ANT_LLM_MOCK` | `false` | Use the mock LLM adapter (for tests / CI). |

Per-provider reasoning toggles (operator hard opt-outs): `DEEPSEEK_THINKING=disabled`, `GLM_THINKING=disabled`, `OPENAI_REASONING_EFFORT=low\|medium\|high\|xhigh`.

## Concurrency and limits

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANT_TASK_CONCURRENCY` | `3` | Parallel tasks per worker process. |
| `ANT_WORKER_CONCURRENCY` | `1` | Concurrent jobs per worker process. |
| `RECURSION_LIMIT` | — | LangGraph recursion ceiling override. |

## Vector DB / RAG

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANT_VECTOR_DB_ENABLED` | `false` | Enable RAG via ChromaDB. Also start `pnpm dev:infra:vector`. |

When unset/false, the architect's `learn` job + `ant index` CLI + git
auto-index all short-circuit; `/agents` drops the `learn` entry; RAG
falls back to `git-changes → keyword` chain. The capability gate lives
in `core/config/vectorDbCapability.ts` — never read
`process.env.ANT_VECTOR_DB_ENABLED` elsewhere.

See [AGENTS.md](../../AGENTS.md) for the binding rule and the active
gate sites.

## Cloud-only

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANT_K8S_NAMESPACE` | unset | Namespace for IDE pods. If unset, falls back to Docker. |
| `ANT_PREVIEW_WORKERS` | unset | Comma-separated preview-worker URLs. Required in cloud. |
| `ANT_PREVIEW_BASE_DOMAIN` | unset | Base domain for preview URL routing in cloud. |

Figma MCP transport is selected by `ANT_SERVER_MODE` (desktop MCP locally,
HTTP bridge in cloud) — there is no separate Figma env var.

## Auth

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANT_JWT_SECRET` | — | JWT signing secret. Required in cloud. |

Auth tenancy is driven by `ANT_SERVER_MODE`: `local` uses the single
`local:local` tenant, `cloud` uses OAuth. The current implementation is
intentionally minimal — SAML / SCIM / fine-grained ACL is on the roadmap.

## Logging

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANT_LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error`. |

## Ports

Each backend process reads `PORT` (e.g. `PORT=4110 pnpm dev:api-server`);
the defaults are 4100 (API), 4101 (realtime), 4102 (preview). There are no
per-process `ANT_*_PORT` variables.

## Read next

- [`packages/ant-cli/.env.example.local`](../../packages/ant-cli/.env.example.local) — the
  canonical source.
- [internals/02-infrastructure.md](../internals/02-infrastructure.md) — Redis
  keys, queues, channels.
