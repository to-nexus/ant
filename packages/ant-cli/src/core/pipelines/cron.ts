/**
 * Cron parsing SSOT — the same `cron-parser` major BullMQ's Job Scheduler
 * uses internally, so the preview (`getNextFires`) and the actual firing
 * cannot drift. The FE never parses cron; it round-trips `preview-fires`.
 * @ant/shared stays dependency-free by doctrine, which is why this lives
 * server-side and not next to `validatePipelineDef`.
 */

import { parseExpression } from 'cron-parser';
import { DEFAULT_PIPELINE_CAPS } from '@ant/shared';

export interface CronParseResult {
  ok: boolean;
  error?: string;
  /** ISO timestamps of the next `n` fires. */
  nextFires: string[];
}

/**
 * Parse + preview. Returns `ok: false` with a human-readable error for a
 * malformed expression or timezone — callers map it to 400 / form-disable.
 */
export function getNextFires(cron: string, tz: string | undefined, n: number, from: Date = new Date()): CronParseResult {
  try {
    const it = parseExpression(cron, { currentDate: from, ...(tz ? { tz } : {}) });
    const nextFires: string[] = [];
    for (let i = 0; i < n; i += 1) {
      nextFires.push(it.next().toDate().toISOString());
    }
    return { ok: true, nextFires };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), nextFires: [] };
  }
}

/**
 * Minimum-interval cap check: sample the next 10 fires and require every gap
 * to respect the cap. Sampling (vs field analysis) is deliberate — it judges
 * the expression by what it actually does. Returns an error message or null.
 */
export function checkMinInterval(
  cron: string,
  tz: string | undefined,
  minMinutes: number = DEFAULT_PIPELINE_CAPS.minCronIntervalMinutes,
): string | null {
  const preview = getNextFires(cron, tz, 10);
  if (!preview.ok) return preview.error ?? 'invalid cron expression';
  const times = preview.nextFires.map((iso) => Date.parse(iso));
  for (let i = 1; i < times.length; i += 1) {
    const gapMinutes = (times[i] - times[i - 1]) / 60_000;
    if (gapMinutes < minMinutes) {
      return `cron fires more often than every ${minMinutes} minutes (observed gap: ${Math.round(gapMinutes)}m)`;
    }
  }
  return null;
}
