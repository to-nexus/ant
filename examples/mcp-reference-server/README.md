# mcp-reference-server

Reference MCP server for Ant custom agents — a fixture-only incident/SLA API
for a fictional ops team. Departments copy this directory, keep the
transport/auth/logging shell, and replace the tools + fixtures with their own
API. The matching Ant agent definitions are its sibling,
[`../custom-agents/ops-team/`](../custom-agents/ops-team/).

**No real backend, no side effects.** Every response is served from
deterministic fixtures pinned to `2026-08-10` (`src/fixtures.ts`); the one
write-shaped tool (`create_incident`) echoes without persisting.

## Tools

| Tool | Input | Approval axis |
|---|---|---|
| `list_incidents` | `since: 7d\|30d`, `status?`, `page?` (≤20 rows/page, ~8KB cap) | `readOnlyHint: true` |
| `get_sla_metrics` | `period: 7d\|30d\|90d` | `readOnlyHint: true` |
| `create_incident` | `title`, `severity`, `idempotency_key(≥8)`, `dry_run?=true` | **no annotations — Ant fail-closes** until the job declares `approval: never` |
| `debug_env` | — (registered only when `SKELETON_DEBUG_ENV=1`) | `readOnlyHint: true` |

Argument violations are rejected by the SDK's zod layer as JSON-RPC `-32602`;
handler refusals return `isError: true` with one human-readable sentence.

`debug_env` returns environment variable **names only, never values** — it
exists to prove a stdio child sees exactly its declared `env` and none of Ant's
own secrets, and that claim is about which keys are present.

## Run

```bash
pnpm install                       # at the repo root — this is a workspace member
pnpm --filter @ant/example-mcp-reference build

cd examples/mcp-reference-server

# HTTP (refuses to start without MCP_AUTH_TOKEN)
cp .env.example .env               # set MCP_AUTH_TOKEN
pnpm start                         # POST /mcp (Bearer auth) · GET /healthz · GET/DELETE /mcp → 405

# stdio (no auth — the spawning process is the trust boundary)
pnpm start:stdio
```

Smoke test a running HTTP server:

```bash
MCP_AUTH_TOKEN=<token> pnpm smoke
```

## Connect it to Ant

1. Copy `../custom-agents/ops-team/` into your account root
   (`{workspaces}/{org}/{user}/.ant/agents/`).
2. Register the credential its `weekly-report` job references — the stored
   value must be the full `Bearer <token>` string matching `MCP_AUTH_TOKEN`:
   ```bash
   curl -X PUT .../api/account/mcp-credentials \
     -H 'content-type: application/json' \
     -d '{"key":"OPS_API_TOKEN","value":"Bearer <token>"}'
   ```
   Settings → Agents has the same panel.
3. Open a `universal` project and run `ops-team` / `weekly-report`.

Full walkthrough: [custom-agent-authoring.md](../../docs/guides/custom-agent-authoring.md).

## Department copy checklist

1. Copy this directory out of the Ant repo into your own, then drop the
   `@ant/` scope from `package.json` and add a lockfile.
2. Replace `src/fixtures.ts` + `src/tools.ts` with your domain, register your
   tools in `src/server.ts` — **`registerTool` only**, `inputSchema` as a flat
   ZodRawShape, enums over free strings, verbs for names.
3. Keep `readOnlyHint: true` on genuinely read-only tools ONLY. A tool that
   writes must carry no annotations (Ant then requires explicit approval).
4. Write tools need machine guards, not prose: idempotency key, `dry_run`
   defaulting to true, server-side limits.
5. Keep the shell: per-request server+transport in `http.ts` (SDK 1.30 throws
   on stateless reuse), `handleRequest(req, res, req.body)` third argument,
   timingSafeEqual bearer auth, stderr-only logging in stdio mode.
6. Update the agent definitions to point at your server and describe your job.

## Layout

```
src/
├── index.ts      # --stdio flag branch
├── config.ts     # env parsing + DEFAULT_PORT; HTTP mode requires MCP_AUTH_TOKEN
├── server.ts     # buildServer(): registerTool ×4 — the part you replace
├── tools.ts      # handlers (fixture-based)
├── fixtures.ts   # deterministic dataset (no Date.now())
├── http.ts       # express: auth + per-request stateless transport
├── stdio.ts      # single long-lived server, stderr logging
├── auth.ts       # timingSafeEqual bearer comparison
└── log.ts        # JSON-line logger {ts, evt, ...}
scripts/smoke.sh  # initialize + tools/list + tools/call + negatives
docs/sample-exchanges.md  # real request/response transcripts
```

Port `8931` is the `DEFAULT_PORT` constant in `src/config.ts`; `PORT` overrides
it. The `url` in the sibling job.yaml repeats the literal because yaml has no
interpolation — change both together.
