# Develop

For contributors building **Ant core** — or maintainers of a private
fork. If you only want to run Ant against your own codebase, see
[local-mode/install.md](local-mode/install.md) or
[cloud-mode/install.md](cloud-mode/install.md) instead.

> **Local vs cloud is one env flag, not two doc tracks.** Ant always
> runs the same 4-process topology backed by Redis, BullMQ, and
> Pub/Sub — `ANT_SERVER_MODE` in `.env` only swaps two integration
> points (auth tenant resolution and Figma MCP transport). The
> `:cloud` script names refer to the **topology** (4-process), not
> the deployment target.

## Monorepo layout

```
packages/
├── ant-cli/        Backend: API + Job worker + Realtime + Preview entry points
├── ant-ui/         Frontend: React + Vite SPA
└── ant-shared/     Cross-package TypeScript types (no runtime code)
```

`ant-shared` has no build step — it's referenced directly from source
via pnpm workspace resolution.

There's also:

```
packages/ant-site/   Marketing site (Next.js). Not part of the runtime.
```

## Four-process architecture

`ant-cli` is one codebase that ships as four separate processes. The
entry point and env vars decide which one starts:

| Process | Port | Entry point |
|---------|------|-------------|
| `ant-api` | 4100 | `composition/server.ts` |
| `ant-realtime` | 4101 | `infrastructure/realtime/start-realtime-server.ts` |
| `ant-job` | — | `infrastructure/worker/start-job-worker.ts` |
| `ant-preview` | 4102 | `infrastructure/preview/start-preview-server.ts` |

Inter-process communication is exclusively via Redis (Pub/Sub, KV,
BullMQ). **There is no direct HTTP between processes.** Local and
cloud modes share the same data plane; local just runs all four on
one machine.

Read [internals/02-infrastructure.md](internals/02-infrastructure.md)
for the canonical Redis key layout, queues, and pub/sub channels.

## Architectural rules

Ant has a small set of binding rules that protect the core contract.
The full SSOT lives in [AGENTS.md](../AGENTS.md) — what follows is a
contributor's pocket version:

- **Unified Distributed System Principle.** No in-memory fallbacks for
  Redis or BullMQ. If a feature can't work without Redis, fix it; don't
  add a Map.
- **Phase nodes are task-type blind.** No `if (task.type === 'verification')`
  inside `nodes/`, `routers/`, `parallel/`, or `common/tool/handlers/`.
  Task-specific logic lives in `tasks/{type}/hooks/`.
- **PromptBuilder is the only prompt entry point.** Don't call
  Handlebars or `render()` directly — that bypasses the system / rules /
  base / domain / basis / node layering.
- **`state.artifacts` is RAC-bound.** Only `loadResolvedArtifacts` and
  `appendOrUpdatePool` may write to the artifact pool. No wholesale
  disk scans in `resolve`.
- **Tier-Verification matrix.** Tier 2 = 1 task with
  `selfVerifyOnDone: true`. Tier 3/4 = 2+ tasks including a final
  verification task.
- **`serverMode` SSOT.** BE `/system/config` returns `authMode`
  (sourced from `ANT_SERVER_MODE`); FE stores it under
  `state.serverMode: AsyncFields<'local'|'cloud'>` (read-only). There
  is no FE toggle, no localStorage persistence, and no FE-side origin
  detection. Mode is fixed at BE startup — change `.env` and restart
  to switch modes.
- **Project Lifecycle SSOT.** `repoType` default is `'cloud'`; do not
  auto-map `serverMode` → `repoType`.

When in doubt, read [AGENTS.md](../AGENTS.md). It includes
regression-guard test names next to every rule.

## Daily loop

```bash
pnpm dev:infra                # Redis + ChromaDB + visual-processor
pnpm dev:all            # 4-process backend + UI + site, hot reload
pnpm test:cli                 # ant-cli vitest suite
pnpm typecheck                # all packages
pnpm build                    # type-check + test + build
```

`pnpm build` runs the full test suite as a prebuild gate — failing
tests abort the build. Don't bypass it (`--no-verify`, `[skip ci]`).

To run a single test file:

```bash
cd packages/ant-cli
pnpm vitest run tests/<area>/<file>.test.ts
```

Frontend-only:

```bash
cd packages/ant-ui
pnpm test
pnpm dev                      # only the Vite dev server
```

To run individual backend processes (debugging):

