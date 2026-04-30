/**
 * plan/parts/batchSplit.ts — diagnostic batch-split orchestration.
 *
 * Extracted from `nodes/plan/index.ts` as part of T6b-α. Behaviour is
 * byte-identical to the inline implementation; only module boundary moves.
 *
 * Responsibilities:
 *   - `processDiagnosticBatchSplit`: detect a batched diagnostic plan and
 *     split it into sub-tasks. Re-enqueue the original task behind the
 *     per-batch error tasks when the split fires.
 *   - `isVerificationPassWithoutCodeGen`: detect the "diagnostic task
 *     finished tool loop but there's nothing left to apply" case so the
 *     plan node can mark `done:true` directly and skip the execute call.
 *
 * Kept local because both helpers are only called from the plan node's
 * orchestration path; exposing them elsewhere would bypass the phase
 * boundary intentionally established by R1.
 */

import { ArchitectGraphState, TASK_PRIORITIES } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import type { TechTier } from '@ant/shared';
import { snapshotFromState } from '../../../parallel/TaskWorker';
import { appendTrace } from '../../../../../../../utils/verificationTrace';
import { VerificationTerminalError } from '../../../tasks/_shared/verify/errors';
import { isVerificationTask } from '../../../tasks/verification';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BATCH_SPLIT_POLICY — per-task-type split policy map
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Encodes the four behaviours that vary between task types so the orchestrator
// body stays task-type-blind (R1). Each entry declares:
//
//   kind       — Path A (`requeue-parent`) for verification, whose identity and
//                `_failedAttempts` budget must survive the split; Path B
//                (`drop-and-replace`) for error / Tier 2 escalate / test-code,
//                whose parents hand off and disappear.
//   subType    — task type assigned to each spawned sub-task. Verification
//                splits into 'error' fix-apply sub-tasks; error and test-code
//                split into their own type so variant templates and task-type
//                hooks keep matching.
//   shape      — JSON payload written to `sub.prePlanText`. Verification /
//                error emit the diagnostic-centric `{task, diagnostics,
//                implementation, rootCauseSelfCheck}` form that their execute
//                variants parse. test-code's execute variant only reads
//                `implementation.{modify,create}`, so its shape omits diagnostic
//                fields that would otherwise be noise.
//   populateRemediationMode — verification/error sub-tasks carry the planMode
//                on the task field for the error execute variant's scope-mode
//                branches. test-code sub-tasks never consult it and the field
//                is suppressed to avoid dead data on the task.
//   appendFinalVerification — Path B enqueues a Final Verification when none
//                is already queued. Verification (Path A) never enqueues a
//                second FV because the original task re-runs.
//
// `isBatchSplitCandidate` below uses `!!BATCH_SPLIT_POLICY[task.type]` (plus
// the Tier 2 escalate flag) as the gate — adding a new task-type participant
// is a one-line policy-map addition.

interface BatchPlanShapeCtx {
  parsed: any;
  batch: any;
  batchIndex: number;
  planMode: 'patch' | 'upstream' | 'refactor';
}

