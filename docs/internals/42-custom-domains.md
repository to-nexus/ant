# 42 — Custom Domains (deploy-only)

Lets a developer using Ant attach a domain they **own** (e.g.
`app.mycompany.com`) to one of their **deploys**, served in-place over
auto-issued HTTPS. Preview is intentionally out of scope — preview is a
volatile dev server, not something you point a permanent domain at.

This document is the SSOT for how the feature works and **who has to do what**.
Infra manifests (Caddyfile, K8s YAML) live in
[`docs/infra/custom-domains.md`](../infra/custom-domains.md).

## Where it fits

It layers on **subdomain routing** (see [22-preview-system.md](22-preview-system.md)):
deploys already serve at `{label}.ant-deploy.cross.nexus` at **host root, no
basePath**. A custom domain is just an **alias into that same serving path** —
so there is no separate build, no basePath rewrite, and both frontend and
backend packages work through the one mechanism.

Our own wildcard `*.ant-deploy.cross.nexus` stays on the existing ALB + ACM.
Only **user-owned** domains — whose TLS certs we cannot pre-provision — need the
new on-demand-TLS entry point (NLB + Caddy).

## How it works (internal)

```
user domain ─(CNAME→cname-target | apex A→NLB EIP)→ NLB(:80/:443)
  └▶ Caddy (on-demand TLS): unknown SNI → GET ant-preview/internal/tls-ask?domain=<h>
       200 only if the domain is verified+live → issue Let's Encrypt cert → cache
       └▶ ant-preview, X-Forwarded-Host: <user domain>
            └▶ deployProxy: extractLabelFromHost == null (not our base domain)
               → DeployService.resolveCustomDomain(host) → deploy coords
               → resolveDeployTarget → verbatim root serve
```

- **Registry** (Redis, SSOT): `customdomain:{hostname}` → `CustomDomain`, plus a
  global list and a per-deploy reverse index. Persisted **without TTL** — a
  domain mapping must not silently expire while the deploy lives. Removed only
  by `deleteCustomDomain` or the feature/project cleanup cascade.
- **Ownership**: a TXT record `_ant-challenge.<hostname>` = issued token. Nothing
  routes and no cert issues until the record verifies (`status: 'active'`).
- **Abuse gate**: `GET /internal/tls-ask` answers `200` only for an `active`
  domain whose deploy is live, so a stranger's domain can never trigger
  Let's Encrypt issuance (rate-limit protection). Internal-only (NetworkPolicy),
  optional shared secret.
- **Routing**: the deploy proxy's subdomain branch falls back to
  `resolveCustomDomain` when the Host is not under the deploy base domain; the
  WS upgrade path does the same. Both serve the app verbatim at root.
- **Realtime**: `customDomainStatus` SSE pushes verify/cert progress to the FE
  deploy panel.

Enablement is a single switch: the **presence** of
`ANT_CUSTOM_DOMAIN_CNAME_TARGET`. Unset (local dev, or infra not yet built) →
the feature is off and registration returns `503`.

## Responsibilities — who does what

### A. Infra team — one-time setup (per environment)

Nothing here is per-user; once done, issuance and routing are automatic.

1. **NLB** (L4) with a **static EIP per AZ**, listeners `:80` + `:443` (TCP),
   targeting the Caddy service. `:80` is required for the HTTP-01 challenge.
2. **Caddy** Deployment + Service with **on-demand TLS** pointed at
   `ant-preview:8080/internal/tls-ask`, reverse-proxying to `ant-preview` with
   `X-Forwarded-Host`. Certificate storage **must be shared across replicas**
   (`caddy-storage-redis` on the existing ElastiCache) or replicas double-issue
   and hit Let's Encrypt limits.
