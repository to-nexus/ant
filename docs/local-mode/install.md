# Local Mode — Install

Run Ant on your own machine. Local mode is the default and recommended
entry point: no OAuth, no Kubernetes, no managed account — just Redis in
Docker and the four Ant processes on your laptop.

This page targets **Persona A (OSS local-only)**: developers and operators
who self-host Ant for personal or team use without a managed control
plane. If you are connecting a local frontend to a remote cloud backend,
see [develop.md](../develop.md) instead.

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
`ant-job` worker, `ant-preview` :4102) + UI dev server (`ui` :5173) +
marketing site (`site`) in one terminal under `concurrently`.

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
pnpm build               # type-check, test, and build all packages
pnpm start:all     # 4-process backend + UI + site
```

Behind a process manager (`pm2`, `systemd`), invoke the per-process
scripts (`start:api-server`, `start:realtime-server`,
`start:job-worker`, `start:preview-server`) so each gets its own
supervised slot.

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

The GNB shows a **Local Org / Local User badge** where Sign In / Sign Out
normally sit in cloud mode. Account Configuration is reachable from the
same dropdown. The badge itself is the mode indicator — there is no
separate mode toggle or label; the BE's `ANT_SERVER_MODE` (sourced from
its `.env`) is the single source of truth and FE simply mirrors it.

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
  `PORT=4200 pnpm dev:api-server`.
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
