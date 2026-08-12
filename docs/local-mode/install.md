# Local Mode — Install

Run Ant on your own machine. Local mode is the default and recommended
entry point: no OAuth, no Kubernetes, no managed account — just Redis in
Docker and the four Ant processes on your laptop.

This page targets **Persona A (OSS local-only)**: developers and operators
who self-host Ant for personal or team use without a managed control
plane. If you are connecting a local frontend to a remote cloud backend,
see [develop.md](../develop.md) instead.

## Prerequisites

**OS support: macOS and Linux.** Windows is supported only via WSL2, and
WSL2 is currently untested — reports welcome, but expect rough edges.

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js     | >= 22.13 | Enforced by the root `engines` field. |
| pnpm        | 11.1.0  | Pinned via `packageManager`. `corepack enable && corepack prepare pnpm@11.1.0 --activate`. pnpm 10 and npm/yarn are rejected at install time (pnpm 10 silently ignores pnpm-11 workspace keys and skips native postinstalls). |
| Docker      | 24+     | Used for Redis. Docker Desktop on macOS. |
| Git         | 2.40+   |  |
| LLM key     | —       | Anthropic Claude (primary) or OpenAI / Gemini. |

Verify:

```bash
node --version
pnpm --version
docker --version
git --version
```

## Clone and install

```bash
git clone https://github.com/to-nexus/ant
cd ant
pnpm install
```

`pnpm install` resolves the workspace packages (`@ant/cli`, `@ant/ui`,
`@ant/shared`) and builds the native binaries Ant allow-lists
(`@vscode/ripgrep` is the only one that matters in local mode). If
ripgrep fails with `ENOENT` while spawning, see
[../getting-started/troubleshooting.md#ripgrep-enoent](../getting-started/troubleshooting.md#ripgrep-enoent).

## Required env

Local mode needs exactly **one** value: an LLM provider key. Copy the
example file and set it:

```bash
cp packages/ant-cli/.env.example.local packages/ant-cli/.env
```

Minimum viable `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Everything else has a working default in local mode:

- `ANT_SERVER_MODE` defaults to `local`.
- `ANT_REDIS_URL` defaults to `redis://localhost:16379` (the port
  `pnpm dev:infra:redis` publishes). Cloud mode has no default and
  fails fast.
- `ANT_ENCRYPTION_KEY` is auto-generated on first boot and persisted to
  `<workspaceRoot>/.ant/encryption.key` (mode 0600). To pin it yourself,
  it must be exactly 64 hex chars: `openssl rand -hex 32`.
- `ANT_WORKSPACE_BASE_PATH` falls back to a sibling `../ant-workspaces`
  directory if one exists, else `<cwd>/workspaces`. Set it explicitly if
  you want feature data somewhere specific.

`ANT_JWT_SECRET`, `GOOGLE_CLIENT_*`, `FRONTEND_URL`, `ANT_CORS_ORIGINS`,
`GOOGLE_REDIRECT_URI` — leave them commented out. Local mode skips OAuth
entirely and accepts loopback origins automatically; setting cloud-only
variables in local mode has no effect but won't break anything.

The full env reference: [../reference/env-vars.md](../reference/env-vars.md).

## Recommended infra

Local mode needs Redis. That's it.

```bash
pnpm dev:infra:redis        # starts redis on :16379
```

This is a Docker Compose service. Verify with:

```bash
docker ps                    # should show ant-redis
redis-cli -p 16379 ping      # PONG
```

To shut it down: `pnpm dev:infra:down`.

## Optional infra

### Vector DB (RAG)

`ANT_VECTOR_DB_ENABLED=true` enables codebase indexing via ChromaDB.
**Off by default — the feature is wired but not production-quality.**
Without it, RAG falls back to a `git-changes → keyword` chain that
covers most code-job needs without the storage and embedding cost.

If you want to try it:

```bash
# In .env:
ANT_VECTOR_DB_ENABLED=true
CHROMA_URL=http://localhost:8000
EMBEDDER_URL=http://localhost:8001

# Then:
pnpm dev:infra:vector
```

### Visual processor (background removal)

Used by the creator agent for image post-processing only. Not required
unless you run image-generation flows.

```bash
# In .env:
ANT_VISUAL_PROCESSOR_URL=http://localhost:4103
```

## Run

Ant runs as a **4-process topology** (API + Realtime + Job + Preview)
in every mode — local and cloud share the same data plane. The
`:cloud` in the script names refers to that topology, not the
deployment target; with `ANT_SERVER_MODE=local` in your `.env`, you
get the local auth bypass and Figma desktop MCP.

### Dev (hot reload)

```bash
pnpm dev:all
```

Boots the 4 backend processes (`ant-api` :4100, `ant-realtime` :4101,
`ant-job` worker, `ant-preview` :4102) + UI dev server (`ui` :4200) in
one terminal under `concurrently`. The marketing site is not part of
`dev:all` — run `pnpm dev:site` separately if you are working on it.

To run a backend process in isolation (debugging):