function diagnosticBatchShape(ctx: BatchPlanShapeCtx): string {
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

function testCodeBatchShape(ctx: BatchPlanShapeCtx): string {
  return JSON.stringify({
    task: { id: `batch-${ctx.batchIndex}`, goal: ctx.batch.name },
    slice: ctx.batch.rationale || ctx.batch.name,
    implementation: {
      modify: ctx.batch.modify || [],
      create: ctx.batch.create || [],
    },
  });
}

type BatchSplitPolicyEntry = {
  kind: 'requeue-parent' | 'drop-and-replace';
  subType: CodeTask['type'];
  shape: (ctx: BatchPlanShapeCtx) => string;
  populateRemediationMode: boolean;
  appendFinalVerification: boolean;
};

const BATCH_SPLIT_POLICY: Partial<Record<CodeTask['type'], BatchSplitPolicyEntry>> = {
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

/**
 * Final Verification presence check. Mirrors the helper in
 * `tasks/error/hooks/orchestrator.ts` — we duplicate the small predicate
 * instead of importing because the hook's dedup fallback and the escalate
 * path here have different call shapes and lifecycles; the priority check
 * plus "any completed verification" semantics is identical either way.
 */
function hasFinalVerification(
  queue: readonly CodeTask[],
  running: readonly CodeTask[],
  completed: readonly CodeTask[],
): boolean {
  const inFinalPriority = (t: CodeTask): boolean =>
    t.priority === TASK_PRIORITIES.FINAL_VERIFICATION;
  if (queue.some(inFinalPriority)) return true;
  if (running.some(inFinalPriority)) return true;
  if (completed.some((t: CodeTask) => t.type === 'verification')) return true;
  return false;
}

export const MAX_BATCH_SPLIT_CYCLES = 10;

/**
 * Extract a JSON-parseable substring from an LLM plan output.
 *
 * Three increasingly aggressive strategies, applied in order:
 *
 *   1. Whole-string markdown-fence strip — `\`\`\`json\n...\n\`\`\``
 *      or `\`\`\`\n...\n\`\`\`` wrapping the entire body.
 *   2. Inline JSON object extraction — when the model prefixes prose
 *      around backticks (the `urban-fronting-faith` pattern: planText
 *      began with "\` as soon as ..." prose), grab the substring from
 *      the first `{` to the last `}`. This rescues plans where the
 *      model added a prologue / epilogue but the structural body is
 *      still well-formed JSON.
 *   3. Fall through to the trimmed input.
 *
 * Strategy (2) is the lever that turns the formerly-skipped
 * `json_parse_error` cycles into recoverable plans without spending an
 * extra LLM call on a self-correct round-trip. The downstream
 * `JSON.parse` is the authoritative validator — extraction only
 * narrows the candidate; if the slice is still malformed, the catch
 * branch still logs `json_parse_error` and we degrade gracefully.
 */
function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Strategy 2 — first `{` to last `}` slice. Only attempted when the
  // trimmed body is not itself parseable JSON, otherwise the caller's
  // own `JSON.parse` would be bypassed for inputs that need no rescue.
  if (trimmed.length > 0 && trimmed[0] !== '{') {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1).trim();
    }
  }

  return trimmed;
}

/**
 * Detect a plan JSON whose implementation is literally empty
 * (no modify/create/delete entries and no batches). An empty plan followed by
 * execute is a guaranteed no-op that will still consume LLM calls; the plan
 * node flips `llmResponse.done = true` so planRouter short-circuits to
 * `checkTaskStatus`. Router itself stays pure (read-only) per R1.
 */
export function hasEmptyImplementation(planText: string | undefined): boolean {
  if (!planText) return false;
  const body = stripMarkdownFences(planText);
  if (!body.length) return false;
  try {
    const parsed = JSON.parse(body);
    const impl = parsed.implementation || {};
    const modifyCount = Array.isArray(impl.modify) ? impl.modify.length : 0;
    const createCount = Array.isArray(impl.create) ? impl.create.length : 0;
    const deleteCount = Array.isArray(impl.delete) ? impl.delete.length : 0;
    const hasBatches = Array.isArray(parsed.batches) && parsed.batches.length > 0;
    return !hasBatches && modifyCount === 0 && createCount === 0 && deleteCount === 0;
  } catch {
    return false;
  }
}

