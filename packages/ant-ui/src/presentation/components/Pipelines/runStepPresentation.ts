/**
 * How a run's step reads on screen — ONE table for the status color, the
 * status label key, the live set, and the gate-decision label. The canvas
 * node, the timeline and the run row all used to carry their own copies
 * (two color maps, raw `status.replace(/_/g, ' ')` English, ad-hoc ✓/✗).
 */

import type { GateDecision, PipelineStepStatus } from '@ant/shared';

type T = (key: string, fallback: string, opts?: Record<string, unknown>) => string;

export const STEP_STATUS_COLOR: Record<PipelineStepStatus, string> = {
  pending: 'var(--text-3)',
  dispatched: 'var(--status-progress-fg)',
  running: 'var(--status-progress-fg)',
  awaiting_gate: 'var(--amber-500)',
  awaiting_clarify: 'var(--amber-500)',
  succeeded: 'var(--status-done-fg)',
  failed: 'var(--status-error-fg)',
  skipped: 'var(--text-3)',
  cancelled: 'var(--text-3)',
};

export const LIVE_STEP_STATUSES: ReadonlySet<PipelineStepStatus> = new Set<PipelineStepStatus>(['dispatched', 'running', 'awaiting_gate', 'awaiting_clarify']);

const STEP_STATUS_FALLBACK: Record<PipelineStepStatus, string> = {
  pending: 'Pending',
  dispatched: 'Dispatched',
  running: 'Running',
  awaiting_gate: 'Awaiting approval',
  awaiting_clarify: 'Awaiting answer',
  succeeded: 'Succeeded',
  failed: 'Failed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
};

export function stepStatusLabel(t: T, status: PipelineStepStatus): string {
  return t(`runs.step.${status}`, STEP_STATUS_FALLBACK[status] ?? status);
}

/** "✓ approved by a@x" / "⏱ auto-rejected" — the decision as one localized line. */
export function gateDecisionLabel(t: T, decision: GateDecision, decidedBy?: string): string {
  switch (decision) {
    case 'approved':
      return t('runs.decision.approved', '✓ approved by {{who}}', { who: decidedBy ?? t('runs.unknownActor', 'unknown') });
    case 'rejected':
      return t('runs.decision.rejected', '✗ rejected by {{who}}', { who: decidedBy ?? t('runs.unknownActor', 'unknown') });
    case 'expired_approve':
      return t('runs.decision.autoApproved', '⏱ auto-approved on timeout');
    case 'expired_reject':
    default:
      return t('runs.decision.autoRejected', '⏱ auto-rejected on timeout');
  }
}

export const isApprovedDecision = (d: GateDecision): boolean => d === 'approved' || d === 'expired_approve';