```bash
pnpm dev:api-server           # 4100
pnpm dev:realtime-server      # 4101
pnpm dev:job-worker
pnpm dev:preview-server       # 4102
```

LLM-mocked variant (no real Anthropic calls):

```bash
pnpm dev:mock:all
```

## Auth modes — `ANT_SERVER_MODE`

`packages/ant-cli/.env` decides which auth path runs. Both modes use
the same 4-process topology and the same daily-loop commands.

### Local mode (default) — `ANT_SERVER_MODE=local`

Tenant is hardcoded to `local:local`. No JWT cookie is issued; the BE
does not require sign-in. Figma uses the desktop MCP transport
directly. This is the path 99% of contributors use.

```bash
# packages/ant-cli/.env
ANT_SERVER_MODE=local
ANT_REDIS_URL=redis://localhost:16379
ANT_ENCRYPTION_KEY=$(openssl rand -hex 32)
ANTHROPIC_API_KEY=sk-ant-...
```

### Cloud mode — `ANT_SERVER_MODE=cloud`

You're running the exact same code paths cloud production runs —
Google OAuth, JWT cookies, organization onboarding, Figma HTTP bridge.
Use this when you're iterating on auth / IDE orchestration / onboarding.

| Concern | Local | Cloud |
|---|---|---|
| Auth | `local:local` tenant, no OAuth | Google OAuth + JWT cookie |
| IDE orchestrator | Docker | Docker or Kubernetes |
| Figma | Desktop MCP | HTTP bridge |
| Cookies | No JWT cookie issued | JWT cookie with production attributes |

Required env additions:

```bash
# packages/ant-cli/.env
ANT_SERVER_MODE=cloud
ANT_JWT_SECRET=$(openssl rand -base64 48)
ANT_API_URL=http://localhost:4100

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:4100/api/auth/google/callback

FRONTEND_URL=http://localhost:5173
ANT_CORS_ORIGINS=http://localhost:5173
```

```bash
# packages/ant-ui/.env.development (FE build-time)
VITE_CLOUD_BACKEND_BASE=http://localhost:4100
```

`VITE_CLOUD_BACKEND_BASE` is the **single build-time decision** of
where the FE talks to the BE. When set, all API/Realtime traffic
targets that origin; when unset, paths are relative (Vite proxy in
dev, same-origin in single-host deploy). It does NOT decide the BE's
mode — that comes from `ANT_SERVER_MODE` on the BE and is surfaced
read-only in the GNB badge via `GET /system/config`.

#### OAuth client setup

In [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials),
create an **OAuth 2.0 Client ID**:

- **Authorized JavaScript origins**: `http://localhost:5173`,
  `http://localhost:4100`
- **Authorized redirect URIs**:
  `http://localhost:4100/api/auth/google/callback`

Both ports are required because OAuth initiation runs from the FE
(`:5173`) and the callback returns to the BE (`:4100`).

#### Cookie policy

The JWT cookie attributes are set by
[`JwtService.getCookieOptions`](../packages/ant-cli/src/infrastructure/auth/JwtService.ts):

| Attribute | Value |
|---|---|
| `HttpOnly` | `true` (always) |
| `Secure` | `true` in production, `false` in dev (`NODE_ENV`-driven) |
| `SameSite` | `lax` (hard-coded) |
| `Domain` | unset for `localhost` / IP / unknown hosts; set to the registrable domain for hosts matching `KNOWN_BASE_DOMAINS` or when `COOKIE_DOMAIN` is set |
| `Path` | `/` |

On `localhost` the `Domain` attribute is omitted (host-only cookie) —
correct for single-origin dev. `Secure=false` in dev means the cookie
travels over plain HTTP; **don't disable HTTPS-mode in production** to
make this convenient. The matching `getClearCookieOptions` must return
identical `domain` / `path` / `sameSite` / `secure` values — RFC
6265bis requires it.

⚠️ `SameSite=lax` with `Secure=true` is **not** the cross-site SSO
pattern (`SameSite=None; Secure`). Deployments needing cross-site
cookie transmission (FE on a different registrable domain than BE)
require a code change — there is no env switch today.

#### End-to-end smoke test

