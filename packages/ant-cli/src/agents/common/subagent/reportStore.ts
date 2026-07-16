/**
 * Full-report store — process-local runtime state.
 *
 * When a child's report exceeds the inline budget, the complete text is kept
 * here so the parent LLM can drill down via the `subagent_report` tool
 * (decompaction counterpart of compactReport.ts). Like registry.ts /
 * composition/jobAbort.ts these are non-serializable runtime handles, NOT a
 * mirror of Redis-owned SSOT state: the store dying with the process is by
 * design (the tool answers with a graceful miss and exploration is cheap to
 * re-issue). The bounded FIFO is the leak guard — deliberately NOT wired into
 * registry.clearOwner, so a just-finished task's report stays drillable from
 * the next drain site.
 */

import { subagentMaxReportChars, subagentMaxReportPersistChars } from './config';

const MAX_STORED = 30;

interface StoredReport {
  goal: string;
  full: string;
}

const reports = new Map<string, StoredReport>();

export function storeFullReport(id: string, goal: string, full: string): void {
  if (reports.has(id)) reports.delete(id); // re-insert refreshes FIFO position
  reports.set(id, { goal, full: full.slice(0, subagentMaxReportPersistChars()) });
  while (reports.size > MAX_STORED) {
    const oldest = reports.keys().next().value;
    if (oldest === undefined) break;
    reports.delete(oldest);
  }
}

export interface ReportSlice {
  goal: string;
  slice: string;
  offset: number;
  total: number;
}

export function readFullReport(
  id: string,
  offset = 0,
  maxChars = subagentMaxReportChars(),
): ReportSlice | undefined {
  const stored = reports.get(id);
  if (!stored) return undefined;
  const total = stored.full.length;
  const start = Math.max(0, Math.min(offset, total));
  const cap = Math.max(1, maxChars);
  return { goal: stored.goal, slice: stored.full.slice(start, start + cap), offset: start, total };
}

/** Test helper. */
export function clearAllReports(): void {
  reports.clear();
}
