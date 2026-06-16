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

/**
 * Seam batch shape — `featureBatchShape` plus the slice's pre-enumerated
 * `closureItems`. The seam parent's partition-only pass already walked the
 * module's reference graph and recorded, per slice, exactly which references /
 * affordances / style-selectors / reach-roles that slice owns (tagged
 * resolved | to-fix | to-remove | to-wire). Carrying that inventory verbatim to
 * the child is what stops the child re-deriving it from scratch — the
 * duplicate-thin-slice symptom (`comments-css-closure` x2) seen when children
 * only received the slice name. `closureItems` is seam-only, so it lives here
 * rather than polluting `featureBatchShape` (shared by feature/ui/design-system/
 * test-code, which never author it).
 */
export function seamBatchShape(ctx: BatchPlanShapeCtx): string {
  const base = JSON.parse(featureBatchShape(ctx));
  const closureItems = Array.isArray(ctx.batch.closureItems) ? ctx.batch.closureItems : [];
  return JSON.stringify({
    ...base,
    ...(closureItems.length > 0 ? { closureItems } : {}),
  });
}

export type BatchSplitPolicyEntry = {
  kind: 'requeue-parent' | 'drop-and-replace';
  subType: CodeTask['type'];
  shape: (ctx: BatchPlanShapeCtx) => string;
  populateRemediationMode: boolean;
  appendFinalVerification: boolean;
  /**
   * When set, the plan's fan-out is NOT the LLM's discretion: the named
   * top-level array (each entry shaped like a `batches[]` entry —
   * `{ name, rationale, requiredFiles?, parallelGroup?, priorityInParallelGroup? }`)
   * is the enumeration of disjoint work slices. When it holds 2+ entries the
   * runtime auto-partitions (each slice → one sub-task) instead of letting a
   * flat plan through. A single slice (or none) proceeds as a flat plan.
   *
   * This removes the discretionary flat-plan escape that let a whole-module
   * seam audit collapse into one shallow pass (RCA: third-housing-forge —
   * both seam tasks emitted `flat_plan_no_batches` and never partitioned).
   * The decision moves from "should I fan out?" (LLM-optional) to "enumerate
   * your disjoint slices" (descriptive) + runtime-owned partition.
   */
  partitionFromField?: string;
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
  // test-code is a NON-forking slim-shape participant (like feature/ui/ds):
  // the parent declares feature-slice boundaries (name/rationale/scheduling)
  // and each child re-plans its own test `implementation` with a fresh
  // budget. Disjoint test-file surfaces per slice are enforced by the shared
  // FAN-OUT scope-conservation + the test-code-protocol slice note, not by
  // batch-level file lists (those no longer exist under slim-shape).
  'test-code': {
    kind: 'drop-and-replace',
    subType: 'test-code',
    shape: featureBatchShape,
    populateRemediationMode: false,
    appendFinalVerification: true,
  },
  // feature / ui / design-system share the same fan-out contract:
  // parentReasoning replicated across batches (sibling drift caught at
  // the plan layer via `nodes/plan/injections/parent-pre-plan.md`),
  // FV appended unless one already sits in the queue, Tier 2
  // `selfVerifyOnDone` parents routed through this same policy because
  // `taskPolicy` lookup wins over the escalate-only fallback.
  //
  // NOTE: whether spawned siblings serialise or parallelise is NOT a
  // property of the task type; it is a property of the work, which
  // only the LLM authoring `batches[]` can know. The runtime reads
  // optional per-batch `parallelGroup` + `priorityInParallelGroup`
  // fields when present (lane mode) and falls back to the legacy
  // distinct-per-i assignment otherwise. The prompts for these
  // slim-shape task types require the LLM to emit both fields; the
  // policy table here does not encode that decision.
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
  // seam (reference + affordance closure) fans out the SAME way as feature:
  // the parent enumerates the module's reference graph and declares slim,
  // disjoint-file slices; each child re-plans its slice over the materialized
  // code. subType 'seam' is carried verbatim (type carry-over — feature's band
  // carry-over does not apply, seam has no band). Same-lane ordering via
  // `parallelGroup` + `priorityInParallelGroup` (child priority = parent +
  // offset, kept inside the seam window 700–749). FV appended unless one
  // already sits in the queue (Tier 3/4 always has one → no-op).
  seam: {
    kind: 'drop-and-replace',
    subType: 'seam',
    shape: seamBatchShape,
    populateRemediationMode: false,
    appendFinalVerification: true,
    // Closure audit MUST partition: the seam plan enumerates disjoint
    // file-set slices in `closureSlices[]`; 2+ slices auto-fan-out so a
    // whole-module audit cannot run as a single shallow flat pass.
    partitionFromField: 'closureSlices',
  },
};
