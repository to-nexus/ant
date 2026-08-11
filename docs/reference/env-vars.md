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
| `ANT_ENCRYPTION_KEY` | — | 32+ byte random string. Required. Generate with `openssl rand -base64 32`. Encrypts the per-user credential store, including the [MCP credentials](../concepts/custom-agents.md#credentials-for-mcp-servers) custom agents reference. |
| `ANT_WORKSPACE_BASE_PATH` | `./workspaces` | Where Ant stores per-feature data. EFS mount root in cloud. |
| `ANT_CUSTOM_AGENTS_DIR` | — | Org-scope [custom-agent](../concepts/custom-agents.md) definitions root (self-host). Read-only for members; the user scope shadows it. |

## LLM providers

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
| `ANT_LLM_MOCK_RESPONSE_DIR` | — | Directory the mock adapter replays canned responses from. |

Per-provider reasoning toggles (operator hard opt-outs): `DEEPSEEK_THINKING=disabled`, `GLM_THINKING=disabled`, `OPENAI_REASONING_EFFORT=low\|medium\|high\|xhigh`.

## System default models

Two decisions, deliberately split:

- **tier → concrete model id** (`anthropic:opus` → `claude-opus-5`) is **code-owned** via `ModelSpec.tier` in [`@ant/shared/models.ts`](../../packages/ant-shared/src/models.ts). It changes when a provider ships a model, so it is a code update — there is no env var for it.
- **job/node default → tier** is env-configurable per slot. SSOT: [`core/config/defaultModels.ts`](../../packages/ant-cli/src/core/config/defaultModels.ts) — never read these variables anywhere else.

Variable: `ANT_DEFAULT_MODEL_<JOB>[_<NODE>]`, value `"<provider>:<tier>"` (an abstract model, never a concrete id). Names are derived from the binding table, so a new slot gets its variable automatically.

| Provider | Tiers |
|----------|-------|
| `anthropic` | `sonnet` · `opus` · `haiku` |
| `openai` | `sol` · `terra` · `luna` |
| `google` | `pro` · `flash` · `proImage` · `flashImage` |
| `deepseek` | `pro` · `flash` |
| `glm` | `flagship` · `fast` |
| `kimi` | `flagship` · `code` · `codeHighspeed` |

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANT_DEFAULT_MODEL_DESIGN`, `..._DESIGN_{DECOMPOSE,PLAN,EXECUTE}` | `anthropic:sonnet`, `plan`→`anthropic:opus` | Design job. |
| `ANT_DEFAULT_MODEL_CODE`, `..._CODE_{DECOMPOSE,PLAN,EXECUTE}` | `anthropic:sonnet`, `decompose`→`anthropic:opus` | Code job. |
| `ANT_DEFAULT_MODEL_PLAN`, `..._PLAN_{PLAN,EXECUTE}` | `anthropic:sonnet`, `plan`→`anthropic:opus` | Plan job (planner). |
| `ANT_DEFAULT_MODEL_LEARN` | `anthropic:sonnet` | Learn job (codebase indexing). |
| `ANT_DEFAULT_MODEL_VISUAL`, `..._VISUAL_{DIRECT,EXPLAIN,ENGRAVE,SKETCH,RENDER}` | `google:flash`; `pro` for text nodes, `flashImage`/`proImage` for sketch/render | Visual job. `SKETCH`/`RENDER` must bind to an image-generation tier. |
| `ANT_DEFAULT_MODEL_REVIEWER`, `ANT_DEFAULT_MODEL_DOC` | `anthropic:opus` | Reviewer / doc agents. |
| `ANT_DEFAULT_MODEL_COMMIT` | `anthropic:sonnet` | Auxiliary one-shot: the ant-authored commit message. |
| `ANT_DEFAULT_MODEL_UNIVERSAL` | `anthropic:sonnet` | Universal job (custom agent/job runtime) agent round. |
| `ANT_DEFAULT_MODEL_FALLBACK` | `anthropic:opus` | Used only when a call maps to no slot at all. |

A per-project override in the UI still wins over these. An unknown provider, unknown tier, malformed value, or a text tier on an image slot is logged and ignored in favour of the built-in binding — a typo cannot brick a deployment.

| Variable | Default | Purpose |
|----------|---------|---------|
| `AI_MODEL_TEMPERATURE`, `{JOB}_MODEL_TEMPERATURE` | `0.7` | Fallback only — per-call sampling policy is the SSOT ([`llmSampling.ts`](../../packages/ant-cli/src/core/ports/llmSampling.ts)). |
| `{JOB}_MODEL_MAX_TOKENS` | `16000` | Fallback output ceiling per agent job, e.g. `CODE_MODEL_MAX_TOKENS`. |

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
| `ANT_LOCAL_ORG` | — | Local mode only: pin the tenant's org. Requires `ANT_LOCAL_USER`. |
| `ANT_LOCAL_USER` | — | Local mode only: pin the tenant's user. Requires `ANT_LOCAL_ORG`. |

Auth tenancy is driven by `ANT_SERVER_MODE`: `local` uses the single
`local:local` tenant, `cloud` uses OAuth. The current implementation is
intentionally minimal — SAML / SCIM / fine-grained ACL is on the roadmap.

In local mode the tenant resolves as: `ANT_LOCAL_ORG` + `ANT_LOCAL_USER` (both
required) → a filesystem probe of `ANT_WORKSPACE_BASE_PATH` that only commits
when it finds exactly one org holding exactly one user → the `local:local`
fallback. Set the pair when the workspaces root holds more than one tenant:
without it the probe is ambiguous, everything lands in `local/local/`, and
projects under any other org/user directory are invisible to that server.

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
