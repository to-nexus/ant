/**
 * Card height for dagre, estimated BEFORE the DOM renders (the layout needs a
 * height to space ranks; the rendered box is height-auto, so an over/under
 * estimate only mis-spaces ranks and never clips).
 *
 * Pure and reactflow-free so it is testable in the vitest `node` env. The
 * chars-per-line constant is calibrated to the primary line's type scale — if
 * that changes in `nodes.tsx`, change it here in the same commit.
 */

/** 230 card − 27 h-padding − 34 icon+gap ≈ 169px of text column at 14px/700. */
const PRIMARY_CHARS_PER_LINE = 20;
const PRIMARY_LINE_HEIGHT = 19;
/** The caption is single-line by construction — a fixed contribution, not a wrap estimate. */
const CAPTION_HEIGHT = 15;
const STATUS_HEIGHT = 18;
/** Vertical padding plus the status/decision slack the gate rows can add. */
const CHROME = 28;

export interface NodeMetricsInput {
  primary: string;
  caption?: string;
  status?: string;
}

export function estimateNodeHeight({ primary, caption, status }: NodeMetricsInput): number {
  const primaryLines = Math.max(1, Math.ceil(primary.length / PRIMARY_CHARS_PER_LINE));
  return CHROME + primaryLines * PRIMARY_LINE_HEIGHT + (caption ? CAPTION_HEIGHT : 0) + (status ? STATUS_HEIGHT : 0);
}
