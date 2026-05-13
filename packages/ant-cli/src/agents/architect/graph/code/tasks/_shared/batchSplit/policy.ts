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
  // feature / ui / design-system share the same fan-out contract:
  // parentReasoning replicated across batches (sibling drift caught at
  // the plan layer via `nodes/plan/injections/parent-pre-plan.md`),
  // FV appended unless one already sits in the queue, Tier 2
  // `selfVerifyOnDone` parents routed through this same policy because
  // `taskPolicy` lookup wins over the escalate-only fallback.
  feature: {
    kind: 'drop-and-replace',
    subType: 'feature',
    shape: featureBatchShape,
    populateRemediationMode: false,
    appendFinalVerification: true,
  },
  ui: {
    kind: 'drop-and-replace',
    subType: 'ui',
    shape: featureBatchShape,
    populateRemediationMode: false,
    appendFinalVerification: true,
  },
  'design-system': {
    kind: 'drop-and-replace',
    subType: 'design-system',
    shape: featureBatchShape,
    populateRemediationMode: false,
    appendFinalVerification: true,
  },
};
