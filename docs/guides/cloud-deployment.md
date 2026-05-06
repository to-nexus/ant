# Cloud deployment

Run Ant in production on Kubernetes. This guide is the operator-friendly
overview; the long-form, command-by-command runbook lives at
[`docs/infra/cloud-deployment-guide.md`](../infra/cloud-deployment-guide.md)
and is intended for DevOps teams executing the deployment.

For prerequisites and architecture concepts, read
[concepts/architecture.md](../concepts/architecture.md) first.

## What you'll deploy

Five Kubernetes Deployments and their supporting infrastructure:

| Deployment       | Replicas (typical) | Purpose                            |
|------------------|--------------------|------------------------------------|
| `ant-api`        | 2+                 | REST + IDE proxy, behind a Service |
| `ant-realtime`   | 2+                 | SSE for chat / workflow streams    |
| `ant-job`        | 2+                 | BullMQ workers spawning job-runner |
| `ant-preview`    | 2+                 | Per-feature dev-server lifecycle   |
| `ant-ui`         | 2+                 | The frontend SPA (or serve via CDN)|

Plus:

- **Redis** — ElastiCache (AWS), Memorystore (GCP), or any managed
  Redis 6+. TLS supported; set `ANT_REDIS_URL=rediss://...`.
- **EFS / persistent volume** — shared workspace storage. Each feature is
  a subpath. Mount the same volume into `ant-job`, `ant-preview`, and
  every IDE pod.
- **Object storage (optional)** — for backups of generated artifacts.
- **Egress to LLM providers** — Anthropic / OpenAI APIs.

## Deployment modes

Ant runs the same code in local and cloud. Cloud mode adds:

- **OAuth auth** — required (no `local:local` shortcut).
- **Kubernetes IDE pods** — the `KubernetesIDEOrchestrator` launches a
  per-user, per-project VSCode pod and proxies it through `ant-api`.
- **EFS workspace mounts** — workers and IDE pods share storage.
- **Distributed Redis** — every state read/write goes through it.

Set:

```
ANT_SERVER_MODE=cloud
ANT_REDIS_URL=rediss://your-redis-endpoint:6379
ANT_K8S_NAMESPACE=ant
ANT_WORKSPACE_BASE_PATH=/efs-mount/workspaces
ANT_PREVIEW_WORKERS=http://ant-preview.ant.svc:4102
```

## Reading the runbook

The full runbook ([`docs/infra/cloud-deployment-guide.md`](../infra/cloud-deployment-guide.md))
covers:

- IAM roles and ServiceAccount mapping.
- EKS cluster requirements (recommended Node groups, EFS CSI driver).
- Helm values per Deployment.
- TLS handling for ElastiCache with custom CNAME.
- Pod lifecycle: how the orchestrator handles `Terminating` and `Failed`
  states.
- Per-tenant resource limits and namespace strategy.

If you're following the runbook end-to-end, work through it section by
section. If you're auditing an existing deployment, start at section 4
(Networking) and section 7 (Security).

## Multi-origin frontend

If you need the UI served from a separate origin (e.g. CDN-hosted bundle
talking to a backend on a different domain), see
[`docs/infra/cloudfront-multi-origin-guide.md`](../infra/cloudfront-multi-origin-guide.md)
for CORS, cookie, and CSP configuration.

## Operational checklists

### Pre-launch

- [ ] Reverse proxy disables buffering on `/realtime/*` and `/preview/*`.
- [ ] Redis ACL restricts the Ant user to known key prefixes (`ant:*`).
- [ ] EFS mount targets exist in every AZ that runs workers.
- [ ] LLM provider keys live in Kubernetes Secrets, not ConfigMaps.
- [ ] `ANT_ENCRYPTION_KEY` is unique per environment.
- [ ] CSP allows the Anthropic / OpenAI API origins for any in-browser
      tooling that uses them.

### Day-2

- [ ] Alert on BullMQ queue depth > N (jobs piling up means workers can't
      keep up).
- [ ] Alert on Redis memory pressure.
- [ ] Alert on `ant-api` 5xx rate.
- [ ] Periodic chaos check: kill a random worker pod and verify jobs
      retry from their checkpoints.
- [ ] Periodic restore test from your Redis + EFS backups.

## Troubleshooting

The most common cloud-only issues:

- **"Project already exists" 409 after delete** — see
  [getting-started/troubleshooting.md § "Project already exists"](../getting-started/troubleshooting.md#project-already-exists-on-createproject).
- **TLS verification errors on Redis** — handled in `RedisStateStore` for
  ElastiCache + custom CNAME. See `internals/02-infrastructure.md`.
- **IDE pod hangs in `Terminating`** — the orchestrator polls
  `deletionTimestamp`; usually resolves in 60s. If not, restart `ant-api`.

## Read next

- [`docs/infra/cloud-deployment-guide.md`](../infra/cloud-deployment-guide.md)
  — full runbook.
- [`docs/infra/cloudfront-multi-origin-guide.md`](../infra/cloudfront-multi-origin-guide.md)
  — multi-origin frontend.
- [observability](observability.md) — logging and metrics.
- [internals/23-cloud-ide.md](../internals/23-cloud-ide.md) — Cloud IDE
  internals.
