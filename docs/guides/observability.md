# Observability

How to see what Ant is doing — in production and during development.

For the deep dive on debug-artifact retention, see
[internals/29-debug-logging.md](../internals/29-debug-logging.md).

## Layers

Ant has three observability surfaces:

| Surface          | Audience      | Where                                              |
|------------------|---------------|----------------------------------------------------|
| Console logs     | Operators     | Process stdout (`ant-api`, `ant-job`, etc.)        |
| Realtime stream  | End users     | UI's chat + workflow panels (SSE)                  |
| Debug artifacts  | Contributors  | `sessions/<agent>/debug/` per feature              |

## Console logs

Every process writes structured-ish JSON / prefixed strings to stdout.
Conventions:

- **Emoji prefixes** for grep-ability:
  `🚀 [JobWorker]`, `📄 [DocGen]`, `🔧 [Tool]`, `⚙️ [Orchestrator]`,
  `🚪 [PreviewServer]`.
- **Job lifecycle** events log with the job id. Filter with
  `rg "<jobId>"` to follow one job across processes.
- **Failures** log the full stack on first emission and a short marker
  on retries.

Recommended log shippers:

- Local: `pnpm dev:all` already concurrent-prefixes the streams.
- Cloud: ship to Loki / CloudWatch / Datadog. The structured fields
  (job id, project, feature, agent) are stable.

## Realtime stream

The frontend subscribes to two SSE channels:

- `chat:tokens:<feature>` — LLM token stream as the agent generates.
- `workflow:<feature>` — phase / node lifecycle events (entered, exited,
  errored).

Both are also useful debugging tools when curl'd directly:

```bash
# Tokens
curl -N "http://localhost:4101/realtime/chat?featureId=<id>"

# Workflow events
curl -N "http://localhost:4101/realtime/workflow?featureId=<id>"
```

(Auth headers required in cloud mode.)

## Debug artifacts

For every job run, the agent persists:

- The rendered system + user prompts (`debug/prompts/`).
- The generated plan output (`debug/plans/`).
- LLM call logs (`debug/logs/`).
- Token usage tally (`debug/tokens/`).
- Figma MCP responses, when applicable (`debug/figma/`).

These live under `workspaces/<project>/<feature>/sessions/<agent>/debug/`.

### Retention policy

Debug artifacts are pruned automatically. The retention sweeper
(`core/utils/debugRetention.ts`) runs every 60s on a tick and:

- Cuts files older than **14 days**.
- Caps each subdirectory at **50 entries**.
- Protects active jobs (a 3-source union: live sessions, Redis-known
  in-flight jobs, files modified within the last hour).

You can keep specific runs by moving the directory out of the
`debug/` subtree.

## Token accounting

Ant tracks token usage per provider, per agent, per phase. Look in
`debug/tokens/` for per-job tallies; the aggregation strategy is in
[internals/35-token-usage-tracking.md](../internals/35-token-usage-tracking.md).

If you bring your own dashboard, the canonical fields are:

- `provider` (`anthropic` / `openai`)
- `model`
- `promptTokens` / `completionTokens` / `totalTokens`
- `phase` (`triage`, `decompose`, `plan`, `execute`, `check`, ...)
- `agent` / `jobId` / `featureId`

## Metrics (recommended for production)

Ant doesn't ship a metrics emitter today (Phase 5+ roadmap). Recommended
DIY:

- **BullMQ queue depth** — Redis `LLEN` on the job queue.
- **Active jobs** — Redis `SCARD` on `ant:state:active`.
- **Worker LLM latency** — wrap LLM calls in a histogram in
  `periphery/adapters/llm/`.
- **Preview server count** — Redis `SCARD` on the preview registry.

Pull requests adding a Prometheus emitter are welcome — see
[CONTRIBUTING.md](../../CONTRIBUTING.md).

## Tracing (recommended for production)

OpenTelemetry-friendly hook points:

- HTTP middleware in `periphery/adapters/http/middleware/`.
- LLM adapter `call()` methods.
- Tool handler `execute()` methods.

The current build doesn't auto-instrument, but the surfaces are stable.

## Read next

- [internals/29-debug-logging.md](../internals/29-debug-logging.md) —
  retention SSOT and active-job protection.
- [internals/35-token-usage-tracking.md](../internals/35-token-usage-tracking.md) —
  token accounting model.
- [internals/21-realtime-system.md](../internals/21-realtime-system.md) —
  SSE channel layout.
