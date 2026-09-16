/**
 * Run identity on screen — ONE owner of how a live run is named, colored and
 * attributed everywhere it appears (canvas chips, execution-view rows, chat
 * chips, the run dock, inbox rows, banner). The vocabulary is Run: N live
 * runs of one activation are what an operator would call workers, and the
 * code never says worker here (`workerId` / `workerScope` are the code job's
 * intra-job lanes).
 */

import { Clock, GitBranch, Inbox, Play, type LucideIcon } from 'lucide-react';
import type { PipelineFiredBy } from '@ant/shared';

/** The case label when the trigger carries one (fetch), else the run id. */
export function runLabel(run: { runId: string; itemKey?: string }): string {
  return run.itemKey ?? run.runId;
}

/** Exhaustive over `PipelineFiredBy` — a new trigger kind fails to compile here. */
export const FIRED_BY_ICON: Record<PipelineFiredBy, LucideIcon> = {
  cron: Clock,
  manual: Play,
  event: GitBranch,
  fetch: Inbox,
};

/** `runs.*` keys already used by the run history rows — one label per trigger kind. */
export const FIRED_BY_LABEL: Record<PipelineFiredBy, { key: string; fallback: string }> = {
  cron: { key: 'runs.cron', fallback: 'Scheduled' },
  manual: { key: 'runs.manual', fallback: 'Manual' },
  event: { key: 'runs.event', fallback: 'Chained' },
  fetch: { key: 'runs.fetch', fallback: 'Fetched' },
};

/** Distinct, theme-safe hues (WorkerGroup precedent) — a run keeps its hue for life. */
const RUN_HUES = [262, 168, 32, 205, 330, 88, 15, 240];

/** Stable per-run hue from the run id — the same run is the same color on every surface. */
export function runHue(runId: string): number {
  let h = 0;
  for (let i = 0; i < runId.length; i++) h = (h * 31 + runId.charCodeAt(i)) >>> 0;
  return RUN_HUES[h % RUN_HUES.length];
}

export function runTintFg(hue: number): string {
  return `oklch(56% 0.20 ${hue})`;
}
export function runTintBg(hue: number): string {
  return `oklch(from var(--bg-surface-2) calc(l - 0.01) max(c, 0.025) ${hue})`;
}
