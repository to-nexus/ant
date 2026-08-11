/**
 * Tool handlers — pure fixture logic, no side effects, no persistence.
 * The zod layer (see server.ts inputSchema) rejects invalid arguments as
 * JSON-RPC -32602 before these run; handler-level refusals return
 * `isError: true` with one human-readable sentence.
 */

import type { IncidentStatus, Period, Severity } from './fixtures.js';
import { incidentsInWindow, SLA_QUALITY } from './fixtures.js';

const PAGE_SIZE = 20;
const PAYLOAD_BYTE_CAP = 8 * 1024;

export type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

function jsonResult(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

export function listIncidents(args: {
  since: '7d' | '30d';
  status?: IncidentStatus;
  page?: number;
}): ToolResult {
  const page = args.page ?? 1;
  const matching = incidentsInWindow(args.since).filter(
    (i) => !args.status || i.status === args.status,
  );
  const start = (page - 1) * PAGE_SIZE;
  let rows = matching.slice(start, start + PAGE_SIZE);

  // Serialized-size cap: drop tail rows rather than exceed ~8KB.
  let truncatedByCap = false;
  while (rows.length > 0 && JSON.stringify(rows).length > PAYLOAD_BYTE_CAP) {
    rows = rows.slice(0, -1);
    truncatedByCap = true;
  }

  return jsonResult({
    since: args.since,
    ...(args.status ? { status: args.status } : {}),
    page,
    page_size: PAGE_SIZE,
    total: matching.length,
    has_more: start + rows.length < matching.length || truncatedByCap,
    incidents: rows,
  });
}

export function getSlaMetrics(args: { period: Period }): ToolResult {
  const windowIncidents = incidentsInWindow(args.period);
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const i of windowIncidents) bySeverity[i.severity] += 1;

  const quality = SLA_QUALITY[args.period];
  return jsonResult({
    period: args.period,
    availability_pct: quality.availability_pct,
    mtta_minutes: quality.mtta_minutes,
    mttr_minutes: quality.mttr_minutes,
    incidents_total: windowIncidents.length,
    incidents_by_severity: bySeverity,
    slo_breaches: quality.slo_breaches,
  });
}

// In-process only — the whole point is that nothing persists. Module scope so
// HTTP mode's per-request McpServer instances still share one replay map.
const createdByIdempotencyKey = new Map<string, string>();
let nextIncidentNumber = 9001;

export function createIncident(args: {
  title: string;
  severity: Severity;
  idempotency_key: string;
  dry_run?: boolean;
}): ToolResult {
  const dryRun = args.dry_run ?? true;
  const replayedId = createdByIdempotencyKey.get(args.idempotency_key);
  const id = replayedId ?? `INC-${nextIncidentNumber++}`;
  if (!replayedId) createdByIdempotencyKey.set(args.idempotency_key, id);

  return jsonResult({
    id,
    title: args.title,
    severity: args.severity,
    status: 'open',
    dry_run: dryRun,
    replayed: replayedId !== undefined,
    note: dryRun
      ? 'dry run — nothing was persisted'
      : 'fixture server — accepted but nothing is persisted beyond this process',
  });
}

/**
 * Env-isolation probe: KEY NAMES ONLY, never values. What it proves is that a
 * stdio child sees exactly its declared `env` plus the exec baseline and none
 * of Ant's own secrets — and that claim is about which keys are present, so
 * returning the values would add no evidence and make this an exfiltration
 * tool. Do not "improve" it by dumping process.env.
 */
export function debugEnv(): ToolResult {
  return jsonResult({ env_keys: Object.keys(process.env).sort() });
}
