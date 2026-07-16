/**
 * Cheap deterministic gate between a child's final text and the parent
 * conversation. A model that loses the tool channel (round exhaustion) can
 * degenerate into repetition loops ("Let me also check X." × 1000, truncated
 * at the token cap); injecting that as a "report" pollutes the parent context
 * and has crashed decompose downstream. The heuristic is conservative —
 * legitimate reports (even list-heavy ones) have far more distinct content.
 */

export interface ReportViability {
  degenerate: boolean;
  /** distinct/total unit ratio for the dominant axis (diagnostics). */
  distinctRatio: number;
  totalUnits: number;
}

/** Only flag when there is enough material to judge (short reports never trip). */
const MIN_UNITS = 50;
/** Distinct-unit ratio below this = repetition loop. Incident measured 10/1015 ≈ 0.01. */
const MAX_DISTINCT_RATIO = 0.2;

function ratioFor(units: string[]): { ratio: number; total: number } {
  const cleaned = units.map((u) => u.trim()).filter((u) => u.length > 0);
  if (cleaned.length === 0) return { ratio: 1, total: 0 };
  return { ratio: new Set(cleaned).size / cleaned.length, total: cleaned.length };
}

export function assessReportViability(report: string): ReportViability {
  // Two unit axes: sentence-split catches single-paragraph loops, line-split
  // catches line-repetition loops. Judge on whichever axis has more units.
  const sentences = ratioFor(report.split(/(?<=[.!?])\s+/));
  const lines = ratioFor(report.split(/\n+/));
  const dominant = sentences.total >= lines.total ? sentences : lines;
  return {
    degenerate: dominant.total >= MIN_UNITS && dominant.ratio < MAX_DISTINCT_RATIO,
    distinctRatio: dominant.ratio,
    totalUnits: dominant.total,
  };
}
