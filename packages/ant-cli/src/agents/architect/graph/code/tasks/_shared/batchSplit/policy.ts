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
};
