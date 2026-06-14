import type { TaskType, TaskBand } from '@ant/shared';
import { windowFor, type PriorityWindow } from './state';

/**
 * Single source for the LLM-facing priority band guide.
 *
 * The numeric ranges are rendered from the `TASK_PRIORITY` map (the SSOT), so
 * the decompose prompt, this guide, and the regression test all read the same
 * numbers — no hand-copied band table can drift. Only the per-row semantic
 * label (what the band MEANS) lives here as prose; it is type/band-keyed and
 * stack-neutral (FPOP).
 *
 * Consumed by `decompose/variants/default/base.md` via the
 * `{{{priorityBandGuide}}}` variable.
 */

interface BandRow {
  readonly type: Exclude<TaskType, 'explain'>;
  readonly band?: TaskBand;
  readonly label: string;
}

// Ordered by ascending priority window (queue order). Each row's numbers come
// from `windowFor(type, band)`; the label is the band's meaning.
const BAND_ROWS: readonly BandRow[] = [
  { type: 'setup', band: 'root', label: 'setup (root — project / framework / workspace level)' },
  { type: 'setup', label: 'setup (package level)' },
  { type: 'design-system', label: 'design-system (TYPE — token / style infra at base, shared components above)' },
  { type: 'feature', band: 'foundation', label: 'feature (foundation band — shared types / interfaces / pure contracts)' },
  { type: 'feature', band: 'platform', label: 'feature (platform band — shared runtime services consumed by many features, per runtime)' },
  { type: 'feature', label: 'feature (ordinary)' },
  { type: 'feature', band: 'integration', label: 'feature (integration — wire parallel outputs into shared entry points)' },
  { type: 'ui', label: 'ui (visual implementation pass)' },
  { type: 'seam', label: 'seam (cross-feature reference + affordance closure, one per ref-emitting module — runs AFTER ui)' },
  { type: 'test-code', label: 'test-code (after all features + ui + seam)' },
  { type: 'doc', label: 'doc (after all features and tests)' },
  { type: 'error', label: 'error (fixes)' },
  { type: 'verification', label: 'verification (always last)' },
];

function renderRange(w: PriorityWindow): string {
  return w.min === w.max ? `${w.min}` : `${w.min}–${w.max}`;
}

/**
 * The canonical priority band guide as a markdown bullet list, numbers sourced
 * from `TASK_PRIORITY`. `priority` is purely the queue ordering key (lower =
 * earlier); `type` is the SSOT for scheduling lanes.
 */
export function renderPriorityBandGuide(): string {
  return BAND_ROWS.map(
    (row) => `- ${renderRange(windowFor(row.type, row.band))}: ${row.label}`,
  ).join('\n');
}
