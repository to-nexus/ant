# Installation

This page covers prerequisites, dependency setup, and a sanity check. If you
just want to run Ant fast, jump to [quickstart](quickstart.md).

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js     | 18.17+  | LTS recommended; 20.x works.       |
| pnpm        | 9 or 10 | `corepack enable && corepack prepare pnpm@10 --activate` |
| Docker      | 24+     | Used for Redis + ChromaDB locally. |
| Docker Compose | v2   | Bundled with Docker Desktop.       |
| Git         | 2.40+   |                                    |
| LLM key     | —       | Anthropic Claude (primary) or OpenAI. |

Verify:

```bash
node --version
pnpm --version
docker --version
docker compose version
git --version
```

## Clone and install

```bash
git clone https://github.com/<org>/ant
cd ant
pnpm install
```

The install will:

- Resolve workspace packages (`@ant/cli`, `@ant/ui`, `@ant/shared`).
- Build native binaries that pnpm allow-lists (`@vscode/ripgrep`).
- Skip optional native deps unless you ask for them.

If `pnpm install` fails with `ENOENT` while spawning ripgrep, see
[troubleshooting](troubleshooting.md#ripgrep-enoent).

## Configure environment

Copy the example file and fill in the keys you have:

```bash
cp packages/ant-cli/.env.example.local packages/ant-cli/.env
```

Minimum viable `.env`:

```
ANT_SERVER_MODE=local
ANT_ANTHROPIC_API_KEY=sk-ant-...
ANT_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

Other knobs:

- `ANT_OPENAI_API_KEY=sk-...` — fall back to OpenAI for some jobs.
- `ANT_TASK_CONCURRENCY=3` — parallel task workers.
- `ANT_VECTOR_DB_ENABLED=true` — enable RAG via ChromaDB (requires
  `pnpm dev:infra:vector`).
- `ANT_WORKSPACE_BASE_PATH=./workspaces` — where Ant stores per-feature data.

The full list lives in [reference/env-vars.md](../reference/env-vars.md).

## Boot infrastructure

```bash
pnpm dev:infra
```

This brings up Redis and Chroma via Docker Compose. To check:

```bash
docker ps                       # see redis and chroma containers
redis-cli -p 16379 ping         # PONG
```

To shut down infra:

```bash
pnpm dev:infra:down
```

## Sanity check

```bash
pnpm test:cli                   # runs the ant-cli vitest suite
pnpm typecheck                  # all packages
```

If both are green, you are ready for the [quickstart](quickstart.md).

## Where things live

| Path                         | Purpose                                          |
|------------------------------|--------------------------------------------------|
| `packages/ant-cli/`          | Backend (4 process entry points share this code).|
| `packages/ant-ui/`           | Frontend.                                        |
| `packages/ant-shared/`       | Cross-package types only.                        |
| `workspaces/`                | Per-project workspaces (gitignored content).     |
| `docs/`                      | This documentation tree.                         |
| `.env`                       | Local overrides (do **not** commit).             |

## Next steps

- [Quickstart](quickstart.md) — first directive in 5 minutes.
- [First feature tutorial](first-feature.md) — end-to-end PRD → Design → Code.
- [Self-hosting guide](../guides/self-hosting.md) — when you outgrow `dev:local:all`.
