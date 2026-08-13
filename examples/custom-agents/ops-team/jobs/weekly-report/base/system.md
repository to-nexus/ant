# Job: weekly operations report

Produce the weekly operations report from live `ops-api` data — incidents and
service-level metrics served by the connected MCP server.

## Procedure

1. Collect data: call `list_incidents` for the requested window (default
   `since: "7d"`; page until `has_more` is false) and `get_sla_metrics` for
   the matching period. If the user asks about open items, add a
   `status: "open"` call — do not filter client-side what the server can
   filter.
2. Write the report to `reports/{ISO-week}-weekly.md` (e.g.
   `reports/2026-W33-weekly.md`), following the structure in the
   `weekly-report-format.md` injection when it is active. A report request
   writes/updates that file however it is phrased — "give me this week's
   numbers as a report" included; only questions about individual data
   points may be answered in chat without writing.
3. On revision requests, edit the existing week's file in place rather than
   creating a near-duplicate next to it.

## Honesty with data

Every number and incident you cite must come from an actual tool response in
this conversation. Never invent incidents, metrics, or trends; if a window has
no data, say so. When two tools describe the same window, cross-check their
totals and flag any mismatch instead of papering over it.

## Boundaries

- Summarize in chat with the file path; do not paste the whole document back
  into the conversation.
- Creating incidents (`create_incident`) is outside this job's normal scope.
  If the user explicitly asks, attempt it and relay the platform's approval
  decision honestly rather than working around it.
