# Cloud Mode — Develop

Run the cloud build on localhost so you can iterate on Ant cloud-mode
features (OAuth, IDE orchestration, JWT cookies, organization
onboarding) without deploying. This is **Persona C-dev**: you have the
cloud code path running locally and your laptop's Chrome talks to it.

If you only want to run Ant on your machine without any of this, see
[../local-mode/install.md](../local-mode/install.md). For production
self-host, see [install.md](install.md).

## What changes versus local mode

| Concern | Local mode | Cloud-mode dev |
|---|---|---|
| Auth | `local:local` tenant, no OAuth | Google OAuth + JWT cookie |
| IDE orchestrator | Docker | Docker or Kubernetes (your choice; Docker is easier locally) |
| Figma | Desktop MCP | HTTP bridge |
| Cookies | No JWT cookie issued | JWT cookie with the real production attributes |
| FE selector | Local default | Cloud default (depending on `VITE_CLOUD_BACKEND_BASE`) |

You're running the exact same code paths cloud production runs — that's
the whole point.

## Required env

```bash
# packages/ant-cli/.env
ANT_SERVER_MODE=cloud
ANT_REDIS_URL=redis://localhost:16379
ANT_ENCRYPTION_KEY=$(openssl rand -hex 32)
ANT_JWT_SECRET=$(openssl rand -base64 48)
ANT_API_URL=http://localhost:4100

# Google OAuth (create a test client in Google Cloud Console)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:4100/api/auth/google/callback

# FE allowlist
FRONTEND_URL=http://localhost:5173
ANT_CORS_ORIGINS=http://localhost:5173
ANTHROPIC_API_KEY=sk-ant-...
```

```bash
# packages/ant-ui/.env.development (FE build-time, Vite reads this)
VITE_CLOUD_BACKEND_BASE=http://localhost:4100
```

`VITE_CLOUD_BACKEND_BASE` matters because Phase 1's launch-mode init
inspects it:

- If `VITE_CLOUD_BACKEND_BASE` is **same-origin** as the page → default
  to `launchMode='cloud'` on first load.
- If **external origin** → cloud toggle navigates there (matches
  managed `ant.crosstoken.io` deployments).
- If **unset** → cloud toggle disabled, local default (this is the
  Persona A configuration).

For dev with the FE on `:5173` and BE on `:4100`, they are different
origins (different ports = different origins). Vite's dev server
proxies `/api` and `/realtime` to `:4100` so the browser sees them as
same-origin. That makes the localStorage stickiness and `setLaunchMode`
toggle work without navigation.

## OAuth client setup

In [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials),
create an **OAuth 2.0 Client ID**:

- **Authorized JavaScript origins**:
  - `http://localhost:5173`
  - `http://localhost:4100`
- **Authorized redirect URIs**:
  - `http://localhost:4100/api/auth/google/callback`

Both ports are necessary because the OAuth initiation goes from the FE
(`:5173`) and the callback returns to the BE (`:4100`).

## CORS for cross-origin dev

Local dev with the cloud build is the **only documented scenario where
you need `ANT_CORS_ORIGINS` explicitly** — Vite proxies in practice
collapse this back to same-origin, but if you bypass the proxy
(e.g. running the production FE bundle against the dev BE on a
different host) you'll need:

```
ANT_CORS_ORIGINS=http://localhost:5173
```

The Phase 2 `[CORS]` startup warning fires in this configuration if
both `FRONTEND_URL` and `ANT_CORS_ORIGINS` are unset — it surfaces
silent CORS failures so they're not discovered in production.

## Cookie policy (verified against the source)

The JWT cookie attributes are set by
[`JwtService.getCookieOptions`](../../packages/ant-cli/src/infrastructure/auth/JwtService.ts):

| Attribute | Value | Source |
|---|---|---|
| `HttpOnly` | `true` | Always on. JS can't read the JWT. |
| `Secure` | `true` in production, `false` in dev | Driven by `isProduction` (Node `NODE_ENV==='production'`). |
| `SameSite` | `lax` | Hard-coded. |
| `Domain` | unset for `localhost` / IP / non-known hosts; set to the registrable domain (e.g. `.crosstoken.io`) for hosts that match `KNOWN_BASE_DOMAINS` or when `COOKIE_DOMAIN` env is set | Resolved by `deriveCookieDomain`. |
| `Path` | `/` | Default. |