/**
 * Invariant: after `processDiagnosticBatchSplit` runs, a verification task
 * MUST NOT carry a non-empty `planText` with surviving top-level
 * `implementation.{modify,create,delete}` entries. The auto-conversion in
 * the always-fan-out policy normalises top-level entries into batches and
 * returns `''` once the fan-out fires, so any post-call planText that still
 * has top-level entries indicates a defect in the conversion path itself
 * (or a caller that bypassed it).
 *
 * Behaviour: throws when the invariant is violated. Empty / parse-failure
 * planText paths are no-ops because the empty-impl shortcut + JSON-parse
 * catch in batchSplit already cover them.
 *
 * Scope: development assist only. Production behaviour is identical with
 * or without this guard — the orchestrator's TerminalError path would
 * eventually mark the task failed if a malformed plan slipped through, but
 * the throw here surfaces the bug at the producing call site instead of
 * downstream.
 */
export function assertVerificationPlanIsFanoutOnly(
  planText: string,
  task: CodeTask,
): void {
  if (!isVerificationTask(task)) return;
  if (!planText) return;
  let parsed: any;
  try {
    parsed = JSON.parse(stripMarkdownFences(planText));
  } catch {
    return;
  }
  const impl = parsed?.implementation || {};
  const topLevelCount =
    (Array.isArray(impl.modify) ? impl.modify.length : 0) +
    (Array.isArray(impl.create) ? impl.create.length : 0) +
    (Array.isArray(impl.delete) ? impl.delete.length : 0);
  if (topLevelCount === 0) return;
  throw new Error(
    `[BatchSplit invariant] Verification task "${task.name}" produced a planText with ${topLevelCount} top-level implementation entries that survived processDiagnosticBatchSplit. This indicates a fan-out conversion regression — every entry should have been auto-converted to a per-target batch and the planText should be empty.`,
  );
}

/**
 * Check whether any two batches share files in their modify/create/delete lists.
 * When overlap exists, sub-tasks must run exclusively (sequential).
 * When no overlap, they can safely run in parallel.
 *
 * Accepts every entry shape the plan prompts emit:
 *   - a bare string path,
 *   - `{target: 'path'}`  — the error / test-code variant format,
 *   - `{file: 'path'}`    — legacy shape retained for back-compat.
 *
 * Reading only `.file` would silently collapse `{target}` entries to the
 * shared sentinel `undefined`, flagging every multi-batch `{target}`-shape
 * plan as overlapping and forcing `exclusive: true` even on independent
 * slices. Both keys are checked so the overlap predicate reflects actual
 * path conflicts.
 */
function computeBatchFileOverlap(batches: any[]): boolean {
  const pathOf = (entry: any): string | undefined => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object') return entry.target ?? entry.file;
    return undefined;
  };
  const extractFiles = (b: any): Set<string> => {
    const files = new Set<string>();
    for (const m of (b.modify || [])) {
      const p = pathOf(m);
      if (p) files.add(p);
    }
    for (const c of (b.create || [])) {
      const p = pathOf(c);
      if (p) files.add(p);
    }
    for (const d of (b.delete || [])) {
      const p = pathOf(d);
      if (p) files.add(p);
    }
    return files;
  };
  const allFiles = batches.map(extractFiles);
  for (let i = 0; i < allFiles.length; i++) {
    for (let j = i + 1; j < allFiles.length; j++) {
      for (const file of allFiles[i]) {
        if (allFiles[j].has(file)) return true;
      }
    }
  }
  return false;
}

/**
 * When a verification task finishes its plan tool-loop with build/test already
 * passing and no plan to execute, execute would only ask the LLM to output
 * `<done>true</done>` — a wasted call. Detect this and let the plan node set
 * `done: true` directly so planRouter skips execute entirely.
 *
 * Scope is intentionally verification-only: completeness is decided by
 * `VerificationSession.isComplete()`, which is populated exclusively by the
 * verification plan hook's `initSession`. Error tasks never own a session
 * (they apply fixes from `prePlanText`) so they would always read `false`
 * here anyway — narrowing the gate to verification makes the semantics
 * honest instead of relying on session-absence as an implicit filter.
 */
