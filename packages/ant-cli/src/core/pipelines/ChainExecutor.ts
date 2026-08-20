/**
 * ChainExecutor — the pure DAG-advance function. No I/O, no Redis, no clock:
 * `(frozen def, run state) → (new run state, dispatches)`. The coordinator
 * owns every side effect (dispatch, gate arm, JSONL, projections) and calls
 * this under the per-run lock. Table-tested in isolation.
 *
 * Semantics:
 * - Implicit edges: a step without `needs` depends on the previous step in
 *   file order (the first step is a root).
 * - A step becomes READY when every need is terminal. Its `on` condition then
 *   judges the needs' outcomes: `success` (default) requires ALL succeeded;
 *   `failure` requires at least one failed; `always` runs regardless.
 *   A non-matching condition SKIPS the step — skips cascade (a skipped need
 *   is neither success nor failure).
 * - `defaults.onStepFailure: abort` (default): the first failure cancels all
 *   still-pending steps except explicit `on: failure`/`always` consumers of
 *   already-terminal needs, and the run seals `failed`.
 *   `continue`: independent branches keep going; a finished run with both
 *   successes and failures seals `partial`.
 */

import {
  isApprovalStep,
  type PipelineDef,
  type PipelineRunStatus,
  type PipelineStepDef,
  type RunRecord,
  type StepRecord,
} from '@ant/shared';

export interface StepDispatch {
  stepId: string;
  kind: 'job' | 'gate';
  def: PipelineStepDef;
}

export interface ChainPlan {
  run: RunRecord;
  dispatches: StepDispatch[];
}

const TERMINAL: ReadonlySet<string> = new Set(['succeeded', 'failed', 'skipped', 'cancelled']);

/** Materialize implicit `needs` (OMITTED = previous step in file order; an explicit `[]` stays a root). */
export function effectiveNeeds(def: PipelineDef, index: number): string[] {
  const step = def.steps[index];
  if (step.needs !== undefined) return step.needs;
  return index > 0 ? [def.steps[index - 1].id] : [];
}

export function buildInitialSteps(def: PipelineDef): StepRecord[] {
  return def.steps.map((s) => ({ stepId: s.id, status: 'pending' as const }));
}

/**
 * Advance the run as far as pure state allows. Idempotent: calling it again
 * with the same input returns the same plan (dispatched/awaiting steps are
 * in-flight and never re-dispatched).
 */
export function planAdvance(def: PipelineDef, run: RunRecord): ChainPlan {
  const steps = run.steps.map((s) => ({ ...s }));
  const byId = new Map(steps.map((s) => [s.stepId, s]));
  const policy = def.defaults?.onStepFailure ?? 'abort';
  const dispatches: StepDispatch[] = [];

  const anyFailed = () => steps.some((s) => s.status === 'failed');

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < def.steps.length; i += 1) {
      const stepDef = def.steps[i];
      const record = byId.get(stepDef.id);
      if (!record || record.status !== 'pending') continue;

      // Abort policy: once anything failed, only edges that explicitly
      // consume failure (`failure` / `always`) may still start.
      const condition = stepDef.on ?? 'success';
      if (policy === 'abort' && anyFailed() && condition === 'success') {
        record.status = 'cancelled';
        changed = true;
        continue;
      }

      const needs = effectiveNeeds(def, i).map((id) => byId.get(id)).filter((s): s is StepRecord => !!s);
      if (!needs.every((s) => TERMINAL.has(s.status))) continue;

      const matches =
        condition === 'always'
          ? true
          : condition === 'failure'
            ? needs.some((s) => s.status === 'failed')
            : needs.length === 0 || needs.every((s) => s.status === 'succeeded');

      if (!matches) {
        record.status = 'skipped';
        changed = true;
        continue;
      }

      record.status = isApprovalStep(stepDef) ? 'awaiting_gate' : 'dispatched';
      dispatches.push({ stepId: stepDef.id, kind: isApprovalStep(stepDef) ? 'gate' : 'job', def: stepDef });
      changed = true;
    }
  }

  return { run: { ...run, steps, status: deriveRunStatus(steps, policy) }, dispatches };
}

/** Apply one step outcome, then advance. */
export function applyStepOutcome(
  def: PipelineDef,
  run: RunRecord,
  stepId: string,
  outcome: 'succeeded' | 'failed',
  patch?: Partial<StepRecord>,
): ChainPlan {
  const steps = run.steps.map((s) =>
    s.stepId === stepId ? { ...s, ...patch, status: outcome } : s,
  );
  return planAdvance(def, { ...run, steps });
}

export function deriveRunStatus(steps: StepRecord[], policy: 'abort' | 'continue'): PipelineRunStatus {
  const awaiting = steps.some((s) => s.status === 'awaiting_gate' || s.status === 'awaiting_clarify');
  // `pending` is not "live": post-fixpoint a pending step always sits behind
  // an executing or gated ancestor — only actual execution keeps `running`.
  const executing = steps.some((s) => s.status === 'dispatched' || s.status === 'running');
  if (executing) return 'running';
  if (awaiting) return 'awaiting_human';
  if (steps.some((s) => s.status === 'pending')) return 'running';

  const failed = steps.filter((s) => s.status === 'failed' || s.status === 'cancelled').length;
  const succeeded = steps.filter((s) => s.status === 'succeeded').length;
  if (failed === 0) return 'completed';
  if (policy === 'abort') return 'failed';
  return succeeded > 0 ? 'partial' : 'failed';
}