After `pnpm dev:all` with the cloud env above, visit
[http://localhost:5173](http://localhost:5173):

1. **Sign Up with a fresh consumer email** (Google test account, e.g.
   `you@gmail.com`).
2. **Onboarding** appears with an empty input. Skip → land in
   `personal-<userId>`. BE log: `[Auth] resolveOrganizationId →
   personal-<id>`.
3. **Sign Up with a fresh business email** (`you@acme.io`).
4. **Onboarding** prefills `acme` (`suggestedOrganizationName`).
   Accept → `organizationId='acme'`.
5. **Sign in a second business email on the same domain** —
   onboarding accepts the same `acme` → both users land in the same
   organization (handshake model).
6. **Hit a protected route with a `_pending` JWT** — expect `401
   ONBOARDING_REQUIRED`.

#### Local FE → remote cloud BE (advanced)

You can also point a local FE at a remote cloud BE for FE debugging
against a real backend — see the ⚠️ row in the
[CORS matrix](cloud-mode/install.md#cors-operating-matrix). This
shape is fragile (cookies from the remote domain can't be read by JS
on `localhost:5173`) and is suitable only for HTTP request
debugging; for actual cloud-mode FE work, prefer the single-host
`pnpm dev:all` setup.

## Coding conventions

### TypeScript

- Strict mode is on. Don't turn it off in a PR.
- Explicit types at module boundaries (exported functions, public
  classes). Local inference is fine.
- Prefer `unknown` over `any`; if you need `any`, justify it in a
  comment.

### Comments

- Lean by default. Don't translate code line-by-line. One short
  sentence for non-obvious invariants only.
- JSDoc only for public APIs and `@deprecated` markers.
- The rationale + boundaries are in [AGENTS.md § "Comments — lean by
  default"](../AGENTS.md).

### Commit messages

- **English only**, regardless of the conversation or comment
  language.
- **Conventional Commits** format: `<type>(<scope>): <summary>`.
- Common types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`,
  `perf`.

Real-world examples from the repo:

```
feat(preview): Phase 1 service virtualization — ConnectionDetector + @connection grammar
fix(decompose): retry on JsonSyntaxViolation in LLM task JSON parse
refactor(preview): drop mock:* annotation tokens
```

### Prompt templates

If you touch any file under
`packages/ant-cli/src/core/prompt/templates/`, read [AGENTS.md §
"Prompt Engineering"](../AGENTS.md) first. Prompts are part of the
public surface the agents stand on; small drifts produce hard-to-debug
regressions.

The three policies to remember: **FPOP** (Principles over Examples,
What over How, Observable over Assumed, Universal over Specific,
Constraints over Instructions, Reminders for Blind Spots), **SBS**
(gated templates must be specific along the gate axis; always-on
templates must stay universal), **MECE** (the Service Virtualization
SSOT table is a worked example).

Prompt files are **English only**. Source comments may be Korean if
that's the team's working language, but `.md` templates are not.

## Pull requests

Quick checklist:

- [ ] `pnpm build` succeeds locally (tests run as the prebuild gate).
- [ ] `pnpm typecheck` is clean.
- [ ] You added or updated tests when changing behavior.
- [ ] No incident codenames or internal hostnames in code or docs.
- [ ] If you touched prompts, you ran the relevant prompt-policy
      tests ([AGENTS.md](../AGENTS.md) "Enforcement" blocks).
- [ ] PR description follows the template
      (`.github/PULL_REQUEST_TEMPLATE.md`).

### Sizing

- Target **< 400 changed lines** of production code per PR.
- One concern per PR (refactor + feature in separate PRs).
- Tests in the same PR as the behavior they cover.

Large refactors land as a stack of PRs; describe the stacking order
in the first PR's body.

### Phase-split work

For multi-phase plans (see this branch's plan files in
`.claude/plans/`), the convention is:

- One PR per phase.
- Each phase merges before the next phase opens.
- Cross-phase contracts (e.g. `/auth/me`'s `needsOnboarding` field
  between Phase 2 and Phase 3) are documented in the plan and locked
  in by regression tests in the earlier phase.

This sequencing keeps each PR independently reviewable and
reversible.

## Next steps

- [AGENTS.md](../AGENTS.md) — binding SSOT for human and AI
  contributors.
- [internals/](internals/) — deep dives (Redis key layout, prompt
  system, node graph, debug logging).
- [internals/37-auth-unified-procedure.md](internals/37-auth-unified-procedure.md)
  — auth flow internals.
- [testing/](testing/) — testing strategy and runbooks.
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — PR workflow and Code of
  Conduct.
