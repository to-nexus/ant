/**
 * Live-run overlay on the ONE canvas — pure derivations the canvas paints.
 * The wiring is drawn once; each step node lists the live runs currently AT
 * that step as chips, the trigger node carries only a live count (N copies of
 * the workflow would read as "the trigger fires N times"), and the selected
 * run's path is highlighted. reactflow-free so it is testable in the `node` env.
 */

import { isApprovalStep, type PipelineDef, type PipelineLiveRun, type PipelineStepStatus, type RunRecord } from '@ant/shared';
import { TRIGGER_NODE_ID, effectiveNeedsOf } from '../draft';
import { runHue, runLabel } from '../runIdentity';

export type RunDetailOf = (runId: string) => Pick<RunRecord, 'steps'> | undefined;

export interface RunChip {
  runId: string;
  label: string;
  hue: number;
  status: PipelineStepStatus;
  /** Gate steps: who this run's gate is routed to (from the held detail). */
  assignees?: string[];
}

/**
 * Chips per step: a live run contributes one chip to each step in its
 * `currentStepIds`. The chip's status is the run's own step record when its
 * detail is held; otherwise the run-level state is the best available word
 * (an awaiting run parked on a gate is awaiting the gate).
 */
export function stepRunChips(def: PipelineDef, liveRuns: readonly PipelineLiveRun[], detailOf: RunDetailOf): Record<string, RunChip[]> {
  const gateIds = new Set(def.steps.filter(isApprovalStep).map((s) => s.id));
  const out: Record<string, RunChip[]> = {};
  for (const run of liveRuns) {
    const detail = detailOf(run.runId);
    for (const stepId of run.currentStepIds) {
      const record = detail?.steps.find((s) => s.stepId === stepId);
      const recorded = record?.status;
      const status: PipelineStepStatus =
        recorded ?? (run.status === 'awaiting_human' ? (gateIds.has(stepId) ? 'awaiting_gate' : 'awaiting_clarify') : 'running');
      const assignees = record?.gate?.assignees;
      (out[stepId] ??= []).push({ runId: run.runId, label: runLabel(run), hue: runHue(run.runId), status, ...(assignees && assignees.length > 0 && { assignees }) });
    }
  }
  return out;
}

/** The trigger node says only how many runs are live. */
export function triggerBadge(liveRuns: readonly PipelineLiveRun[]): { count: number } {
  return { count: liveRuns.length };
}

/**
 * Edge ids (`source->target`, the canvas seed id) the selected run has
 * traversed: an edge counts once its target step left `pending`. Empty when
 * no run is selected or its detail is not held yet.
 */
export function selectedPath(def: PipelineDef, run: Pick<RunRecord, 'steps'> | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!run) return out;
  const statusOf = new Map(run.steps.map((s) => [s.stepId, s.status]));
  def.steps.forEach((step, index) => {
    const status = statusOf.get(step.id);
    if (!status || status === 'pending') return;
    const needs = effectiveNeedsOf(def, index);
    for (const source of needs.length > 0 ? needs : [TRIGGER_NODE_ID]) out.add(`${source}->${step.id}`);
  });
  return out;
}

/**
 * Which run's detail drives the per-node status border / gate decision: the
 * selected run when it is live, else the newest live run — the one-run picture
 * is unchanged from today.
 */
export function focusRunId(liveRuns: readonly PipelineLiveRun[], selectedRunId: string | null | undefined): string | undefined {
  if (selectedRunId && liveRuns.some((r) => r.runId === selectedRunId)) return selectedRunId;
  return liveRuns[0]?.runId;
}
