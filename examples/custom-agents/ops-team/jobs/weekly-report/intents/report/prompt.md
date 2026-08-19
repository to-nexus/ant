# Weekly report format

Structure `reports/{ISO-week}-weekly.md` as:

1. **Title + window** — "Weekly Operations Report — {ISO week} ({start} ~ {end})".
2. **Summary** — 3–5 sentences: overall availability, the most severe
   incident, anything still open.
3. **SLA metrics** — table: availability %, MTTA, MTTR, incident total;
   then SLO breaches (only rows with `breached: true`, or "none").
4. **Incidents** — table sorted by severity then opened_at: id, title,
   service, severity, status, opened_at. Open/acknowledged rows get a
   trailing "⚠ still open" marker.
5. **Follow-ups** — bullet list derived ONLY from open/acknowledged
   incidents and breached SLOs.

Keep prose factual and terse; every number traces to a tool response from
this conversation.
