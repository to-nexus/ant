# Local Mode — Install

Run Ant on your own machine. Local mode is the default and recommended
entry point: no OAuth, no Kubernetes, no managed account — just Redis in
Docker and the four Ant processes on your laptop.

This page targets **Persona A (OSS local-only)**: developers and operators
who self-host Ant for personal or team use without a managed control
plane. If you are connecting a local frontend to a remote cloud backend,
see [cloud-mode/develop.md](../cloud-mode/develop.md) instead.

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js     | 18.17+  | LTS recommended; 20.x works. |
| pnpm        | 10+     | `corepack enable && corepack prepare pnpm@10 --activate` |
| Docker      | 24+     | Used for Redis. Docker Desktop on macOS/Windows. |
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
git clone https://github.com/<org>/ant
cd ant
pnpm install
```

`pnpm install` resolves the workspace packages (`@ant/cli`, `@ant/ui`,
`@ant/shared`) and builds the native binaries Ant allow-lists
(`@vscode/ripgrep` is the only one that matters in local mode). If
ripgrep fails with `ENOENT` while spawning, see
[../getting-started/troubleshooting.md#ripgrep-enoent](../getting-started/troubleshooting.md#ripgrep-enoent).

## Required env

Copy the example file and fill in the three values that are mandatory:

```bash
cp packages/ant-cli/.env.example.local packages/ant-cli/.env
```

Minimum viable `.env`:

```
ANT_SERVER_MODE=local
ANT_ENCRYPTION_KEY=$(openssl rand -hex 32)   # 64-char hex
ANTHROPIC_API_KEY=sk-ant-...
ANT_WORKSPACE_BASE_PATH=~/ant-workspaces      # default, change if you want
```

That's everything local mode needs. `ANT_JWT_SECRET`, `GOOGLE_CLIENT_*`,
`FRONTEND_URL`, `ANT_CORS_ORIGINS`, `GOOGLE_REDIRECT_URI` — leave them
commented out. Local mode skips OAuth entirely and accepts loopback
origins automatically; setting cloud-only variables in local mode has no
effect but won't break anything.

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

Two ways: dev (with hot reload) or production-style (built artifacts).

### Dev mode — quickest path

```bash
pnpm dev:local:all
```

Boots three processes in one terminal: the API server (`cli`,
`ant-api` on `:4100`), the UI dev server (`ui` on `:5173`), and the
marketing site (`site`). The API server spawns each `job-runner` as a
child process on demand — no separate worker is needed for local dev.

This is enough to use Ant end-to-end **as long as you don't need SSE
streaming or the preview server**. SSE (chat updates / workflow
streams / kanban) and per-feature preview servers live in dedicated
processes (`ant-realtime`, `ant-preview`). If a feature exercises
them, start the missing processes from extra terminals:

```bash
pnpm dev:realtime-server    # Realtime SSE (:4101)
pnpm dev:preview-server     # Preview server (:4102)
pnpm dev:job-worker         # BullMQ worker — only needed when API delegates jobs via Redis queue (cloud-style)
```

Or, if you want the full 4-process layout under one command, use the
cloud-mode multiplexer:

```bash
ANT_SERVER_MODE=local pnpm dev:cloud:all
```

`dev:cloud:all` runs `dev:cloud` (= 4 BE processes via `concurrently`)
+ `dev:ui` + `dev:site`. With `ANT_SERVER_MODE=local` overriding the
mode, you get the local auth bypass with all four BE processes. The
`dev:local:mock` / `dev:local:mock:all` scripts follow the same
pattern with `ANT_LLM_MOCK=true`.

### Production-style

```bash
pnpm build               # type-check, test, and build all packages
pnpm start:local:all     # API + UI + site (mirrors dev:local:all)
pnpm start:local:build:all # API + Realtime + Job + Preview + UI + site (full 4-process)
```

`start:local:all` runs only the API + UI + site (matches `dev:local:all`).
For a full 4-process production-style run, use `start:local:build:all`
(an alias of `start:cloud` with the local auth bypass).

Behind a process manager (`pm2`, `systemd`), invoke the per-process
scripts (`start:api-server`, `start:realtime-server`, `start:job-worker`,
`start:preview-server`) so each gets its own supervised slot.

## Health checks

```bash
curl -s http://localhost:4100/health  | jq .   # ant-api
curl -s http://localhost:4101/health  | jq .   # ant-realtime
curl -s http://localhost:4102/health  | jq .   # ant-preview
curl -s http://localhost:5173/        > /dev/null && echo ok
```

`ant-job` doesn't expose HTTP — check it via `docker ps` (its log stream
or the BullMQ queue depth).

## What the UI looks like in local mode

After Phase 1 of the launch-mode work landed, the GNB shows:

- A **Local / Cloud selector**. Local is active by default; the Cloud
  toggle is disabled with a tooltip ("cloud build origin not
  configured") unless you set `VITE_CLOUD_BACKEND_BASE` at build time.
- A **Local Org / Local User badge** where Sign In / Sign Out normally
  sit in cloud mode. Account Configuration is still reachable from the
  same dropdown.

There is no signup / OAuth screen in local mode — everything belongs to
a single fixed `local:local` tenant.

## External workspace mount

By default Ant writes feature data to `~/ant-workspaces`. If you want
that on a different volume (network drive, larger SSD):

```bash
# In .env:
ANT_WORKSPACE_BASE_PATH=/Volumes/work/ant-workspaces
```

Make sure the path exists and the user running Ant can read/write it.
The directory layout is `~/<workspace-root>/<org>/<user>/<project>/<feature>/`.
In local mode `<org>=local` and `<user>=local`.

## Troubleshooting

- **Port collision (4100 / 4101 / 4102 / 5173)** — each process picks
  its port from the `PORT` env var; the npm scripts hard-code
  `PORT=4100`, `PORT=4101`, `PORT=4102` (see
  [`packages/ant-cli/package.json`](../../packages/ant-cli/package.json)).
  Override by running the per-process script with a different `PORT`:
  `PORT=4200 pnpm dev:local`.
- **Redis not running** — `pnpm dev:infra:redis` must be up before
  `dev:local:all`. There is **no in-memory fallback** — Ant fails fast
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

- [Local Mode — Develop](develop.md) — contributing to Ant core, or
  forking it.
- [first-feature.md](../getting-started/first-feature.md) — end-to-end
  PRD → Design → Code walkthrough.
- [Cloud Mode — Install](../cloud-mode/install.md) — when you want a
  managed account (Persona B) or your own multi-tenant deployment
  (Persona C).
