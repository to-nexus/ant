# Environment variables

All runtime-tunable configuration. The canonical source is
`packages/ant-cli/.env.example.local`; this page documents the meaning and
defaults.

For deployment-specific recommendations, see
[guides/self-hosting.md](../guides/self-hosting.md) and
[guides/cloud-deployment.md](../guides/cloud-deployment.md).

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
| `ANT_ANTHROPIC_API_KEY` | — | Primary supported model. Highly recommended. |
| `ANT_OPENAI_API_KEY` | — | Optional fallback for some jobs. |
| `ANT_LLM_MOCK` | `false` | Use the mock LLM adapter (for tests / CI). |

## Concurrency and limits

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANT_TASK_CONCURRENCY` | `3` | Parallel tasks per worker process. |
| `ANT_LLM_MAX_RETRIES` | `3` | LLM call retry budget on transient errors. |

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
| `ANT_FIGMA_BRIDGE_URL` | unset | HTTP bridge to Figma MCP for cloud mode. |
| `ANT_FIGMA_TOKEN` | unset | Figma Personal Access Token for the bridge. |

## Auth

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANT_AUTH_PROVIDER` | `local` | `local` (single-tenant) or your OAuth provider id. |
| `ANT_AUTH_CLIENT_ID` / `ANT_AUTH_CLIENT_SECRET` | — | OAuth credentials when `ANT_AUTH_PROVIDER` is set. |
| `ANT_JWT_SECRET` | — | JWT signing secret. Required in cloud. |

The current auth implementation is intentionally minimal. SAML / SCIM /
fine-grained ACL is on the roadmap.

## Logging

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANT_LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error`. |
| `ANT_LOG_FORMAT` | `pretty` | `pretty` (dev) or `json` (production). |

## Per-process port overrides

| Variable | Default |
|----------|---------|
| `ANT_API_PORT` | `4100` |
| `ANT_REALTIME_PORT` | `4101` |
| `ANT_PREVIEW_PORT` | `4102` |

Local mode auto-detects the next free port if these conflict; cloud mode
expects the listed port.

## Read next

- [`packages/ant-cli/.env.example.local`](../../packages/ant-cli/.env.example.local) — the
  canonical source.
- [internals/02-infrastructure.md](../internals/02-infrastructure.md) — Redis
  keys, queues, channels.
