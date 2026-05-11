# Cloud Mode — Install

Two cloud paths, one page:

1. **[Managed (Persona B)](#managed-personab)** — sign up for
   `ant.crosstoken.io` and never touch infra. Skip to that section if you
   want the fastest start.
2. **[Self-host cloud (Persona C)](#self-host-cloud-personac)** — run
   the same cloud build on your own infrastructure (single VM, single
   Kubernetes namespace, or a multi-tenant cluster).

If you only need Ant on one laptop with no remote auth, you want
[local-mode/install.md](../local-mode/install.md) instead.

The runtime is identical across local, managed, and self-hosted cloud —
only the operator concerns differ. Local mode and cloud mode share the
same Redis + BullMQ data plane.

---

## Managed (Persona B)

### Sign up

1. Visit [ant.crosstoken.io](https://ant.crosstoken.io).
2. Sign up with Google OAuth.
3. After OAuth completes, the **Organization onboarding screen**
   (introduced in Phase 3) appears:
   - **Business email** (e.g. `you@acme.io`): the input is prefilled
     with the second-level domain (`acme`). Accept to join (or create)
     `acme`, or type a different name to create a separate
     organization.
   - **Consumer email** (gmail, naver, hotmail, …): the input is
     blank. Type an organization name to create one, or Skip to land in
     `personal-<your-user-id>`.
   - **Autocomplete**: as you type, Ant searches existing
     organizations. Pick one to join (handshake model — free joining,
     no approval gate today).
4. After onboarding you land in the main UI. The chosen
   `organizationId` is stored in the JWT cookie.

That's the entire setup — billing, retention, support, and infrastructure
are managed.

### What the managed plan includes

- Anthropic Claude as the primary LLM, drawn from the managed quota.
- Per-user Cloud IDE pods (Kubernetes-backed VSCode in the browser).
- Workspace storage on managed EFS.
- Figma MCP via the cloud HTTP bridge (no desktop MCP needed).

### Limits

Quotas, allowed concurrency, and retention policy are published at
[ant.crosstoken.io/pricing](https://ant.crosstoken.io). They are
intentionally not duplicated here so this doc doesn't drift.

### When to switch to self-host

- You need to bring your own LLM provider key (Anthropic enterprise,
  Azure OpenAI, on-prem inference).
- Compliance forbids managed multi-tenant storage.
- You want to fork prompts or graph nodes.

→ Continue to [self-host cloud](#self-host-cloud-personac).

---

## Self-host cloud (Persona C)

Run the cloud build on your own infrastructure. There are two shapes,
both supported by the same `ANT_SERVER_MODE=cloud` code path:

| Shape | Where | When |
|---|---|---|
| **Single-host cloud** | One VM, Docker for Redis | Team-of-N, no Kubernetes burden, OAuth required |
| **Multi-tenant cluster** | Kubernetes (EKS / GKE / AKS / on-prem) | Multiple teams, isolation, per-user Cloud IDE pods |

The differences are operational, not architectural. Both modes go through
the same OAuth, the same Redis-backed state, the same JWT cookie, the
same IDE orchestration interface. The IDE orchestrator picks Kubernetes
when `ANT_K8S_NAMESPACE` is set, Docker otherwise.

### Prerequisites

- Node 18.17+, pnpm 10+, Docker (for the single-host shape, or to build
  images for Kubernetes).
- A registered **Google OAuth Client** (other providers are pluggable
  but Google is the in-tree default).
- A managed Redis (ElastiCache, Memorystore, Upstash) for cloud
  deployments; Docker Compose works for single-host.
- TLS termination — operationally required for OAuth cookies to be
  delivered correctly (`Secure` attribute is set when `NODE_ENV=production`).

### Required env

These four variables are mandatory for any cloud deployment:

| Variable | Notes |
|---|---|
| `ANT_SERVER_MODE=cloud` | Disables `local:local` auth bypass; enables OAuth + JWT. |
| `ANT_REDIS_URL` | `redis://…` or `rediss://…` for TLS. |
| `ANT_ENCRYPTION_KEY` | 64-char hex. Generate with `openssl rand -hex 32`. |
| `ANT_JWT_SECRET` | 32+ chars. JWT cookie signing key. |

OAuth credentials (Google in-tree):

| Variable | Notes |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials). |
| `GOOGLE_REDIRECT_URI` | Only required for split-host deployments. Single-host mode derives it from `FRONTEND_URL`. |

Frontend origin and CORS:

| Variable | Notes |
|---|---|
| `FRONTEND_URL` | Primary FE origin. Doubles as the OAuth redirect base in single-host mode. |
| `ANT_CORS_ORIGINS` | Additional FE origins as CSV. Use for split-host or dev cross-origin. |

CORS, OAuth, and FRONTEND_URL are intentionally one predicate — splitting
them risks open-redirect. See the
[CORS operating matrix](#cors-operating-matrix) below for the five
canonical scenarios.

IDE orchestration:

| Variable | Notes |
|---|---|
| `ANT_K8S_NAMESPACE` | Set to enable the Kubernetes IDE orchestrator. If unset, Docker is used (single-host shape). |
| `ANT_EFS_PVC_NAME` | Name of the PersistentVolumeClaim that mounts your workspace storage. |
| `ANT_IDE_IMAGE` | The container image users get when they open the Cloud IDE. Default `gitpod/openvscode-server:latest`. |
| `ANT_IDE_HOSTNAME_MODE` | `user` (one hostname per user) or `feature` (one hostname per feature). |

Frontend build-time:

| Variable | Notes |
|---|---|
| `VITE_CLOUD_BACKEND_BASE` | Cloud build's API origin. Same-origin → in-app toggle; external origin → navigate. |
| `VITE_PREVIEW_HOST` | The preview server origin (for split-host deployments). |
| `VITE_ANT_SITE_URL` | Marketing site URL used by the logout redirect. |

The full env reference: [../reference/env-vars.md](../reference/env-vars.md).

### Single-host cloud

One VM, all four backend processes, Docker for Redis. Suitable for a
small team that needs OAuth but not Kubernetes.

```bash
git clone https://github.com/<org>/ant
cd ant
pnpm install

cp packages/ant-cli/.env.example.local packages/ant-cli/.env
# Edit packages/ant-cli/.env:
#   ANT_SERVER_MODE=cloud
#   ANT_REDIS_URL=redis://localhost:16379
#   ANT_ENCRYPTION_KEY=<64-char hex>
#   ANT_JWT_SECRET=<32+ char secret>
#   GOOGLE_CLIENT_ID=...
#   GOOGLE_CLIENT_SECRET=...
#   FRONTEND_URL=https://ant.mycompany.com
#   ANT_API_URL=http://localhost:4100

pnpm dev:infra:redis        # boot Redis in Docker
pnpm build && pnpm start:cloud:all
```

Front Ant with a TLS-terminating reverse proxy (nginx / Caddy / Traefik):

| Path | Upstream | Notes |
|---|---|---|
| `/api/*` | `:4100` | REST. |
| `/realtime/*` | `:4101` | SSE. Disable proxy buffering; `proxy_read_timeout 1d`. |
| `/preview/*` | `:4102` | Per-feature dev servers. Disable buffering. |
| `/` | `:5173` or static `packages/ant-ui/dist` | The SPA. |

OAuth in Google Cloud Console needs:

- **Authorized JavaScript origins** — your `FRONTEND_URL`.
- **Authorized redirect URIs** —
  `<FRONTEND_URL>/api/auth/google/callback`.

### Multi-tenant Kubernetes

For multi-team production. Each backend process is its own Deployment;
Cloud IDE pods are launched on demand by the
`KubernetesIDEOrchestrator`.

**What you'll deploy** (Deployments + replicas typical):

| Deployment | Replicas | Purpose |
|---|---|---|
| `ant-api` | 2+ | REST + IDE proxy, behind a Service |
| `ant-realtime` | 2+ | SSE for chat / workflow streams |
| `ant-job` | 2+ (or KEDA-scaled) | BullMQ workers spawning `job-runner` |
| `ant-preview` | 2+ | Per-feature dev-server lifecycle |
| `ant-ui` | 2+ | The SPA (or serve via CDN — S3 + CloudFront) |

Plus:

- **Redis** — ElastiCache / Memorystore / Upstash; Redis 6+. TLS
  supported (`rediss://…`). Restrict the auth user to `ant:*` key
  prefixes via Redis ACL.
- **Shared workspace volume** — EFS (AWS) / Filestore (GCP) / NFS.
  Mount the same volume into `ant-job`, `ant-preview`, and every IDE
  pod.
- **(Optional) Vector DB** — ChromaDB. Off by default; see the
  invariant in [AGENTS.md](../../AGENTS.md) for the gate sites.

#### Required cluster pieces

- **EKS / GKE / AKS** with the appropriate CSI driver for shared
  storage (EFS CSI on AWS, Filestore CSI on GCP).
- **Ingress controller** — ALB / nginx / Traefik. Must disable
  buffering on `/realtime/*` and `/preview/*`.
- **External Secrets** for `ANT_JWT_SECRET`, `ANT_ENCRYPTION_KEY`,
  `GOOGLE_CLIENT_SECRET`, LLM keys. Don't put them in ConfigMaps.

#### Operational rules

- **All services use Round-robin LB.** Redis-backed state means no
  sticky sessions needed; SSE works because every pod can pub/sub.
- **`ant-job` needs termination protection.** Long-running jobs
  (5-30 minutes) require careful `preStop` + `terminationGracePeriodSeconds`
  configuration. See the per-pod details in
  [legacy infra runbook §2.3](../infra/cloud-deployment-guide.md#23-ant-job-%E2%9A%A0-long-running-jobs)
  until that content folds into this page.
- **IDE pods are per-user, per-project.** The orchestrator mounts the
  same EFS into the IDE pod's `/workspace`. EFS open file handles +
  `fs.rm` race during delete is the root cause of the `Project already
  exists` 409 — the cleanup cascade in
  [AGENTS.md § "Project / Feature Lifecycle SSOT"](../../AGENTS.md) is
  the SSOT.

#### CloudFront / multi-origin frontends

If you serve the UI from a separate origin (CDN-hosted bundle, BE on a
different host), see [../infra/cloudfront-multi-origin-guide.md](../infra/cloudfront-multi-origin-guide.md)
for the CORS / cookie / CSP configuration. The cookie `Domain` attribute
is derived by `JwtService.deriveCookieDomain` — set `COOKIE_DOMAIN` to
force a value, or add your registrable domain to `KNOWN_BASE_DOMAINS` in
the source.

#### Long-form runbook

The detailed step-by-step EKS deployment guide — IAM, Helm values, EFS
CSI driver versions, TLS for ElastiCache with custom CNAME, KEDA
ScaledObject for `ant-job`, per-tenant resource limits — lives at
[../infra/cloud-deployment-guide.md](../infra/cloud-deployment-guide.md).
That file is targeted at DevOps teams executing the deployment; this
page is the operator-friendly overview.

### CORS operating matrix

Five canonical scenarios; only two of them need explicit env. See
[corsConfig.ts](../../packages/ant-cli/src/periphery/adapters/http/middleware/corsConfig.ts)
for the five-step priority — no Origin → `*` → self-origin → `FRONTEND_URL`
→ `ANT_CORS_ORIGINS`.

| Scenario | `FRONTEND_URL` | `ANT_CORS_ORIGINS` | Notes |
|---|---|---|---|
| Local↔Local (Persona A) | unset | unset | Loopback auto-allow. No env. |
| Managed same-origin (Persona B) | `https://ant.crosstoken.io` | (operations) | Self-origin auto-allow. |
| Cloud↔Cloud same-origin (Persona C single-host) | `https://ant.mycompany.com` | unset | Self-origin auto-allow. No env beyond `FRONTEND_URL`. |
| Cloud↔Cloud split-host | `https://app.mycompany.com` | (optional) | `FRONTEND_URL` allowlist. |
| ⚠️ Local FE → Custom Cloud BE (dev) | (cloud FE value) | `'http://localhost:5173'` | See [cloud-mode/develop.md](develop.md). |

In cloud mode with **both** `FRONTEND_URL` and `ANT_CORS_ORIGINS` unset,
the BE emits a `[CORS]` startup warning so split-host deployments don't
silently fail. This was added in Phase 2.

### Auth

Cloud mode requires OAuth. There is no `local:local` shortcut. The flow
(introduced in Phase 3):

1. Google OAuth returns to `<FRONTEND_URL>/api/auth/google/callback`.
2. BE looks up the user. **Existing user** → issue a full JWT with the
   resolved `organizationId` → main UI.
3. **New user** → issue a `_pending` JWT (the sentinel) and redirect
   the FE with `?onboarding=true`.
4. The FE renders `OrganizationOnboardingScreen` (input prefilled from
   `suggestedOrganizationName` in `/auth/me`; consumer emails get a
   blank input).
5. POST `/api/auth/onboarding/organization` resolves the
   `organizationId` (slugify + reserved-name check + free join), then
   the BE reissues a full JWT.

The `_pending` JWT is guarded — any protected route other than
`/api/auth/me`, `/api/auth/onboarding/organization`, and
`/api/organizations` rejects it with `401 ONBOARDING_REQUIRED`. See
[AGENTS.md](../../AGENTS.md) for the SSOT details.

### Backups

Two things to back up:

- **Workspace storage** — generated artifacts, sessions, codebase.
  EFS / Filestore / NFS snapshot is the operator's call.
- **Redis** — in-flight job state. RDB or AOF.

Both can be reconstructed if lost (jobs replay from the last
checkpoint; codebase can be re-cloned from each project's git remote),
but the recovery is faster with snapshots.

### Hardening checklist

- [ ] TLS-terminating reverse proxy in front of every public endpoint.
- [ ] `ANT_ENCRYPTION_KEY` and `ANT_JWT_SECRET` from a secrets manager
      (AWS Secrets Manager, Vault, K8s External Secrets).
- [ ] LLM provider keys rotated quarterly.
- [ ] Ingress restricted: only the UI origin and your own integrations
      reach `/api/`.
- [ ] Cloud IDE feature disabled if you don't use it
      (`/api/cloud-ide/*` and the orchestrator can be gated by route
      registration).
- [ ] Redis ACL limits the Ant user to `ant:*` key prefixes.
- [ ] `ANT_TASK_CONCURRENCY` capped to your LLM rate-limit budget.
- [ ] Subscribe to the repo's security advisories
      ([../../SECURITY.md](../../SECURITY.md)).

### Operational checklists

**Pre-launch**

- [ ] Reverse proxy disables buffering on `/realtime/*` and
      `/preview/*`.
- [ ] EFS / shared volume mount targets in every AZ that runs workers.
- [ ] `[CORS]` startup log shows the expected allowlist (Phase 2 warn).
- [ ] OAuth redirect URI registered with the provider matches the BE's
      `GOOGLE_REDIRECT_URI` / derived URI.

**Day-2**

- [ ] Alert on BullMQ queue depth > N (workers can't keep up).
- [ ] Alert on Redis memory pressure.
- [ ] Alert on `ant-api` 5xx rate.
- [ ] Periodic chaos check: kill a random worker and verify jobs
      resume from their checkpoints.
- [ ] Periodic restore test from Redis + shared-volume backups.

### Troubleshooting

- **"Project already exists" 409 after delete** — the cleanup cascade
  (cancelJobs → cleanupIDE → previewCleanup → redisCleanup → fs.rm)
  must run to completion. See
  [getting-started/troubleshooting.md § "Project already exists"](../getting-started/troubleshooting.md#project-already-exists-on-createproject).
- **TLS verification errors on Redis** — handled in `RedisStateStore`
  for ElastiCache + custom CNAME. See
  [../internals/02-infrastructure.md](../internals/02-infrastructure.md).
- **IDE pod hangs in `Terminating`** — orchestrator polls
  `deletionTimestamp`; usually resolves in 60s. If not, restart
  `ant-api`.
- **OAuth callback 404 / wrong host** — `GOOGLE_REDIRECT_URI` (or its
  derivation from `FRONTEND_URL`) must match what's registered in the
  OAuth provider.
- **CORS silently fails in split-host** — Phase 2's startup warn fires
  here. Set `FRONTEND_URL` or `ANT_CORS_ORIGINS`.

---

## Next steps

- [Cloud Mode — Develop](develop.md) — running the cloud build on
  localhost for development.
- [../internals/23-cloud-ide.md](../internals/23-cloud-ide.md) — Cloud
  IDE internals (orchestrator, EFS mount topology, lifecycle).
- [../internals/02-infrastructure.md](../internals/02-infrastructure.md) —
  Redis key layout, queues, channels.
- [../observability/](../observability/) — logging and metrics
  strategy.
