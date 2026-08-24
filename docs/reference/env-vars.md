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
| `ANT_SERVER_MODE` | `local` | `local` or `cloud`. Decides auth tenant, IDE orchestrator, and Figma transport. `cloud` runs entirely from this repository (identity, orgs, approval, admin) — the private `@ant/cloud` overlay is only needed for billing. See [cloud-mode/self-host.md](../cloud-mode/self-host.md). |
| `ANT_REDIS_URL` | `redis://localhost:16379` (local mode only) | Redis connection URL. Local mode defaults to the `pnpm dev:infra:redis` port; **cloud mode has no default and fails fast when unset**. SSOT: `core/config/redisUrl.ts`. |
| `ANT_REDIS_TLS_SERVERNAME` | unset | `rediss://` only. Hostname to verify the server certificate against (SNI + identity check) when `ANT_REDIS_URL`'s host is a CNAME in front of the real endpoint — e.g. a private CNAME over an ElastiCache node whose cert covers `*.<cluster>.cache.amazonaws.com`. Keeps verification fully on, so prefer it over the skip flag below. SSOT: `infrastructure/utils/redis.ts`. |
| `ANT_REDIS_TLS_SKIP_HOSTNAME_CHECK` | unset (`false`) | `rediss://` only. Accepts a certificate whose SAN does not match the URL host. The channel stays encrypted but a DNS-redirecting MITM is no longer detected — use the native endpoint or `ANT_REDIS_TLS_SERVERNAME` instead; ignored when that is set. |
| `ANT_ENCRYPTION_KEY` | auto-generated | Optional. When unset, a key is generated and persisted to `<workspaceRoot>/.ant/encryption.key` (mode 0600). To set it manually it must be exactly 64 hex chars: `openssl rand -hex 32`. Encrypts the per-user credential store, including the [MCP credentials](../concepts/custom-agents.md#credentials-for-mcp-servers) custom agents reference. |
| `ANT_WORKSPACE_BASE_PATH` | sibling `../ant-workspaces`, else `<cwd>/workspaces` | Where Ant stores per-feature data. EFS mount root in cloud. |
| `ANT_CUSTOM_AGENTS_DIR` | — | Org-scope [custom-agent](../concepts/custom-agents.md) definitions root (self-host). Read-only for members; the user scope shadows it. |
| `ANT_BUILD_SHA` | unset | Git SHA of the running build, baked in at image build time. Reported as `buildSha` by `GET /api/system/config` so a FE/BE version skew is observable. |

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
| `ANT_DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | Override the DeepSeek endpoint (OpenAI-compatible). |
| `ANT_GLM_BASE_URL` | `https://api.z.ai/api/paas/v4` | Override the GLM / Z.ai endpoint (OpenAI-compatible). |
| `ANT_KIMI_BASE_URL` | `https://api.moonshot.ai/v1` | Override the Kimi / Moonshot endpoint (OpenAI-compatible). |

Per-provider reasoning toggles (operator hard opt-outs): `DEEPSEEK_THINKING=disabled`, `GLM_THINKING=disabled`, `OPENAI_REASONING_EFFORT=low\|medium\|high\|xhigh`.

### Local / self-hosted models

The three `*_BASE_URL` overrides exist so a self-hoster can route an
**already-registered** model id through an OpenAI-compatible gateway
(LiteLLM, vLLM, OpenRouter). They do **not** add arbitrary-model support:
`MODEL_REGISTRY` in `@ant/shared` is a frozen literal, and an unknown model
id is silently replaced by the tier default at project save.

Ant's prompts are sized for large-context hosted models — the code-job
execute system prompt alone is ≈39k tokens and the decompose rules file is
≈42k tokens, with hardcoded budget areas summing past 150k. **The effective
floor is ≈200K context plus reliable native tool calling.** A 32K local
model fails on the system prompt before the first tool call, so there is no
supported local-model path today.

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
| `RECURSION_LIMIT` | `300` | LangGraph recursion ceiling override (per task in parallel mode). Calibrated for tool-call file authoring — each write round costs 2 graph steps. Job-scoped `{JOB}_RECURSION_LIMIT` (e.g. `CODE_RECURSION_LIMIT`, `ASK_RECURSION_LIMIT`) takes precedence. |

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
| `ANT_PREVIEW_BASE_DOMAIN` | unset | Base domain for preview URL routing in cloud. |
| `ANT_PREVIEW_CONTENT_PORT` | `PORT + 1` | ant-preview serves user CONTENT (preview + deploy proxies) on this port and its cookie-authenticated `/projects/*` control plane on `PORT`. They must not share an origin: a document served from a public deploy would otherwise drive the control plane same-origin with the viewer's session. Equal ports = boot failure. Publish the two listeners under **different hostnames**. |
| `ANT_CHILD_UID` | unset | Numeric uid for user-authored child processes (dev servers, install scripts, build commands). Unset = children keep the service identity, correct for the single-developer local CLI. Requires the container to be permitted to change uids; the runtime probes once and logs loudly if not. |
| `ANT_CHILD_GID` | unset | Numeric gid companion to `ANT_CHILD_UID`. |
| `ANT_CHILD_UMASK` | `002` in the images | Octal umask applied at service bootstrap so the service and the child identity can each clean up the other's files in the shared workspace. Unset = no change. |
| `ANT_REQUIRE_BILLING` | unset | Managed deployment only: `1` makes a missing/unloadable `@ant/cloud` billing overlay a **boot failure** instead of a silent free tier. Self-hosted cloud and local leave this unset (billing off, unmetered). SSOT: `core/config/billingCapability.ts`. |

Figma MCP transport is selected by `ANT_SERVER_MODE` (desktop MCP locally,
HTTP bridge in cloud) — there is no separate Figma env var.

## Auth

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANT_JWT_PUBLIC_KEY` | unset | ES256 session VERIFICATION key (PEM SPKI, P-256). Safe in every process — it cannot mint a session. Required by `ant-api`, `ant-realtime`, `ant-preview`. |
| `ANT_JWT_PRIVATE_KEY` | unset | ES256 session SIGNING key (PEM PKCS8, P-256). **`ant-api` only** — it is the only process that mints sessions. Any other process that holds one refuses to boot (`ant-realtime`, `ant-preview`, `ant-job` — the last must hold no JWT material at all). Sessions are ES256 only; there is no symmetric fallback. |
| `GOOGLE_CLIENT_ID` | — | Cloud mode: Google OAuth client id (Google Cloud Console). Auth routes answer 503 until the client id/secret and redirect URI all resolve. |
| `GOOGLE_CLIENT_SECRET` | — | Cloud mode: Google OAuth client secret. |
| `GOOGLE_REDIRECT_URI` | derived | OAuth callback URL. When unset, derived as `${FRONTEND_URL}/api/auth/google/callback` — register that URI in the Google Cloud Console either way. Set explicitly only when the callback host differs from `FRONTEND_URL`. |
| `ANT_SUPER_ADMIN_EMAILS` | — | Comma-separated super-admin emails. The env allowlist is the **authoritative** admin gate (`/admin/*` routes, admin dashboard); the DB flag is a projection of it. |
| `FRONTEND_URL` | — | Cloud mode: the public origin users visit. Drives the CORS allowlist and the `GOOGLE_REDIRECT_URI` derivation. |
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
the defaults are 4100 (API), 4101 (realtime), 4102 (preview control plane).

ant-preview is the exception: it runs a **second** listener for user content on
`ANT_PREVIEW_CONTENT_PORT` (default `PORT + 1`, i.e. 4103). That split is a
security boundary, not a scaling knob — see the Cloud-only table above.

## Frontend build-time (`VITE_*`)

Baked into the ant-ui bundle at build time, so they are deployment identity, never
secrets.

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_CLOUD_BACKEND_BASE` | empty | Where the API and realtime live. Empty = same-origin. |
| `VITE_PREVIEW_HOST` | empty | ant-preview MANAGEMENT API origin (`/projects/*`). Empty = same-origin. |
| `VITE_PREVIEW_CONTENT_HOST` | empty | Origin the user's own preview/deploy app is served from. Empty = fall back to `VITE_PREVIEW_HOST` (single-host, pre-split behaviour). Point this at the content listener's hostname — it must differ from the management origin. |

## Read next

- [`packages/ant-cli/.env.example.local`](../../packages/ant-cli/.env.example.local) — the
  canonical source.
- [internals/02-infrastructure.md](../internals/02-infrastructure.md) — Redis
  keys, queues, channels.
