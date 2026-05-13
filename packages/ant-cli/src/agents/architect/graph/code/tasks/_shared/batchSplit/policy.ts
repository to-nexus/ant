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
 * Feature batch shape — slim slice declaration. Emitted by feature / ui /
 * design-system plans when the work fans out into N physically-isolated
 * child tasks.
 *
 * Carries the slice **boundary** (`name`, `rationale`, optional
 * `requiredFiles`) and **cross-batch contracts** (`parentReasoning`) —
 * NOT the slice's internal `modify[]` / `create[]` / `delete[]` plan.
 * The child plan-tool-loop re-investigates the codebase and emits its
 * own flat implementation.
 *
 * Why slim (safe-braking-eagle RCA): the previous shape replicated the
 * parent's full per-batch `modify[]` / `create[]` / `delete[]` arrays
 * onto every child. The parent had to author them, so its single LLM
 * response routinely exceeded 30K output tokens and tripped the silent
 * `max_tokens` cliff. `parentReasoning` already carries the only
 * cross-batch signal children need (export names, shared types, file
 * layout) — restating the implementation per batch was duplication, not
 * coordination. See `.claude/plans/safe-braking-eagle-id-code-enchanted-dongarra.md`.
 *
 * Identity-shortcut is reserved for `error` only (which still uses
 * `diagnosticBatchShape`); feature/ui/design-system children run their
 * own plan-tool-loop and never inherit prePlanText via the shortcut.
 */
export function featureBatchShape(ctx: BatchPlanShapeCtx): string {
  const parentReasoning =
    (ctx.parsed as any).parentReasoning ??
    (ctx.parsed as any).rationale ??
    (ctx.parsed as any).reasoning ??
    '';
  const requiredFiles = Array.isArray(ctx.batch.requiredFiles)
    ? ctx.batch.requiredFiles.filter((p: unknown): p is string => typeof p === 'string' && p.length > 0)
    : [];
  return JSON.stringify({
    task: { id: `batch-${ctx.batchIndex}`, goal: ctx.batch.name },
    goal: ctx.batch.name,
    rationale: ctx.batch.rationale || ctx.batch.name,
    ...(requiredFiles.length > 0 ? { requiredFiles } : {}),
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
