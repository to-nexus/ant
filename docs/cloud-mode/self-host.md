# Self-Hosted Cloud

How to run Ant's cloud profile — multi-user, Google sign-in, organizations,
account approval, an admin dashboard — on your own infrastructure, with **no
billing**. Everything the profile needs ships in this repository.

For the full installation walkthrough (single VM vs Kubernetes, TLS, OAuth
client registration, the required-env table), see [install.md](install.md).
This guide covers what the profile *is*, the multi-user hardening steps, the
compose-based quick path, and account approval.

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

## Env

The mandatory variables (`ANT_SERVER_MODE`, `ANT_REDIS_URL`, `ANT_ENCRYPTION_KEY`,
the JWT key pair, OAuth, `FRONTEND_URL`) and their per-service scoping live in
the install walkthrough — see [install.md → Required env](install.md#required-env).
Add `ANT_SUPER_ADMIN_EMAILS` (comma-separated operator emails; the authoritative
admin gate) for the approval flow below. Full reference:
[reference/env-vars.md](../reference/env-vars.md).

### Session keys — why a pair

Sessions are ES256 only. A symmetric algorithm would make VERIFY and MINT the
same capability, and `ant-preview` runs the install and dev commands from your
users' projects under its own UID — anything in its environment is readable
from that code through `/proc`. The key pair splits the authority: only
`ant-api` can mint, and a public key read out of `/proc` buys nothing.

Generate a P-256 pair once and keep the private half on `ant-api`:

```bash
openssl ecparam -genkey -name prime256v1 -noout \
  | openssl pkcs8 -topk8 -nocrypt -out jwt-private.pem
openssl ec -in jwt-private.pem -pubout -out jwt-public.pem

# then in .env
ANT_JWT_PUBLIC_KEY="$(cat jwt-public.pem)"
ANT_JWT_PRIVATE_KEY="$(cat jwt-private.pem)"
```

`docker-compose.cloud.yml` already routes them: the public key to api / realtime /
preview, the private key to api alone. Rotating the pair invalidates live sessions
(users sign in again).

### Two more hardening steps for a multi-user deployment

Both are deployment-layer, so the code ships the seam and the deployment decides.

1. **Give user-authored children their own UID and GID.** The images provision
   an unprivileged `ant-child` account (uid/gid 10001). Set `ANT_CHILD_UID=10001`
   **and a non-empty `ANT_CHILD_GID`** (10001) on `ant-preview` and `ant-job`,
   and permit those two containers to change uids/gids (a root entrypoint with
   `CAP_SETUID`/`CAP_SETGID`, or an equivalent pod security context — the compose
   cloud profile ships this shape). This is not optional in cloud mode: the
   runtime is fail-closed and REFUSES every user-authored spawn (`run_command`,
   stdio MCP servers, preview dev servers, installs) until the drop is
   configured, distinct from the service UID, and actually permitted. **GID must
   be non-empty** — an empty `ANT_CHILD_GID` emits no `setpriv --regid`, leaving
   the "dropped" child at egid 0 with root's supplementary groups (H-014). The
   values are plain fixed integers baked into the image's `/etc/passwd`,
   identical on every replica — not secrets, and not per-pod. The UID-drop
   launcher (`setpriv`) is resolved by absolute path and the stdio MCP `env` may
   not carry loader/interpreter variables (`LD_*`, `DYLD_*`, `NODE_OPTIONS`, …),
   so a tenant cannot substitute the launcher or inject into it before the drop.

   **The credentialed install gets its own UID too.** A user's private-registry
   PAT is passed to the dependency-FETCH pass in its environment, and
   `/proc/<pid>/environ` is readable by any process sharing that UID — so with a
   single `ant-child` for everything, one tenant's dev server could read another
   tenant's PAT out of a concurrent install. Set `ANT_CHILD_ACQUIRE_UID=10002`
   and `ANT_CHILD_ACQUIRE_GID=10001` (the image provisions `ant-acquire`; same
   group as `ant-child`, so the installed tree stays writable by the
   credential-free lifecycle pass). No extra capability is needed beyond the
   UID/GID drop privilege above. Cloud is fail-closed here as well: a
   credentialed fetch is refused unless this UID is configured and differs from
   both the service UID and `ANT_CHILD_UID`.

2. **Serve user content from its own hostname.** `ant-preview` runs two listeners:
   `PORT` (4102) is the cookie-authenticated `/projects/*` control plane, and
   `ANT_PREVIEW_CONTENT_PORT` (4103) serves preview and deploy content. Publish
   them under **different hostnames** and point `VITE_PREVIEW_CONTENT_HOST` at the
   content one. A public deploy's HTML or SVG is attacker-authorable; on a shared
   origin its script can call the control plane with the viewer's session. The
   local compose stack demonstrates the layout: `:4200` is the app, `:4201` is
   content.

## Quick start with Docker Compose

The repo ships an override file that flips the local compose stack to the
cloud profile:

```bash
cp .env.example .env
# then add to .env:
#   ANT_JWT_PUBLIC_KEY / ANT_JWT_PRIVATE_KEY  (see "Session keys" above —
#   the compose override scopes them per service)
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

- [install.md](install.md) — single-host vs Kubernetes shapes, TLS, IDE pods.
- [reference/env-vars.md](../reference/env-vars.md) — every runtime knob.
