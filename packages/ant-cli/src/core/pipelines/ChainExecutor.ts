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
 *   A non-matching condition SKIPS the step — non-occurrence cascades: a
 *   skipped or cancelled need is neither success nor failure, and `always`
 *   judges the OUTCOME of a need that happened, so it cascades too (a branch
 *   cannot be rejoined by declaring `on: always`).
 * - `defaults.onStepFailure: abort` (default): the first failure cancels all
 *   still-pending steps except explicit `on: failure`/`always` consumers of
 *   already-terminal needs, cancels an ARMED gate that consumes success (the
 *   decision it asks for can no longer change anything, and an unresolved
 *   gate would hold the run in `awaiting_human` forever), and the run seals
 *   `failed`.
 *   `continue`: independent branches keep going; a finished run with both
 *   successes and failures seals `partial`.
 * - At most ONE job step is in flight per run (dispatched / running /
 *   awaiting_clarify): ready siblings stay `pending` in file order and
 *   dispatch on the blocker's seal. Gates arm eagerly (no project slot).
 */

import {
  isApprovalStep,
  perCaseStepIds,
  verdictEdgeOutcomes,
  type PipelineDef,
  type PipelineRunStatus,
  type PipelineStepDef,
  type RunRecord,
  type StepEdgeCondition,
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

/** What an edge judges: a sealed node's status and (for `verdict:` edges) its sealed verdict. */
export type EdgeNode = Pick<StepRecord, 'status' | 'verdict'>;

/**
 * The ONE edge predicate — a step's `on` inside a pipeline and `on.upstream.when`
 * across pipelines judge with it, so the two can never drift. `always` judges an
 * OUTCOME, and a skipped or cancelled node has none: it did not happen.
 * Matching it unconditionally made `always` the one edge that rejoins a branch
 * and the one edge an abort cascade cannot stop — an aborting run dispatched a
 * fresh job off a cancelled need and then asked a human a question it could
 * not act on. `verdict:a|b` has switch semantics: a node SUCCEEDED with a sealed
 * verdict the edge names (any listed member).
 */
export function edgeMatches(condition: StepEdgeCondition, needs: readonly EdgeNode[]): boolean {
  const happened = (s: EdgeNode) => s.status === 'succeeded' || s.status === 'failed';
  if (condition === 'always') return needs.length === 0 || needs.every(happened);
  if (condition === 'failure') return needs.some((s) => s.status === 'failed');
  if (condition.startsWith('verdict:')) {
    return needs.some((s) => s.status === 'succeeded' && s.verdict !== undefined && verdictEdgeOutcomes(condition).includes(s.verdict));
  }
  return needs.length === 0 || needs.every((s) => s.status === 'succeeded');
}

/**
 * A sealed run judged as ONE node for an upstream edge: completed → succeeded,
 * failed / partial → failed (a run with a failed step failed, whatever the
 * step-failure policy called the aggregate), cancelled → null: it did not
 * happen, and non-occurrence fires nothing.
 */
export function runNodeOf(run: Pick<RunRecord, 'status'>): EdgeNode | null {
  if (run.status === 'completed') return { status: 'succeeded' };
  if (run.status === 'failed' || run.status === 'partial') return { status: 'failed' };
  return null;
}

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
 * A DISCOVERY run's steps: the per-case steps (downstream of the `discovers`
 * step) are pre-skipped — inert to `planAdvance`, neither success nor failure
 * to `deriveRunStatus` — so the run seals `completed` once the discovering
 * prefix does. They come back as case runs.
 */
export function buildDiscoveryRunSteps(def: PipelineDef): StepRecord[] {
  const perCase = perCaseStepIds(def);
  return def.steps.map((s) => ({ stepId: s.id, status: perCase.has(s.id) ? ('skipped' as const) : ('pending' as const) }));
}

/**
 * A CASE run's steps: the discovery run's sealed prefix is copied over
 * (status + output + verdict — what `{{steps.<id>.*}}` and edges read),
 * stripped of the parent's job/turn/gate/clarify identity and of the case
 * list itself; the per-case steps start pending. A prefix step the parent
 * had not sealed when the case was queued did not happen for this case
 * (`skipped`) — a case run never waits on the discovery run's other branches.
 */
export function buildCaseRunSteps(def: PipelineDef, parent: Pick<RunRecord, 'steps'>): StepRecord[] {
  const perCase = perCaseStepIds(def);
  const byId = new Map(parent.steps.map((s) => [s.stepId, s]));
  return def.steps.map((s): StepRecord => {
    if (perCase.has(s.id)) return { stepId: s.id, status: 'pending' };
    const p = byId.get(s.id);
    if (!p || !TERMINAL.has(p.status)) return { stepId: s.id, status: 'skipped' };
    const { jobId: _j, turnId: _t, gate: _g, clarify: _c, attempts: _a, dispatch: _d, retriesUsed: _r, cases: _k, ...kept } = p;
    return kept;
  });
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

  // At most ONE job step in flight per run. Every step dispatches into the
  // same project, so the project-level duplicate gate would serialize ready
  // siblings through bounded 60s re-arms — a valid fan-out def could fail
  // (`duplicate-job-timeout`) purely on a sibling's duration. The executor
  // defers ready job steps instead (they stay `pending`, in file order); the
  // next one dispatches on the blocker's seal event. `awaiting_clarify`
  // counts as in flight: the answer re-dispatches that SAME step directly,
  // outside this planner. Gates hold no project slot and still arm eagerly;
  // skip/cancel judgments stay eager so cascades propagate immediately.
  // True parallel dispatch is Phase 3 (duplicate-gate relaxation).
  let jobInFlight = steps.some(
    (s) => s.status === 'dispatched' || s.status === 'running' || s.status === 'awaiting_clarify',
  );

  // Abort also ends the HUMAN waits it orphans. A gate that armed on success
  // guards steps this cascade just cancelled, so its approve/reject decides
  // nothing — and while it sits `awaiting_gate` the run stays
  // `awaiting_human` and never seals (the coordinator disarms the card/arms
  // for every step this turns `cancelled`). Gates that explicitly consume
  // failure are the failure path itself and stay armed.
  if (policy === 'abort' && anyFailed()) {
    for (let i = 0; i < def.steps.length; i += 1) {
      const stepDef = def.steps[i];
      const record = byId.get(stepDef.id);
      if (!record || record.status !== 'awaiting_gate') continue;
      const condition = stepDef.on ?? 'success';
      if (condition === 'failure' || condition === 'always') continue;
      record.status = 'cancelled';
    }
  }

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

      // Non-matching branches skip; skips cascade (doc 46 §4).
      if (!edgeMatches(condition, needs)) {
        record.status = 'skipped';
        changed = true;
        continue;
      }

      if (isApprovalStep(stepDef)) {
        record.status = 'awaiting_gate';
        dispatches.push({ stepId: stepDef.id, kind: 'gate', def: stepDef });
        changed = true;
        continue;
      }
      // Ready job step, but a job is already in flight — deferred, not skipped.
      if (jobInFlight) continue;
      record.status = 'dispatched';
      dispatches.push({ stepId: stepDef.id, kind: 'job', def: stepDef });
      jobInFlight = true;
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
  // an executing or gated ancestor, or behind an in-flight sibling (the
  // one-job-in-flight rule) — only actual execution keeps `running`.
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