export function isVerificationPassWithoutCodeGen(
  state: ArchitectGraphState,
  planText: string,
  batchSplitOccurred: boolean,
): boolean {
  if (batchSplitOccurred) return false;
  if (planText !== '') return false;
  if (!isVerificationTask(state.currentTask)) return false;
  return state.verification?.isComplete() ?? false;
}

/**
 * Detect a diagnostic / remediation plan and fan it out into sub-tasks.
 * Called from every path that produces a planText for diagnostic tasks.
 *
 * Always-fan-out semantics (post verification fix-책임 제거 리팩토링):
 *   - Any plan with 1+ implementation entries (modify/create/delete) or
 *     1+ batches[] entries produces sub-tasks. No thresholds, no env gates,
 *     no "same plan hash" escalation.
 *   - Top-level `implementation.{modify,create,delete}` with no `batches[]`
 *     is auto-converted to per-target batches so every entry becomes its
 *     own fix-apply sub-task. Verification's responsibility is per-error
 *     fan-out; the LLM's "I'll batch later" hint is normalised here.
 *   - Existing `batches[]` are respected (LLM-grouped by dependency) and
 *     each batch becomes one sub-task.
 *
 * Hard limit: after `MAX_BATCH_SPLIT_CYCLES` cycles, batch splitting is
 * aborted by throwing `VerificationTerminalError('batch_cycle_limit')`.
 * This prevents infinite loops from cascading compiler errors that reveal
 * new layers after each fix cycle.
 *
 * @returns updated planText (empty string if fan-out occurred, original otherwise)
 */
