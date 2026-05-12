import { CodeTask } from '../../../../../types/task';

/**
 * Per-task-type batch-split policy. Adding a participant is one entry.
 *
 *   kind                     'requeue-parent' (verification: identity +
 *                            `_failedAttempts` budget survive split) vs
 *                            'drop-and-replace' (error / test-code / Tier 2
 *                            escalate: parent disappears).
 *   subType                  task type stamped on each spawned sub-task.
 *   shape                    JSON body written to `sub.prePlanText`.
 *   populateRemediationMode  stamp `remediationMode` on the sub-task; only
 *                            error execute consumes it.
 *   appendFinalVerification  Path B may enqueue a Final Verification (Path A
 *                            never does — original re-runs).
 */

export interface BatchPlanShapeCtx {
  parsed: any;
  batch: any;
  batchIndex: number;
  planMode: 'patch' | 'upstream' | 'refactor';
}

export function diagnosticBatchShape(ctx: BatchPlanShapeCtx): string {
  return JSON.stringify({
    task: { id: `batch-${ctx.batchIndex}`, goal: ctx.batch.name },
    diagnostics: ctx.parsed.diagnostics,
    implementation: {
      modify: ctx.batch.modify || [],
      create: ctx.batch.create || [],
      delete: ctx.batch.delete || [],
    },
    rootCauseSelfCheck: ctx.parsed.rootCauseSelfCheck ?? { mode: ctx.planMode },
  });
}

export function testCodeBatchShape(ctx: BatchPlanShapeCtx): string {
  return JSON.stringify({
    task: { id: `batch-${ctx.batchIndex}`, goal: ctx.batch.name },
    slice: ctx.batch.rationale || ctx.batch.name,
    implementation: {
      modify: ctx.batch.modify || [],
      create: ctx.batch.create || [],
    },
  });
}

/**
 * Feature batch shape — emitted by deep-think feature task plan when it
 * concludes the work needs to fan out into N physically-isolated child
 * tasks. `parentReasoning` is the parent's solution rationale, replicated
 * onto EVERY child batch so siblings share the same big-picture context
 * (prevents naming/signature drift across siblings — e.g. parent decides
 * `startPreview`; if one child renames it, sibling caller breaks).
 *
 * Children carry this JSON as `prePlanText`. The child plan-tool-loop
 * receives it as INPUT (rendered via
 * `nodes/plan/injections/parent-pre-plan.md`) so the LLM verifies the
 * parent's predicted exports against actual sibling outputs before
 * emitting `planText`. Identity-shortcut is reserved for `error` only
 * (see `nodes/plan/shortcut/prePlanned.ts`).
 */
export function featureBatchShape(ctx: BatchPlanShapeCtx): string {
  const parentReasoning =
    (ctx.parsed as any).parentReasoning ??
    (ctx.parsed as any).rationale ??
    (ctx.parsed as any).reasoning ??
    '';
  return JSON.stringify({
    task: { id: `batch-${ctx.batchIndex}`, goal: ctx.batch.name },
    goal: ctx.batch.name,
    rationale: ctx.batch.rationale || ctx.batch.name,
    implementation: {
      modify: ctx.batch.modify || [],
      create: ctx.batch.create || [],
      delete: ctx.batch.delete || [],
    },
    parentReasoning,
  });
}

export type BatchSplitPolicyEntry = {
  kind: 'requeue-parent' | 'drop-and-replace';
  subType: CodeTask['type'];
  shape: (ctx: BatchPlanShapeCtx) => string;
  populateRemediationMode: boolean;
  appendFinalVerification: boolean;
};

export const BATCH_SPLIT_POLICY: Partial<Record<CodeTask['type'], BatchSplitPolicyEntry>> = {
  verification: {
    kind: 'requeue-parent',
    subType: 'error',
    shape: diagnosticBatchShape,
    populateRemediationMode: true,
    appendFinalVerification: false,
  },
  error: {
    kind: 'drop-and-replace',
    subType: 'error',
    shape: diagnosticBatchShape,
    populateRemediationMode: true,
    appendFinalVerification: true,
  },
  'test-code': {
    kind: 'drop-and-replace',
    subType: 'test-code',
    shape: testCodeBatchShape,
    populateRemediationMode: false,
    appendFinalVerification: true,
  },
  // Deep-think feature task fan-out (Tier 2/3 directive cases). Parent
  // owns the integrated reasoning, children carry fixed-scope prePlanText
  // surfaced as plan-tool-loop INPUT (via
  // `nodes/plan/injections/parent-pre-plan.md`). Drift between the parent's
  // predicted sibling exports and actual sibling outputs is detected at
  // the plan layer, not silently propagated to execute. FV is appended
  // unless one is already in the queue (hasFinalVerification guard). For
  // Tier 2 selfVerifyOnDone parents, the existing
  // `isTier2EscalateCandidate` branch routes through this same policy
  // (taskPolicy lookup wins over the escalate-only fallback).
  feature: {
    kind: 'drop-and-replace',
    subType: 'feature',
    shape: featureBatchShape,
    populateRemediationMode: false,
    appendFinalVerification: true,
  },
  // UI tasks share feature's fan-out shape (parentReasoning replicated
  // across batches) and the same plan-tool-loop input contract:
  // `prePlanText` is surfaced via `nodes/plan/injections/parent-pre-plan.md`
  // so children verify the parent decision against actual sibling outputs
  // before emitting `planText`. Lineage cycle protection rides on
  // batchSplitCount carry-over (process.ts).
  ui: {
    kind: 'drop-and-replace',
    subType: 'ui',
    shape: featureBatchShape,
    populateRemediationMode: false,
    appendFinalVerification: true,
  },
};
