# Self-hosting

This guide covers running Ant on your own infrastructure — from a single
laptop to a multi-tenant deployment. The runtime is identical across
environments; only the operator concerns differ.

If you only need a local dev setup, the [quickstart](../getting-started/quickstart.md)
is enough. Read on if you want to host Ant for a team.

## Deployment modes

| Mode                | When to use                                         | Where to run              |
|---------------------|-----------------------------------------------------|---------------------------|
| Local single-host   | Personal use, evaluation, demos                     | One machine, Docker infra |
| Single-tenant cloud | One team, your private infra                        | Single VM or one K8s ns   |
| Multi-tenant cloud  | Multiple teams, isolation between projects          | Kubernetes (production)   |

All three modes share the same code path. The difference is where Redis,
the workers, and the IDE pods live.

## Required infrastructure

Regardless of mode:

- **Redis** (or compatible — ElastiCache, Memorystore, Upstash). Ant uses
  Pub/Sub, KV, and BullMQ. TLS is supported.
- **Object/file storage for workspaces.** Local mode uses the host
  filesystem. Cloud mode typically uses a shared volume (EFS / NFS) so all
  worker replicas see the same workspace.
- **(Optional) Vector DB.** ChromaDB for code RAG. Disabled by default.

## Single-host mode

The simplest deployment. All four processes on one machine. Suitable for
team-of-one or evaluation.

```bash
git clone https://github.com/<org>/ant
cd ant
pnpm install

cp packages/ant-cli/.env.example.local packages/ant-cli/.env
# edit .env with your LLM key, encryption key, etc.

# Boot infra (Redis + ChromaDB)
pnpm dev:infra

# Boot all 4 processes + UI
pnpm dev:local:all
```

For a long-running deployment, use `pnpm start:local:all` (built artifacts)
behind a process manager like `pm2` or `systemd`.

### Reverse proxy

If you front Ant with nginx / Caddy / Traefik:

| Path                | Upstream     | Notes                                      |
|---------------------|--------------|--------------------------------------------|
| `/api/*`            | `:4100`      | REST                                       |
| `/realtime/*`       | `:4101`      | SSE (set `proxy_read_timeout 1d`)         |
| `/preview/*`        | `:4102`      | Per-feature dev servers                    |
| `/`                 | `:5173` (UI) | Or pre-built bundle from `packages/ant-ui/dist` |

Make sure to disable buffering on `/realtime/` and `/preview/` paths so
SSE chunks and HMR updates aren't held up.

### Backups

Two things to back up:

- `workspaces/` — generated artifacts, sessions, codebase.
- Redis — for in-flight job state. Snapshot with RDB or AOF.

## Multi-tenant cloud mode

For multi-team use, deploy each process as its own Kubernetes Deployment.
The full guide is in [cloud-deployment](cloud-deployment.md); the summary:

- `ant-api`, `ant-realtime`, `ant-preview` are stateless. Scale horizontally.
- `ant-job` is stateless too, but parallelism is bounded by
  `ANT_TASK_CONCURRENCY` per worker.
- IDE pods (per user, per project) are launched on demand by the
  `KubernetesIDEOrchestrator`. They mount the EFS workspace volume.
- Workspace base path is the EFS mount root; subpaths are per project /
  feature.
- Redis is ElastiCache or equivalent. TLS is supported (see
  [internals/02-infrastructure.md](../internals/02-infrastructure.md)).

## Environment variables you almost always set

| Var                        | Default     | Notes                                    |
|----------------------------|-------------|------------------------------------------|
| `ANT_SERVER_MODE`          | `local`     | `local` or `cloud`                       |
| `ANT_REDIS_URL`            | (Docker)    | Required in cloud mode                   |
| `ANT_ENCRYPTION_KEY`       | —           | 32+ byte random string                   |
| `ANT_ANTHROPIC_API_KEY`    | —           | Primary LLM provider                     |
| `ANT_OPENAI_API_KEY`       | —           | Optional fallback                        |
| `ANT_TASK_CONCURRENCY`     | `3`         | Parallel tasks per worker                |
| `ANT_WORKSPACE_BASE_PATH`  | `./workspaces` | Per-feature data lives here          |
| `ANT_VECTOR_DB_ENABLED`    | `false`     | Enable RAG (also start `dev:infra:vector`) |

Full list: [reference/env-vars.md](../reference/env-vars.md).

## Auth

Local mode uses a single `local:local` tenant — everything is owned by one
user. Cloud mode supports OAuth (provider configured per deployment).

The auth integration is intentionally minimal in this release. If you
need SAML / SCIM / fine-grained ACLs, you'll need to extend
`packages/ant-cli/src/infrastructure/auth/`. Contributions welcome.

## Hardening checklist for production

- [ ] Run behind a TLS-terminating reverse proxy.
- [ ] Set `ANT_ENCRYPTION_KEY` to a strong random value, store it in your
      secrets manager (AWS Secrets Manager, Vault, etc.).
- [ ] Rotate LLM provider API keys at least quarterly.
- [ ] Restrict ingress: only the UI origin and your own integrations
      should be able to reach `/api/`.
- [ ] Disable `/api/cloud-ide/*` if you are not using the Cloud IDE
      feature.
- [ ] Configure a Redis ACL — Ant uses well-known key prefixes
      (`ant:job:*`, `ant:state:*`, `ant:lifecycle:*`); restrict the auth
      user to those prefixes.
- [ ] Cap `ANT_TASK_CONCURRENCY` based on your LLM rate-limit budget.
- [ ] Subscribe to the security advisories for this repo (see
      [SECURITY.md](../../SECURITY.md)).

## Read next

- [cloud-deployment](cloud-deployment.md) — Kubernetes-specific guide.
- [observability](observability.md) — logging and metric strategy.
- [internals/02-infrastructure.md](../internals/02-infrastructure.md) —
  the SSOT for Redis keys, BullMQ queues, and process boot order.