```bash
pnpm dev:api-server         # API only (:4100)
pnpm dev:realtime-server    # Realtime SSE (:4101)
pnpm dev:preview-server     # Preview (:4102)
pnpm dev:job-worker         # BullMQ worker
```

To skip real Anthropic calls, use the LLM-mock variant:

```bash
pnpm dev:mock:all
```

### Production-style (built artifacts)

```bash
pnpm build               # build all packages (esbuild — run pnpm typecheck / pnpm test separately)
pnpm start:all           # 4-process backend + UI
```

Behind a process manager (`pm2`, `systemd`), invoke the per-process
scripts (`start:api-server`, `start:realtime-server`,
`start:job-worker`, `start:preview-server`) so each gets its own
supervised slot.

### Docker Compose (no Node/pnpm on the host)

The root `docker-compose.yml` runs the whole stack — Redis, the four
backend processes, and an nginx gateway serving the UI — with only
Docker installed:

```bash
cp .env.example .env        # put ANTHROPIC_API_KEY (or another provider key) in it
docker compose up -d
open http://localhost:4200
```

Everything is same-origin behind `:4200`: `/app/` is the UI, `/api` and
`/realtime` are proxied, and previews are path-routed
(`http://localhost:4200/{urlKey}/...`). Project data persists in the
`ant-workspaces` named volume. Redis is intentionally not published to
the host, so this coexists with a `pnpm dev:infra:redis` on 16379 —
but the compose stack and `pnpm dev:all` cannot run at the same time
(both claim 4100/4101/4102/4200). Preview dev servers listen on ports
internal to the `ant-preview` container; if HMR misbehaves behind the
gateway, `:4102` is also published for a direct connection.

## Health checks

Run `pnpm doctor` for a one-shot install self-check (versions, Redis,
process health, provider keys). Manually:

```bash
curl -s http://localhost:4100/api/health  | jq .   # ant-api (health routes live under /api)
curl -s http://localhost:4101/health      | jq .   # ant-realtime
curl -s http://localhost:4102/health      | jq .   # ant-preview
curl -s http://localhost:4200/            > /dev/null && echo ok
```

`ant-job` doesn't expose HTTP — check its log stream, the BullMQ queue
depth, or `pnpm doctor`'s worker heuristic.

## What the UI looks like in local mode

The GNB shows a **Local Org / Local User badge** where Sign In / Sign Out
normally sit in cloud mode. Account Configuration is reachable from the
same dropdown. The badge itself is the mode indicator — there is no
separate mode toggle or label; the BE's `ANT_SERVER_MODE` (sourced from
its `.env`) is the single source of truth and FE simply mirrors it.

There is no signup / OAuth screen in local mode — everything belongs to
a single fixed `local:local` tenant.

## External workspace mount

By default Ant writes feature data to a sibling `../ant-workspaces`
directory if one exists, else `<cwd>/workspaces`. If you want that on a
different volume (network drive, larger SSD):

```bash
# In .env (absolute path — ~ is not expanded):
ANT_WORKSPACE_BASE_PATH=/Volumes/work/ant-workspaces
```

Make sure the path exists and the user running Ant can read/write it.
The directory layout is `~/<workspace-root>/<org>/<user>/<project>/<feature>/`.
In local mode `<org>=local` and `<user>=local`.

## Troubleshooting

- **Port collision (4100 / 4101 / 4102 / 4200 / 4300)** — the backend
  processes take their port from `PORT`, hard-coded per script as
  `PORT=4100` / `4101` / `4102` (see
  [`packages/ant-cli/package.json`](../../packages/ant-cli/package.json)).
  Override by running the per-process script with a free port, e.g.
  `PORT=4110 pnpm dev:api-server`. The UI (`ANT_UI_PORT`, default 4200)
  and the site (`ANT_SITE_PORT`, default 4300) have their own variables;
  the UI uses `strictPort`, so it fails loudly instead of drifting to
  another port. Pick a port none of the five already use.
- **Redis not running** — `pnpm dev:infra:redis` must be up before
  `dev:all`. There is **no in-memory fallback** — Ant fails fast
  rather than silently using an in-process queue.
- **OAuth env leftover from a cloud experiment** — local mode ignores
  `FRONTEND_URL` / `GOOGLE_CLIENT_ID` / `ANT_JWT_SECRET`, but if you
  hit a `[CORS]` startup warn you probably set `ANT_SERVER_MODE=cloud`
  without setting `FRONTEND_URL`. Set `ANT_SERVER_MODE=local`.
- **`ENOENT` spawning ripgrep** — see
  [../getting-started/troubleshooting.md#ripgrep-enoent](../getting-started/troubleshooting.md#ripgrep-enoent).
- **Workspace shows "Project already exists" after delete** — see
  [../getting-started/troubleshooting.md](../getting-started/troubleshooting.md#project-already-exists-on-createproject).

## Next steps

- [Develop](../develop.md) — contributing to Ant core, or forking it.
- [first-feature.md](../getting-started/first-feature.md) — end-to-end
  PRD → Design → Code walkthrough.
- [Cloud Mode — Install](../cloud-mode/install.md) — when you want a
  managed account (Persona B) or your own multi-tenant deployment
  (Persona C).