3. **DNS**: create the stable CNAME target (e.g. `ant-domains.cross.nexus`) → NLB.
4. **ant-preview env**: set `ANT_CUSTOM_DOMAIN_CNAME_TARGET` (required to enable),
   optionally `ANT_CUSTOM_DOMAIN_APEX_IPS` (apex support) and
   `ANT_TLS_ASK_SECRET`.
5. **NetworkPolicy**: restrict `/internal/tls-ask` to Caddy.

Manifests + Caddyfile: [`docs/infra/custom-domains.md`](../infra/custom-domains.md).
Managed alternative (Cloudflare for SaaS) is noted there — it replaces steps 1-3.

### B. Developer using Ant — per domain (two DNS records)

You only ever add **two DNS records** at your own registrar (Gabia, Cloudflare,
Route53, …). No servers, certificates, or builds. Steps:

1. Deploy the feature first (a domain needs something to point at).
2. Deploy panel → **Custom Domain** → enter the hostname, pick the package
   (frontend/backend; choose which one for multi-package deploys) → Add.
3. Ant shows exactly two records — copy them into your DNS provider.
4. Click **Verify** (DNS can take minutes to propagate; retry if not found yet).
5. Visit `https://<your-domain>` — the cert auto-issues on first hit and the
   deploy serves at your domain, URL bar unchanged.

**Worked example — subdomain `app.mycompany.com`** (recommended: uses CNAME, so
if our IPs change you don't have to touch anything):

```
TXT     _ant-challenge.app.mycompany.com   =  ant-verify-3f9a…     (ownership)
CNAME   app.mycompany.com                  →  ant-domains.cross.nexus   (connect)
```

**Worked example — apex/root `mycompany.com`** (DNS forbids CNAME at the root, so
use A records to the NLB IPs; requires `ANT_CUSTOM_DOMAIN_APEX_IPS` to be set):

```
TXT   _ant-challenge.mycompany.com   =  ant-verify-3f9a…     (ownership)
A     mycompany.com                  →  3.34.11.22           (connect, NLB EIP)
A     mycompany.com                  →  13.125.33.44
```

If apex support is not provisioned, use a subdomain (`app.` / `www.`) instead —
a common pattern is to serve the app on `www` and redirect the root to it.

## Limits

- **Let's Encrypt**: 50 certs/registered-domain/7d, 300 orders/acct/3h. The
  `tls-ask` gate prevents unverified domains from consuming quota. Validate
  against LE staging before production ACME.
- **User wildcard domains** (`*.mycompany.com`) need DNS-01 (the user's DNS API)
  → not supported; use a concrete hostname per app (on-demand issues unlimited
  concrete hostnames — functionally equivalent).
- **One hostname → one package.** A fullstack app uses two hostnames (e.g.
  `app.` for the frontend, `api.` for the backend).

## Key files

| Concern | Path |
|---|---|
| Shared types | `packages/ant-shared/src/deploy.ts`, `sse-events.ts` |
| Registry (Redis) | `packages/ant-cli/src/infrastructure/state/RedisStateStore.ts` |
| Verification (TXT) | `packages/ant-cli/src/infrastructure/deploy/customDomain/verification.ts` |
| Management service | `.../deploy/customDomain/CustomDomainService.ts` |
| Enable gate (env SSOT) | `.../deploy/customDomain/config.ts` |
| Host routing | `DeployService.resolveCustomDomain` + `middleware/deployProxy.ts` |
| Routes + ask + WS | `infrastructure/preview/PreviewServer.ts` |
| FE panel | `packages/ant-ui/.../PreviewConfigEditor/sections/CustomDomainSection.tsx` |
| Tests | `packages/ant-cli/tests/preview/customDomain.test.ts` |

## Deferred

FE→BE custom-URL injection at build time (so a frontend calls its backend via
the backend's *custom* domain instead of its subdomain URL) is not implemented:
builds happen at deploy time, before a domain is attached, so it needs a
rebuild-on-attach trigger. It is not required for the feature to work — the
frontend already reaches its backend via the baked subdomain URL.
