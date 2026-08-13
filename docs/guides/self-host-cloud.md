# Self-Hosted Cloud

How to run Ant's cloud profile — multi-user, Google sign-in, organizations,
account approval, an admin dashboard — on your own infrastructure, with **no
billing**. Everything the profile needs ships in this repository.

For the full installation walkthrough (single VM vs Kubernetes, TLS, OAuth
client registration), see [cloud-mode/install.md](../cloud-mode/install.md).
This guide covers what the profile *is* and the compose-based quick path.

## The three deployment profiles

| Profile | `ANT_SERVER_MODE` | Auth | Billing | Who runs it |
|---|---|---|---|---|
| **Local** | `local` | none — single `local:local` tenant | off (free) | One person, one machine. [local-mode/install.md](../local-mode/install.md) |
| **Self-hosted cloud** | `cloud` | Google OAuth, JWT cookie | **off (unmetered)** | A team on its own VM / cluster — this guide |
| **Managed cloud** | `cloud` | Google OAuth, JWT cookie | on — `@ant/cloud` overlay | Anthropic-of-your-org, i.e. us: `ant.crosstoken.io` |

`ANT_SERVER_MODE=cloud` no longer implies billing. Billing exists only when
the private `@ant/cloud` overlay is loaded; without it the same cloud code
path runs identity, organizations, approval, and admin from OSS core, and
`GET /api/system/config` reports `capabilities.billing: false`. The seam is
documented in `core/config/billingCapability.ts`.

`ANT_REQUIRE_BILLING=1` is **reserved for the managed deployment** — it turns
a missing billing overlay into a boot failure so the managed service can never
silently degrade to a free tier. Leave it unset when self-hosting.

## Env checklist

| Variable | Required | Notes |
|---|---|---|
| `ANT_SERVER_MODE` | yes | `cloud`. |
| `ANT_REDIS_URL` | yes | Cloud mode has no default — set it explicitly. The compose base already sets `redis://redis:6379`. |
| `ANT_JWT_SECRET` | yes | ≥ 32 chars. `openssl rand -hex 32`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | yes | OAuth client from the [Google Cloud Console](https://console.cloud.google.com/apis/credentials). Register `${FRONTEND_URL}/api/auth/google/callback` as an authorized redirect URI. |
| `GOOGLE_REDIRECT_URI` | no | Only when the callback host differs from `FRONTEND_URL`; otherwise derived as `${FRONTEND_URL}/api/auth/google/callback`. |
| `ANT_SUPER_ADMIN_EMAILS` | recommended | Comma-separated operator emails. This env allowlist is the authoritative admin gate. |
| `FRONTEND_URL` | yes | Public origin users visit, e.g. `https://ant.example.com`. Drives CORS and the OAuth redirect derivation. |

Full variable reference: [reference/env-vars.md](../reference/env-vars.md).

## Quick start with Docker Compose

The repo ships an override file that flips the local compose stack to the
cloud profile:

```bash
cp .env.example .env
# then add to .env:
#   ANT_JWT_SECRET=<openssl rand -hex 32>
#   GOOGLE_CLIENT_ID=...
#   GOOGLE_CLIENT_SECRET=...
#   ANT_SUPER_ADMIN_EMAILS=you@example.com

docker compose -f docker-compose.yml -f docker-compose.cloud.yml up -d
open http://localhost:4200
```

The override sets the cloud env on all four ant services and inherits
everything else (Redis, workspace volume, ports) from the base file. The
required variables fail fast with a hint if missing — compose refuses to
start rather than booting an unauthenticatable server.

## First login and account approval

1. The operator (an email listed in `ANT_SUPER_ADMIN_EMAILS`) signs in with
   Google. Super-admin status comes from the env allowlist, not the database,
   so the first login already has admin rights.
2. Open the admin dashboard (`packages/admin-ui`, a standalone SPA built for
   the `/admin/` path). Quickest: `pnpm --filter @ant/admin-ui dev` and open
   `http://localhost:4250/admin/` — the dev server proxies `/api` to the API
   server. For a permanent deployment, `pnpm --filter @ant/admin-ui build`
   and serve `packages/admin-ui/dist/` under `/admin/` on the same origin as
   the app (same-origin ⇒ the auth cookie rides automatically).
3. Choose the default policy for new accounts: **auto-approve** or
   **require-approval**.
4. With `require-approval`, teammates who sign in land in `pending` until a
   super-admin approves them from the dashboard.

The refund control in the dashboard is billing-only — it hides itself when
`GET /api/system/config` reports `capabilities.billing: false`, which is
always the case on a self-hosted deployment.

## Read next

- [cloud-mode/install.md](../cloud-mode/install.md) — single-host vs
  Kubernetes shapes, TLS, IDE pods.
- [reference/env-vars.md](../reference/env-vars.md) — every runtime knob.