export function processDiagnosticBatchSplit(
  state: ArchitectGraphState,
  planText: string,
  nextTask: CodeTask,
): string {
  // Gate covers four populations:
  //   1. Verification tasks (Tier 3/4 final gate) — Path A (requeue-parent).
  //   2. Error tasks emitted by decompose (Tier 3/4) — Path B (drop-and-replace).
  //      Sub-tasks produced by a previous split carry `prePlanText` and
  //      fast-path past this function (see `plan/index.ts
  //      maybePrePlannedFastPath`); decompose-emitted error tasks fall
  //      through normal planning and may produce a multi-batch plan.
  //   3. Tier 2 escalate — any task type (feature/ui/error/setup/explain is
  //      filtered out by `selfVerifyOnDone`). On escalate the original task
  //      is DROPPED and a verification task is enqueued in its place,
  //      morphing the queue into the Tier 3 shape (N sub-tasks + 1
  //      verification). `executionTier` channel stays at 2 — this is
  //      queue-structure escalation, not a tier-channel promotion. See
  //      `.cursorrules` "Tier-Verification Alignment SSOT → Tier 2 runtime
  //      escalate".
  //   4. Test-code parent tasks (Path B). The parent's plan tool-loop
  //      installs test-runner deps and emits feature-slice `batches[]`.
  //      batchSplit drops the parent and spawns N test-code sub-tasks
  //      (one per slice), each fast-pathing through the plan phase via
  //      `prePlanText`.
  // Cascading splits are bounded by `MAX_BATCH_SPLIT_CYCLES` on the Session.
  const isTier2EscalateCandidate =
    state.executionTier === 2 && (nextTask as CodeTask).selfVerifyOnDone === true;
  const taskPolicy = BATCH_SPLIT_POLICY[nextTask.type];
  const isBatchSplitCandidate = !!taskPolicy || isTier2EscalateCandidate;

  const logBatchSplit = (data: Record<string, any>) => {
    if (state.context?.featurePath && state._httpJobId) {
      import('../../../../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
        getExecutionLogger({
          featurePath: state.context!.featurePath!,
          jobId: state._httpJobId!,
          jobType: 'code',
        }).log('batch_split', data, nextTask.id);
      }).catch(() => {});
    }
  };

  if (!isBatchSplitCandidate) {
    return planText;
  }
  if (!planText || planText.length <= 50) {
    // `plan_too_short` here is a NORMAL outcome on the happy path: for
    // verification tasks whose Session has all required gates passing,
    // the plan-LLM intentionally emits an empty/near-empty plan. The
    // plan node then fires `isVerificationPassWithoutCodeGen` which
    // flips `llmResponse.done = true` so the task completes without
    // another execute call. Without the extra fields below, an operator
    // reading `batch_split: skipped` followed immediately by
    // `task_complete` could easily mistake it for a "gave up" signal.
    //
    // Test-code parents that decide "no slice split necessary" legitimately
    // fall through without emitting a short plan (they emit the full
    // single-task plan directly), so this branch rarely fires for them.
    const isVerification = isVerificationTask(nextTask);
    const verificationComplete = state.verification?.isComplete() ?? false;
    const willPassViaShortcut = isVerification && verificationComplete;
    logBatchSplit({
      action: 'skipped',
      reason: 'plan_too_short',
      planTextLen: planText?.length ?? 0,
      taskName: nextTask.name,
      parentType: nextTask.type,
      isVerification,
      verificationComplete,
      nextOutcome: willPassViaShortcut
        ? 'pass_via_empty_plan_shortcut'
        : 'skip_to_execute_or_check',
    });
    return planText;
  }
  if (!state.taskQueue || typeof state.taskQueue.push !== 'function' || typeof state.taskQueue.getAll !== 'function') {
    logBatchSplit({ action: 'skipped', reason: 'taskQueue_missing', taskQueueType: typeof state.taskQueue, constructor: state.taskQueue?.constructor?.name ?? 'N/A', taskName: nextTask.name });
    return planText;
  }

  try {
    const jsonStr = stripMarkdownFences(planText);
    const parsed = JSON.parse(jsonStr);

    // Always-fan-out policy. Any plan with 1+ implementation entries is
    // converted into 1-entry-per-target batches and fanned out — no
    // thresholds, no env gates, no "same plan hash" escalation. The
    // threshold/forceByRepeat machinery existed to soften the LLM's
    // tendency to fix multiple unrelated errors in one batch; with
    // verification's fix responsibility removed entirely (verification =
    // diagnose + fan-out only, error sub-tasks own fix), every implementation
    // entry SHOULD become a sub-task by definition.
    const totalErrors: number = parsed.diagnostics?.totalErrors ?? 0;
    const modifyArr: any[] = Array.isArray(parsed.implementation?.modify) ? parsed.implementation.modify : [];
    const createArr: any[] = Array.isArray(parsed.implementation?.create) ? parsed.implementation.create : [];
    const deleteArr: any[] = Array.isArray(parsed.implementation?.delete) ? parsed.implementation.delete : [];
    const hasExistingBatches = Array.isArray(parsed.batches) && parsed.batches.length > 0;
    const topLevelImplCount = modifyArr.length + createArr.length + deleteArr.length;

    // Top-level → batches auto-conversion. Verification/error/Tier 2 plans
    // with implementation.{modify,create,delete} but no batches[] are
    // expanded into per-target batches so every entry becomes its own
    // fix-apply sub-task.
    if (!hasExistingBatches && topLevelImplCount > 0) {
      logBatchSplit({
        action: 'auto_convert_top_level',
        modifyCount: modifyArr.length,
        createCount: createArr.length,
        deleteCount: deleteArr.length,
        totalErrors,
        taskName: nextTask.name,
      });
      const batchesAcc: any[] = [];
      for (const m of modifyArr) {
        const target = typeof m === 'string' ? m : (m.target || m.file || `modify-${batchesAcc.length}`);
        batchesAcc.push({
          name: `Fix ${target}`,
          rationale: (m && m.action) || `Apply modifications to ${target}`,
          modify: [m],
          create: [],
          delete: [],
        });
      }
      for (const c of createArr) {
        const target = typeof c === 'string' ? c : (c.target || c.file || `create-${batchesAcc.length}`);
        batchesAcc.push({
          name: `Create ${target}`,
          rationale: (c && c.purpose) || `Create ${target}`,
          modify: [],
          create: [c],
          delete: [],
        });
      }
      for (const d of deleteArr) {
        const target = typeof d === 'string' ? d : (d.target || d.file || `delete-${batchesAcc.length}`);
        batchesAcc.push({
          name: `Delete ${target}`,
          rationale: (d && d.reason) || `Delete ${target}`,
          modify: [],
          create: [],
          delete: [d],
        });
      }
      parsed.batches = batchesAcc;
    }

    if (!parsed.batches || !Array.isArray(parsed.batches) || parsed.batches.length === 0) {
      logBatchSplit({ action: 'skipped', reason: 'no_implementation_entries', batchCount: 0, taskName: nextTask.name });
      return planText;
    }

    // ── Hard limit: cap batch split cycles to prevent infinite loops ──
    // The count lives on the Session (carried across re-queue via the
    // `resumeState.verification` snapshot), not on the task.
    const splitCount = (state.verification?.batchSplitCount() ?? 0) + 1;

    if (splitCount > MAX_BATCH_SPLIT_CYCLES) {
      logBatchSplit({ action: 'cycle_limit_failed', splitCount, taskName: nextTask.name });
      console.error(`❌ [BatchSplit] Cycle limit (${MAX_BATCH_SPLIT_CYCLES}) exceeded for "${nextTask.name}". Throwing terminal error.`);
      appendTrace({
        node: 'plan',
        taskId: nextTask.id,
        taskType: nextTask.type,
        extra: { reason: 'cycle_limit_terminal', splitCount },
      });
      // T8 — single terminal sink: propagate as a typed VerificationTerminalError
      // so `TaskOrchestrator.reportFailure` classifies it and marks the task as
      // permanently failed (the orchestrator now owns every `_failed=true`
      // write). Replaces the former `_failed=true + _batchSplitRequeued`
      // side-effect path that required the worker subgraph to unwind through
      // checkTaskStatus' batch-split branch to release its slot — the throw
      // path releases the slot via the standard worker `catch → reportFailure`
      // flow without any "task silently lost" edge case.
      throw new VerificationTerminalError(
        'batch_cycle_limit',
        `Batch split cycle limit (${MAX_BATCH_SPLIT_CYCLES}) exceeded for "${nextTask.name}" after ${splitCount} cycles.`,
        snapshotFromState(state)?.verification,
      );
    }

    const hasFileOverlap = computeBatchFileOverlap(parsed.batches);
    // Each batch gets a unique parallelGroup so TaskOrchestrator can run them concurrently.
    // Batches with file overlap use exclusive:true (sequential) instead.
    // Prefix encodes the parent type for log/trace readability; sub-type may
    // differ (e.g. verification parent → 'error' sub).
    const batchGroupBase = hasFileOverlap ? null : `${nextTask.type}-batch-${Date.now()}`;

    // Phase 3-11 — carry the plan-level `rootCauseSelfCheck.mode` onto each
    // batch so the error execute variant can branch its scope rules.
    // Falls back to a heuristic (max affectedFiles across rootCauses ≥ 5 →
    // 'upstream', otherwise 'patch') when the LLM did not self-report.
    const selfCheck = (parsed as any).rootCauseSelfCheck;
    const allowedModes = ['patch', 'upstream', 'refactor'] as const;
    type RemediationMode = typeof allowedModes[number];
    let planMode: RemediationMode;
    if (selfCheck?.mode && allowedModes.includes(selfCheck.mode)) {
      planMode = selfCheck.mode;
    } else {
      const maxAffected = (parsed.diagnostics?.rootCauses ?? []).reduce(
        (m: number, rc: any) => Math.max(m, Array.isArray(rc.affectedFiles) ? rc.affectedFiles.length : 0),
        0,
      );
      planMode = maxAffected >= 5 ? 'upstream' : 'patch';
    }

    const subTaskIds: string[] = [];
    for (let i = 0; i < parsed.batches.length; i++) {
      const batch = parsed.batches[i];

      // Sub-task policy dispatch. Verification parents always split into
      // 'error' fix-apply sub-tasks; error parents produce more 'error';
      // test-code parents produce 'test-code' sub-tasks; Tier 2 escalate
      // (no policy entry) inherits parent.type so the variant template
      // and task-type hooks keep matching the work semantic.
      //
      // `selfVerifyOnDone` is intentionally NOT set on sub-tasks — gate
      // responsibility is handed off to the Final Verification enqueued
      // below (Tier 2 escalate / Tier 3+ Path B) or to the pre-existing
      // Final Verification in the queue (Tier 3/4 verification).
      const subType: CodeTask['type'] = taskPolicy?.subType ?? nextTask.type;
      const shape = taskPolicy?.shape ?? diagnosticBatchShape;
      const batchPlanText = shape({ parsed, batch, batchIndex: i, planMode });

      const namePrefix = subType === 'test-code' ? 'Tests' : 'Fix';
      const subTask: CodeTask = {
        id: `${subType}-batch-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        name: `${namePrefix}: ${batch.name}`,
        description: batch.rationale || batch.name,
        type: subType,
        priority: (nextTask.priority || 500) - 1,
        prePlanText: batchPlanText,
        exclusive: hasFileOverlap,
        parallelGroup: batchGroupBase ? `${batchGroupBase}-${i}` : undefined,
      };
      // `remediationMode` is only meaningful to the error execute variant's
      // scope-mode branches. test-code sub-tasks never consult it; gating on
      // the policy flag avoids stamping the field onto tasks that would
      // ignore it.
      if (taskPolicy?.populateRemediationMode !== false) {
        subTask.remediationMode = planMode;
      }
      state.taskQueue.push(subTask);
      subTaskIds.push(subTask.id);
    }

    // Record the batch-split cycle on the Session BEFORE capturing the
    // snapshot so the carried `verification.batchSplitCount` reflects the
    // new cycle (matches the hard-limit check above). `onBatchSplit`
    // bumps the counter by one and stores the diagnostics summary used
    // by the follow-up plan prompt to avoid re-triggering the same split.
    state.verification?.onBatchSplit(JSON.stringify({
      cycle: splitCount,
      totalErrors: parsed.diagnostics?.totalErrors ?? 0,
      rootCauses: parsed.diagnostics?.rootCauses ?? [],
      batchNames: parsed.batches.map((b: any) => b.name),
    }));

    // Branch on parent role — the two paths have different invariants:
    //
    //   A. requeue-parent (verification only). Historical behaviour:
    //      re-enqueue the original so its orchestrator retry budget
    //      (`_failedAttempts`) stays attached to the same task identity.
    //      Resetting that budget by spawning a fresh verification task is
    //      the legacy `still-lacing-north` regression — the snapshot ships
    //      via `resumeState.verification` but `_failedAttempts` must not
    //      reset.
    //
    //   B. drop-and-replace (error / test-code / Tier 2 escalate). Drop the
    //      original and enqueue a dedicated Final Verification (priority
    //      1000) when `appendFinalVerification` allows. The original's role
    //      was "apply fixes (or install+plan for test-code) then hand off";
    //      after splitting, sub-tasks own the work and the Final Verification
    //      (existing or newly-enqueued) owns gates. Keeping an error parent
    //      around led to the `firm-jolting-horse` regression (type=error +
    //      role=gate produced an execute prompt asking for a fresh
    //      remediation plan with no memory of the sub-tasks' edits).
    //
    // Both paths capture the same Session snapshot so verification cycle
    // state (batchSplitCount / planHistory / prevDiagnostics) carries to
    // the follow-up verification entry. For Path B parents without a
    // session (e.g. test-code), `snapshotFromState` returns `undefined` and
    // the requeue / resumeState channel is a no-op.
    const snapshot = snapshotFromState(state);
    // Tier 2 escalate candidates (no policy entry) always take Path B — their
    // inline verification role is replaced by the enqueued Final Verification.
    const effectiveKind: 'requeue-parent' | 'drop-and-replace' =
      taskPolicy?.kind ?? 'drop-and-replace';
    if (effectiveKind === 'requeue-parent') {
      // Path A — preserve the original task's identity & retry budget.
      const requeuedTask: CodeTask = {
        ...nextTask,
        timing: undefined,
        interrupted: !!snapshot ? true : undefined,
        _failed: undefined,
        _failureReason: undefined,
        resumeState: snapshot ?? undefined,
      } as CodeTask;
      state.taskQueue.push(requeuedTask);
    } else {
      // Path B — drop-and-replace with a dedicated Final Verification.
      // Dedup: if a Final Verification is already queued / running /
      // completed (Tier 3/4 decompose emits one; nested splits may have
      // already enqueued), skip to avoid double-gating. `onTaskComplete`
      // on error tasks has the symmetric fallback.
      const shouldAppendFV = taskPolicy?.appendFinalVerification ?? true;
      if (shouldAppendFV) {
        const alreadyHasFinalVerification = hasFinalVerification(
          state.taskQueue.getAll(),
          [],
          state.completedTasksDetails ?? [],
        );
        if (!alreadyHasFinalVerification) {
          const techTiers: TechTier[] = [
            state.resolvedAction?.basis?.techTier?.frontend,
            state.resolvedAction?.basis?.techTier?.backend,
          ].filter((t): t is TechTier => !!t);
          const verificationTask: CodeTask = {
            id: `final-verification-batch-split-${Date.now()}`,
            name: `Final Verification (batch-split of "${nextTask.name}")`,
            type: 'verification',
            priority: TASK_PRIORITIES.FINAL_VERIFICATION,
            description: `Verify that the batch-split sub-tasks of "${nextTask.name}" resolved the diagnosed issues.`,
            techTiers,
            resumeState: snapshot ?? undefined,
          };
          state.taskQueue.push(verificationTask);
        }
      }
    }
    // `_batchSplitRequeued` semantics: "this plan cycle is handed off to
    // newly-enqueued tasks; do NOT mark the current task as completed in
    // checkTaskStatus." Applies to both paths — path A re-queues the
    // original so the current cycle shouldn't mark it complete; path B
    // drops the original, which likewise must not be recorded as complete.
    state._batchSplitRequeued = true;
    appendTrace({
      node: 'plan',
      taskId: nextTask.id,
      taskType: nextTask.type,
      extra: {
        flagSet: ['_batchSplitRequeued'],
        batchCount: parsed.batches.length,
        splitCount,
      },
    });

    logBatchSplit({
      action: 'created',
      batchCount: parsed.batches.length,
      totalErrors: parsed.diagnostics?.totalErrors ?? 0,
      rootCauses: parsed.diagnostics?.rootCauses?.length ?? 0,
      subTaskIds,
      taskQueueSize: state.taskQueue.size(),
      taskName: nextTask.name,
      parentType: nextTask.type,
      subType: taskPolicy?.subType ?? nextTask.type,
      kind: effectiveKind,
      hasFileOverlap,
      splitCount,
    });
    return '';
  } catch (err) {
    // T8 — `VerificationTerminalError('batch_cycle_limit')` must propagate to
    // `TaskOrchestrator.reportFailure` unchanged; the catch below is a best-
    // effort guard around JSON.parse / env coercion that would otherwise
    // swallow the terminal signal and silently re-queue the task.
    if (err instanceof VerificationTerminalError) {
      throw err;
    }
    logBatchSplit({ action: 'skipped', reason: 'json_parse_error', error: (err as Error).message, planTextPreview: planText.substring(0, 120), taskName: nextTask.name });
    return planText;
  }
}
