# CLI reference

Ant ships a small CLI for workspace management and indexing. Most of the
"feature work" happens through the UI; the CLI is for operator chores.

```bash
pnpm --filter @ant/cli exec ant <command>
# or, for global install in production deployments:
ant <command>
```

## Commands

### `ant init:workspace`

Initialize a new workspace (project root) under `ANT_WORKSPACE_BASE_PATH`.
Interactive — prompts for project name, domain, and repo type.

```bash
pnpm init:workspace
```

### `ant init:feature`

Add a new feature to an existing project. Interactive.

```bash
pnpm init:feature
```

### `ant index <feature>`

Re-index a feature's `codebase/` into the vector DB. Requires
`ANT_VECTOR_DB_ENABLED=true` and a running Chroma instance.

```bash
ant index myproject/myfeature
```

If the vector DB capability is disabled, the command short-circuits with
a no-op and a warning.

## Process entry points

These are not user-facing CLI commands but the binaries that ship in the
build output. They are referenced from Kubernetes Deployment manifests in
cloud mode.

| Binary                                       | Process     | Purpose                       |
|----------------------------------------------|-------------|-------------------------------|
| `node dist/composition/server.js`            | ant-api     | REST + IDE proxy              |
| `node dist/infrastructure/realtime/start-realtime-server.js` | ant-realtime | SSE streams |
| `node dist/infrastructure/worker/start-job-worker.js` | ant-job | BullMQ worker |
| `node dist/infrastructure/preview/start-preview-server.js` | ant-preview | Per-feature dev servers |

## pnpm scripts (development)

| Script                              | Purpose                              |
|-------------------------------------|--------------------------------------|
| `pnpm dev:infra`                    | Start Redis + ChromaDB (Docker)       |
| `pnpm dev:infra:down`               | Stop infra                           |
| `pnpm dev:api-server`               | Run ant-api only                     |
| `pnpm dev:realtime-server`          | Run ant-realtime only                |
| `pnpm dev:job-worker`               | Run ant-job only                     |
| `pnpm dev:preview-server`           | Run ant-preview only                 |
| `pnpm dev:ui`                       | Run the frontend dev server          |
| `pnpm dev:all`                | Run all 4 backend processes + UI + site |
| `pnpm dev:mock:all`                 | Same as above with LLM mock          |
| `pnpm build`                        | Build all packages (tests run first) |
| `pnpm typecheck`                    | Typecheck all packages               |
| `pnpm test:cli`                     | Run ant-cli vitest suite             |

## Read next

- [env-vars](env-vars.md) — environment variables reference.
- [api](api.md) — REST API surface.
- [internals/00-system-overview.md](../internals/00-system-overview.md) —
  process boot order and dependencies.