Implications for cloud-mode dev:

- On `localhost` the `Domain` attribute is **omitted** → host-only
  cookie. That's correct for single-origin dev.
- `Secure=false` in dev means the cookie travels over plain HTTP.
  **Don't disable HTTPS-mode in production** to make this convenient
  — it's gated on `NODE_ENV` deliberately.
- `SameSite=lax` means the cookie **does** travel on top-level
  navigation (the OAuth redirect) but **does not** travel on
  cross-site `fetch` from a different registrable domain. If you need
  the JWT cookie to be readable from a different registrable domain in
  dev (very rare), set `COOKIE_DOMAIN` to the shared parent and serve
  both origins under it via `/etc/hosts`.
- The matching `getClearCookieOptions` must return identical
  `domain`/`path`/`sameSite`/`secure` values — RFC 6265bis requires
  it. Don't fork the two.

⚠️ Cookie `SameSite=lax` with `Secure=true` is **not** the same policy
as the cross-site SSO pattern (`SameSite=None; Secure`). If your
deployment shape needs cross-site cookie transmission (e.g. the FE
served from a CDN on a different registrable domain than the BE), that
requires a code change — there is no env switch today.

## Run

```bash
pnpm dev:infra:redis
pnpm dev:cloud:all
```

`pnpm dev:cloud:all` boots all four BE processes with
`ANT_SERVER_MODE=cloud` and the UI dev server. Visit
[http://localhost:5173](http://localhost:5173).

You should see:

- The GNB selector with **Cloud** active (Phase 1 origin-detection).
- A **Sign In** button (no Local Org badge).
- Clicking Sign In starts Google OAuth.
- After OAuth, the **Organization onboarding** screen for new users
  (Phase 3). Existing users go straight to the main UI.

## End-to-end smoke test

Walk through the Phase 3 onboarding flows to verify the dev setup:

1. **Sign Up with a fresh consumer email** (Google test account, e.g.
   `you@gmail.com`).
2. **Onboarding** appears with an empty input. Skip → land in
   `personal-<userId>`. Verify in the BE log:
   `[Auth] resolveOrganizationId → personal-<id>`.
3. **Sign Up with a fresh business email** (`you@acme.io` via a
   secondary Google account).
4. **Onboarding** appears with `acme` prefilled
   (`suggestedOrganizationName`). Accept → `organizationId='acme'`.
5. **Sign in a second business email on the same domain** —
   onboarding accepts the same `acme` input → both users in the same
   organization (handshake model).
6. **Hit a protected route with a `_pending` JWT** (e.g. open
   DevTools → Network during step 2 before submitting onboarding,
   call `/api/projects`) → expect `401 ONBOARDING_REQUIRED`.

## Local FE → Custom Cloud BE (advanced)

You can also point a **local FE** at a **remote cloud BE** for
debugging the FE against a real backend. This is the ⚠️ row in the
[CORS matrix](install.md#cors-operating-matrix):

```bash
# packages/ant-ui/.env.development
VITE_CLOUD_BACKEND_BASE=https://dev-ant.example.com
```

```bash
# Remote BE config:
ANT_CORS_ORIGINS=http://localhost:5173
# (in addition to FRONTEND_URL=https://dev-ant.example.com)
```

This shape is fragile: cookies from `dev-ant.example.com` can't be
read by JavaScript running on `localhost:5173` (different registrable
domains, host-only cookie, `SameSite=lax`). Use this for HTTP request
debugging only; for actual cloud-mode FE work, prefer the
`pnpm dev:cloud:all` single-host setup.

## What this doesn't cover

- **Production hardening** — see [install.md § Hardening
  checklist](install.md#hardening-checklist).
- **Kubernetes deployment** — see [install.md § Multi-tenant
  Kubernetes](install.md#multi-tenant-kubernetes) and the runbook at
  [../infra/cloud-deployment-guide.md](../infra/cloud-deployment-guide.md).
- **OAuth provider plug-ins** — only Google is in-tree. Adding a
  provider is a `packages/ant-cli/src/infrastructure/auth/` change.

## Next steps

- [Local Mode — Develop](../local-mode/develop.md) — contributing
  conventions (apply to both modes).
- [AGENTS.md](../../AGENTS.md) — binding architectural rules.
- [../internals/37-auth-unified-procedure.md](../internals/37-auth-unified-procedure.md) —
  auth flow internals.
