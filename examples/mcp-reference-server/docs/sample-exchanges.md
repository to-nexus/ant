# Sample exchanges

Real request/response transcripts captured against this server (HTTP mode,
2026-08-11, `scripts/smoke.sh` + manual calls). Fixtures are deterministic, so
replaying any request returns byte-identical data. Requests need three
headers: `Authorization: Bearer <token>`, `Content-Type: application/json`,
`Accept: application/json, text/event-stream`.

## 1. Weekly triage read

*An Ant job collecting its incident table for a weekly report.*

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_incidents","arguments":{"since":"7d"}}}
```

```json
{
  "since": "7d", "page": 1, "page_size": 20, "total": 4, "has_more": false,
  "incidents": [
    { "id": "INC-1012", "title": "Elevated 5xx on checkout-api after deploy 2026-08-04",
      "severity": "critical", "status": "resolved", "service": "checkout-api",
      "opened_at": "2026-08-04T02:11:00Z", "acknowledged_at": "2026-08-04T02:19:00Z",
      "resolved_at": "2026-08-04T04:40:00Z" },
    { "id": "INC-1013", "title": "Payment gateway settlement file import failing",
      "severity": "high", "status": "open", "service": "payment-gateway",
      "opened_at": "2026-08-05T07:54:00Z", "acknowledged_at": "2026-08-05T08:03:00Z" },
    { "id": "INC-1014", "title": "Push notification fan-out lag for large segments",
      "severity": "medium", "status": "acknowledged", "service": "notification-worker",
      "opened_at": "2026-08-07T11:26:00Z", "acknowledged_at": "2026-08-07T11:58:00Z" },
    { "id": "INC-1015", "title": "Search index nightly rebuild finished 40 minutes late",
      "severity": "low", "status": "resolved", "service": "search-index",
      "opened_at": "2026-08-09T05:12:00Z", "acknowledged_at": "2026-08-09T05:40:00Z",
      "resolved_at": "2026-08-09T06:35:00Z" }
  ]
}
```

## 2. Filtered follow-up

*The same job drilling into what is still open this month.*

```json
{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"list_incidents","arguments":{"since":"30d","status":"open"}}}
```

```json
{
  "since": "30d", "status": "open", "page": 1, "page_size": 20,
  "total": 2, "has_more": false,
  "incidents": [
    { "id": "INC-1011", "title": "Sporadic 401s from session validation under load",
      "severity": "high", "status": "open", "service": "auth-service",
      "opened_at": "2026-08-01T09:36:00Z", "acknowledged_at": "2026-08-01T09:48:00Z" },
    { "id": "INC-1013", "title": "Payment gateway settlement file import failing",
      "severity": "high", "status": "open", "service": "payment-gateway",
      "opened_at": "2026-08-05T07:54:00Z", "acknowledged_at": "2026-08-05T08:03:00Z" }
  ]
}
```

## 3. SLA summary

*The report's metrics section. `incidents_total: 9` equals what
`list_incidents {"since":"30d"}` returns — the two tools can never disagree.*

```json
{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"get_sla_metrics","arguments":{"period":"30d"}}}
```

```json
{
  "period": "30d", "availability_pct": 99.87,
  "mtta_minutes": 9, "mttr_minutes": 74, "incidents_total": 9,
  "incidents_by_severity": { "critical": 1, "high": 3, "medium": 3, "low": 2 },
  "slo_breaches": [
    { "slo": "checkout-api availability", "target": 99.95, "actual": 99.91, "breached": true },
    { "slo": "payment-gateway p95 latency < 800ms", "target": 99, "actual": 99.4, "breached": false }
  ]
}
```

## 4. Guarded write — first call

*A job filing a follow-up incident. In Ant this tool has no `readOnlyHint`,
so the call is refused (fail-closed) until the job declares
`approval: { "mcp__<server>__create_incident": never }`. The server-side
guards below are what make that declaration safe.*

```json
{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"create_incident","arguments":{"title":"Test incident from weekly review","severity":"high","idempotency_key":"wr-2026-08-10-a1"}}}
```

```json
{
  "id": "INC-9001", "title": "Test incident from weekly review",
  "severity": "high", "status": "open",
  "dry_run": true, "replayed": false,
  "note": "dry run — nothing was persisted"
}
```

## 5. Idempotent replay

*The exact same call again (retry, duplicate schedule fire, …) — same id,
`replayed: true`, still nothing persisted.*

```json
{
  "id": "INC-9001", "title": "Test incident from weekly review",
  "severity": "high", "status": "open",
  "dry_run": true, "replayed": true,
  "note": "dry run — nothing was persisted"
}
```

## Failure samples — guards are machine-enforced, not prose

Invalid enum (`since` only accepts `7d|30d`):

```json
{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"list_incidents","arguments":{"since":"90d"}}}
```

```json
{"result":{"content":[{"type":"text","text":"MCP error -32602: Input validation error: Invalid arguments for tool list_incidents: Invalid option: expected one of \"7d\"|\"30d\" at since"}],"isError":true},"jsonrpc":"2.0","id":14}
```

Idempotency key shorter than 8 chars:

```json
{"result":{"content":[{"type":"text","text":"MCP error -32602: Input validation error: Invalid arguments for tool create_incident: Too small: expected string to have >=8 characters at idempotency_key"}],"isError":true},"jsonrpc":"2.0","id":15}
```

Transport-level negatives (HTTP): missing `Authorization` → **401**, missing
`Accept: application/json, text/event-stream` → **406**, `GET /mcp` → **405**.
