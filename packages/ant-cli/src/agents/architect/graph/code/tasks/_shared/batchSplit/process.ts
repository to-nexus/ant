import type { TechTier } from '@ant/shared';
import { ARTIFACT_PREFIX } from '@ant/shared';
import { ArchitectGraphState, TASK_PRIORITIES, TaskTimingHelper } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import { snapshotFromState } from '../../../parallel/TaskWorker';
import { appendTrace } from '../../../../../../../utils/verificationTrace';
import { VerificationTerminalError } from '../verify/terminal/errors';
import { VerificationBudget } from '../verify/terminal/budget';
import { isVerificationTask } from '../../verification';
import { getExecutionLogger } from '../../../../../../../core/utils/executionLogger';
import { stripMarkdownFences } from './parse';
import { computeBatchFileOverlap } from './overlap';
import { hasFinalVerification } from './finalVerification';
import { MAX_BATCH_SPLIT_CYCLES } from './cycleLimit';
import {
  BATCH_SPLIT_POLICY,
  diagnosticBatchShape,
} from './policy';
import { BatchSplitSchemaViolation } from './schemaViolation';

/**
 * Detect an LLM-explicit fan-out plan and spawn the sub-tasks.
 *
 * LLM-explicit only: fan-out fires if and only if `parsed.batches[]` is
 * present and non-empty. Flat `implementation` blocks (modify/create/delete
 * at the top level) are NEVER auto-converted — the plan flows through to
 * execute as a single task regardless of entry count, package count, or
 * domain count. The splitting principle is taught to the LLM via the
 * shared partial `templates/jobs/code/shared/task-split-rubric.md` (used
 * by both decompose and plan).
 *
 * Hard cap: `MAX_BATCH_SPLIT_CYCLES`. After the cap, marks the task with
 * `_failed`/`_failureReason` (surfaced via the kanban tooltip channel)
 * and throws `VerificationTerminalError('batch_cycle_limit')`.
 *
 * @returns updated planText (`''` when fan-out fired, original otherwise).
 */
export function processDiagnosticBatchSplit(
  state: ArchitectGraphState,
  planText: string,
  nextTask: CodeTask,
): string {
  // Tier 2 escalate (no policy entry) hijacks the gate — `selfVerifyOnDone`
  // tasks are dropped and the queue is morphed into the Tier 3 shape
  // (N sub-tasks + 1 Final Verification).
  const isTier2EscalateCandidate =
    state.executionTier === 2 &&
    (nextTask as { selfVerifyOnDone?: boolean }).selfVerifyOnDone === true;
  const taskPolicy = BATCH_SPLIT_POLICY[nextTask.type];
  const isBatchSplitCandidate = !!taskPolicy || isTier2EscalateCandidate;

  const logBatchSplit = (data: Record<string, any>) => {
    if (state.context?.featurePath && state._httpJobId) {
      void getExecutionLogger({
        featurePath: state.context.featurePath,
        jobId: state._httpJobId,
        jobType: 'code',
      })
        .log('batch_split', data, nextTask.id)
        .catch(() => { /* non-blocking */ });
    }
  };

  if (!isBatchSplitCandidate) {
    return planText;
  }
  if (!planText || planText.length <= 50) {
    // For a verification task, an empty plan flips `done:true` via
    // `isVerificationPassWithoutCodeGen`. Surface that distinction so the
    // log isn't mistaken for a "gave up" signal.
    const isVerification = isVerificationTask(nextTask);
    logBatchSplit({
      action: 'skipped',
      reason: 'plan_too_short',
      planTextLen: planText?.length ?? 0,
      taskName: nextTask.name,
      parentType: nextTask.type,
      isVerification,
      nextOutcome: isVerification
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

    const modifyArr: any[] = Array.isArray(parsed.implementation?.modify) ? parsed.implementation.modify : [];
    const createArr: any[] = Array.isArray(parsed.implementation?.create) ? parsed.implementation.create : [];
    const deleteArr: any[] = Array.isArray(parsed.implementation?.delete) ? parsed.implementation.delete : [];
    const hasExistingBatches = Array.isArray(parsed.batches) && parsed.batches.length > 0;
    const topLevelImplCount = modifyArr.length + createArr.length + deleteArr.length;

    // SSOT for fan-out decision is the LLM's explicit `batches[]`. A flat
    // `implementation` block — regardless of entry count, package count, or
    // domain count — proceeds to execute as a single task. The system never
    // fabricates batches from top-level entries; LLM judgement is the only
    // signal. See `templates/jobs/code/shared/task-split-rubric.md` for the
    // splitting principle taught to both decompose and plan.
    if (!hasExistingBatches) {
      logBatchSplit({
        action: 'skipped',
        reason: 'flat_plan_no_batches',
        topLevelImplCount,
        taskName: nextTask.name,
        parentType: nextTask.type,
      });
      return planText;
    }

    // Validate LLM-authored semantic + scheduling fields on explicit
    // batches[]. name/rationale are required on every shape. The
    // scheduling pair (parallelGroup + priorityInParallelGroup) is
    // optional per batch, but emission is all-or-nothing across the
    // fan-out: either every entry declares both fields, or none does.
    // Whether the LLM emits the pair is the only signal the runtime
    // uses to decide between lane mode and the legacy default — there
    // is no task-type / policy-table check. The prompts for slim-shape
    // types instruct the LLM to emit the pair; other types' prompts
    // do not, so their outputs land in the legacy branch.
    for (let i = 0; i < parsed.batches.length; i++) {
      const b = parsed.batches[i];
      if (!b || typeof b !== 'object' || typeof b.name !== 'string' || b.name.trim() === '') {
        throw new BatchSplitSchemaViolation({
          entryKind: 'batch',
          ordinal: i,
          field: 'name',
          reason: 'missing',
          observed: b,
        });
      }
      if (typeof b.rationale !== 'string' || b.rationale.trim() === '') {
        throw new BatchSplitSchemaViolation({
          entryKind: 'batch',
          ordinal: i,
          field: 'rationale',
          reason: 'missing',
          observed: b,
        });
      }
    }

    // All-or-nothing scheduling-pair validation.
    //
    // A batch is considered "lane-declared" when BOTH `parallelGroup`
    // (non-empty string) and `priorityInParallelGroup` (non-negative
    // integer) are present and valid. Any other state — partial
    // emission, malformed types — is rejected so the LLM cannot
    // accidentally communicate two different schedules in one
    // response. Across the whole fan-out, either every batch is
    // lane-declared or none is.
    const isLaneDeclared = (b: any): boolean =>
      typeof b.parallelGroup === 'string'
      && b.parallelGroup.trim().length > 0
      && typeof b.priorityInParallelGroup === 'number'
      && Number.isInteger(b.priorityInParallelGroup)
      && b.priorityInParallelGroup >= 0;

    const declaredFlags = parsed.batches.map((b: any) => isLaneDeclared(b));
    const allDeclared = declaredFlags.every(Boolean);
    const noneDeclared = declaredFlags.every((d: boolean) => !d);

    if (!allDeclared && !noneDeclared) {
      // Mixed: identify the offending batch and the specific field issue.
      for (let i = 0; i < parsed.batches.length; i++) {
        const b = parsed.batches[i];
        if (declaredFlags[i]) continue; // this one is fine; look at the broken ones
        // Decide which field to surface in the violation. Prefer
        // `parallelGroup` problems first because the LLM keys its lane
        // identity off that field.
        const gMissing = b.parallelGroup === undefined;
        const gBadType = !gMissing && (typeof b.parallelGroup !== 'string' || b.parallelGroup.trim().length === 0);
        if (gMissing || gBadType) {
          throw new BatchSplitSchemaViolation({
            entryKind: 'batch',
            ordinal: i,
            field: 'parallelGroup',
            reason: gMissing ? 'missing' : 'invalid',
            observed: b,
          });
        }
        const rMissing = b.priorityInParallelGroup === undefined;
        throw new BatchSplitSchemaViolation({
          entryKind: 'batch',
          ordinal: i,
          field: 'priorityInParallelGroup',
          reason: rMissing ? 'missing' : 'invalid',
          observed: b,
        });
      }
    }

    const requireLaneSchedule = allDeclared;

    // Within-lane uniqueness: when lane mode is active, every batch in
    // the same `parallelGroup` must have a distinct
    // `priorityInParallelGroup`. A collision is an LLM contract
    // violation — the runtime would have to break the tie with a
    // hidden rule, which defeats the point of declaring the schedule
    // explicitly. Reject and let the plan-node retry channel re-issue
    // with framing.
    if (requireLaneSchedule) {
      const seenInLane = new Map<string, Map<number, number>>();
      for (let i = 0; i < parsed.batches.length; i++) {
        const b = parsed.batches[i];
        const lane: string = (b.parallelGroup as string).trim();
        const rank: number = b.priorityInParallelGroup;
        const lanePriorities = seenInLane.get(lane) ?? new Map<number, number>();
        const prior = lanePriorities.get(rank);
        if (prior !== undefined) {
          throw new BatchSplitSchemaViolation({
            entryKind: 'batch',
            ordinal: i,
            field: 'priorityInParallelGroup',
            reason: 'collision',
            observed: b,
            collidesWith: prior,
            laneName: lane,
          });
        }
        lanePriorities.set(rank, i);
        seenInLane.set(lane, lanePriorities);
      }
    }

    // Cycle counter lives on `task.batchSplitCount` (carried across re-queue
    // via the resumeState snapshot + the explicit field assignment in the
    // Path A / Path B branches below). Pre-bump value so the terminal-throw
    // snapshot below sees the magnitude that the upcoming write will set.
    const splitCount = VerificationBudget.peekNextBatchSplit(state, nextTask);

    if (splitCount > MAX_BATCH_SPLIT_CYCLES) {
      // Surface the terminal cause via the existing `_failureReason` channel —
      // UI already renders this field as a tooltip on the failed task card
      // (see `packages/ant-shared/src/task.ts`). The orchestrator's catch
      // path pushes the task to `failedTasks` with this marking intact.
      // i18n: user-facing label tracks `state.context.userLanguage`, matching
      // the pattern used for the FV task label below.
      const userLanguage = state.context?.userLanguage || 'en';
      const cycleReason = userLanguage === 'ko'
        ? `배치 분할이 ${MAX_BATCH_SPLIT_CYCLES}회 반복되어 자동 중단되었습니다. 작업 "${nextTask.name}"이 같은 계획을 반복 생성하고 있습니다.`
        : `Batch split aborted after ${MAX_BATCH_SPLIT_CYCLES} cycles. Task "${nextTask.name}" kept regenerating the same plan.`;
      (nextTask as { _failed?: boolean })._failed = true;
      (nextTask as { _failureReason?: string })._failureReason = cycleReason;
      logBatchSplit({ action: 'cycle_limit_failed', splitCount, taskName: nextTask.name });
      console.error(`❌ [BatchSplit] Cycle limit (${MAX_BATCH_SPLIT_CYCLES}) exceeded for "${nextTask.name}". Throwing terminal error.`);
      appendTrace({
        node: 'plan',
        taskId: nextTask.id,
        taskType: nextTask.type,
        extra: { reason: 'cycle_limit_terminal', splitCount },
      });
      throw new VerificationTerminalError(
        'batch_cycle_limit',
        `Batch split cycle limit (${MAX_BATCH_SPLIT_CYCLES}) exceeded for "${nextTask.name}" after ${splitCount} cycles.`,
      );
    }

    const hasFileOverlap = computeBatchFileOverlap(parsed.batches);
    // Parent's parallelGroup, if any, becomes the children's group base —
    // siblings of the parent in the same queue may already touch related
    // files, so carrying the parent's group avoids cross-task overlap that
    // sibling-only `computeBatchFileOverlap` cannot see. When the parent
    // has no group, fall back to a fresh per-fan-out group id.
    const inheritedGroup = typeof nextTask.parallelGroup === 'string' && nextTask.parallelGroup.length > 0
      ? nextTask.parallelGroup
      : null;
    const sharedBase = hasFileOverlap
      ? null
      : (inheritedGroup ?? `${nextTask.type}-batch-${Date.now()}`);

    // `rootCauseSelfCheck.mode` propagates to each sub-task; fall back to
    // a heuristic when the LLM did not self-report.
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

    // Bump the batch-split counter on the originating parent task, then
    // carry the cycle count down to children so lineage exhaustion is
    // bounded across recursive fan-outs (parent → child → grandchild).
    // Without carry-over, a non-shortcut child's plan-tool-loop (every
    // `feature` / `ui` / `test-code` kid — only `error` takes the
    // pre-planned shortcut) could emit `batches[]` again with a fresh
    // count of 0 and bypass `MAX_BATCH_SPLIT_CYCLES` indefinitely.
    const newBatchSplitCount = (nextTask.batchSplitCount ?? 0) + 1;

    // Path A re-enqueues the original to preserve identity / `_failedAttempts`;
    // Path B drops it and (optionally) enqueues a Final Verification.
    //
    // Decide BEFORE building sub-tasks so the priority semantics are wired
    // off the parent's `effectiveKind`:
    //   - Path A (requeue-parent)   — sub-task priority = `parent - 1`. Sub-task
    //                                 lands ahead of the still-queued parent so
    //                                 it dequeues first.
    //   - Path B (drop-and-replace) — sub-task priority = `parent`. Parent is
    //                                 gone from the queue; preserving the
    //                                 priority keeps the band classification
    //                                 stable (e.g. foundation parent at 200 →
    //                                 sub-task at 200 stays foundation).
    //
    // Three-Axis SSOT: `band` is carried verbatim from the parent. The
    // legacy `parent - 1` priority was the deadlock root cause — a
    // foundation parent at priority 200 would split into priority-199
    // sub-tasks that the orchestrator's foundation gate (priority-derived)
    // rejected, leaving the queue stuck. Carrying `band` decouples
    // scheduling identity from the priority decrement entirely.
    const effectiveKind: 'requeue-parent' | 'drop-and-replace' =
      taskPolicy?.kind ?? 'drop-and-replace';
    const parentPriority = nextTask.priority || 500;
    const parentBand = nextTask.type === 'feature' ? nextTask.band : undefined;

    // Single source of truth for translating an LLM-emitted batch into
    // the two runtime scheduling axes (`parallelGroup` + `priority`).
    // Both axes share the same three-way gate (overlap path → exclusive,
    // legacy non-slim path → distinct group + parent priority,
    // slim-shape lane path → LLM-authored lane + parent+offset priority);
    // returning them together from one branch tree avoids the
    // duplicate-branch problem that motivated this consolidation.
    const scheduleFor = (i: number, batch: any): {
      parallelGroup: string | undefined;
      priority: number;
    } => {
      let parallelGroup: string | undefined;
      if (sharedBase === null) {
        parallelGroup = undefined;                            // hasFileOverlap → exclusive=true
      } else if (!requireLaneSchedule) {
        parallelGroup = `${sharedBase}-${i}`;                 // existing distinct-per-i path
      } else {
        // batch.parallelGroup already validated as a non-empty string above.
        parallelGroup = `${sharedBase}-${(batch.parallelGroup as string).trim()}`;
      }

      let priority: number;
      if (effectiveKind === 'requeue-parent') {
        priority = Math.max(1, parentPriority - 1);
      } else if (!requireLaneSchedule) {
        priority = parentPriority;
      } else {
        // batch.priorityInParallelGroup already validated as a non-negative integer.
        priority = parentPriority + (batch.priorityInParallelGroup as number);
      }

      return { parallelGroup, priority };
    };

    const subTaskIds: string[] = [];
    for (let i = 0; i < parsed.batches.length; i++) {
      const batch = parsed.batches[i];

      // `selfVerifyOnDone` is intentionally NOT set on sub-tasks — gate
      // responsibility hands off to the Final Verification (Path B) or
      // to the pre-existing FV (Path A).
      const subType: CodeTask['type'] = taskPolicy?.subType ?? nextTask.type;
      const shape = taskPolicy?.shape ?? diagnosticBatchShape;
      const batchPlanText = shape({ parsed, batch, batchIndex: i, planMode });

      // Child task `name` and `description` are LLM-authored verbatim —
      // no system prefix, no synthesis. Scheduling fields
      // (`parallelGroup` / `priority`) are translated from the batch
      // entry by `scheduleFor` — see its comment above for the three
      // dispatch shapes.
      const { parallelGroup, priority } = scheduleFor(i, batch);
      // `include` carry-over: Path B inherits the parent's manifest; Path A
      // (verification parent has none) seeds spec+api-contract so fix-applier
      // sub-tasks keep the context the retired `error` default once supplied.
      const subInclude: string[] | undefined =
        effectiveKind === 'requeue-parent'
          ? [ARTIFACT_PREFIX.SPEC, ARTIFACT_PREFIX.API_CONTRACT]
          : nextTask.include;
      const subTask: CodeTask = {
        id: `${subType}-batch-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        name: batch.name,
        description: batch.rationale,
        type: subType,
        priority,
        prePlanText: batchPlanText,
        exclusive: hasFileOverlap,
        parallelGroup,
        batchSplitCount: newBatchSplitCount,
        // `stack` is carried over verbatim from the parent in BOTH paths
        // (like `band`) so per-task tech-tier narrowing survives the split.
        ...(nextTask.stack ? { stack: nextTask.stack } : {}),
        ...(subInclude?.length ? { include: subInclude } : {}),
        ...(subType === 'feature' ? { band: parentBand } : {}),
        // `renderable` mirrors createTaskQueue's derivation across the split:
        // a `ui` sub-task always renders; a `feature` sub-task inherits the
        // parent's renderable verdict (the split cannot re-derive ui-pairing,
        // and the sub-tasks continue the parent's rendered work). Other sub
        // types (error fix-appliers) never render. Without this the SV session
        // body-lifecycle gate goes dark on a Tier-2 escalate / Path-B split.
        ...(subType === 'ui' || (subType === 'feature' && nextTask.renderable === true)
          ? { renderable: true }
          : {}),
      } as CodeTask;
      if (taskPolicy?.populateRemediationMode !== false) {
        (subTask as { remediationMode?: 'patch' | 'upstream' | 'refactor' }).remediationMode = planMode;
      }
      state.taskQueue.push(subTask);
      subTaskIds.push(subTask.id);
    }

    // `snapshotFromState(state)` is taken inside the Path A branch only —
    // Path B spawns a NEW Final Verification with `resumeState: undefined`
    // (raw-clinging-beach regression guard), so carrying the parent's
    // conversation snapshot here would be dead state. Keeping the call
    // site inside the branch that consumes it makes the data flow obvious.
    if (effectiveKind === 'requeue-parent') {
      const snapshot = snapshotFromState(state);
      // Carry the parent's accumulated timing across the re-queue so the
      // wall-clock window between split and re-pick counts as paused (not
      // active). `pauseTask` marks `pausedAt = now`; the next `assignTask`
      // / fresh-entry path that calls `TaskTimingHelper.startTask` will
      // accumulate the gap into `totalPausedDuration` and clear `pausedAt`.
      // Without this, the requeued parent restarts its timer from zero
      // and its pre-split runtime (which is real LLM work) disappears
      // from `task.timing.elapsedTime` at the eventual `completeTask`.
      const carriedTiming = TaskTimingHelper.pauseTask(nextTask).timing;
      // Stash the in-flight task-level token usage onto the requeued task
      // so the next `handleFreshTaskEntry` can seed `_currentTaskTokenUsage`
      // from `task.tokenUsage`. Re-using the existing `BaseTask.tokenUsage`
      // field avoids a parallel "carriedTokenUsage" channel — the meaning is
      // identical ("LLM tokens this task has used so far"). Job-level
      // `state.tokenUsage` is unaffected; it has been accumulating since
      // the job started and the carry is task-scoped only.
      const carriedTokenUsage = state._currentTaskTokenUsage
        ? { ...state._currentTaskTokenUsage }
        : nextTask.tokenUsage;
      const requeuedTask: CodeTask = {
        ...nextTask,
        ...(carriedTiming ? { timing: carriedTiming } : {}),
        ...(carriedTokenUsage ? { tokenUsage: carriedTokenUsage } : {}),
        interrupted: !!snapshot ? true : undefined,
        _failed: undefined,
        _failureReason: undefined,
        resumeState: snapshot ?? undefined,
        batchSplitCount: newBatchSplitCount,
      } as unknown as CodeTask;
      state.taskQueue.push(requeuedTask);
      // Clear keyword-RAG dedup so the parent's next plan entry re-fires
      // keyword RAG (vast-curling-perch D-0). Lazy-required to keep the
      // batchSplit module free of plan-layer imports at module init time.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { clearKeywordDedupForTask } = require('../../../nodes/plan/rag');
        clearKeywordDedupForTask(nextTask.id);
      } catch { /* non-blocking */ }
    } else {
      // Path B — the parent disappears from the queue. Capture its
      // lifetime accounting (timing + tokens) into a superseded snapshot
      // so it still surfaces as its own row in `completedTasksDetails`
      // and the kanban tooltip's "Tasks (N): … parent (Xs / Y tokens)"
      // entry. `completeTask` snapshots `_currentTaskTokenUsage` onto
      // `task.tokenUsage` and computes `timing.elapsedTime` from
      // `startedAt + totalPausedDuration` (state.ts:681-700). The
      // `supersededBy` array marks lineage and (via truthy check) lets
      // UI distinguish superseded entries from regular completions; the
      // entry stays out of `state.completedTasks` (string[]) so the
      // "X / Y completed" counter is unaffected.
      const supersededParent = TaskTimingHelper.completeTask(
        nextTask,
        state._currentTaskTokenUsage,
      );
      (supersededParent as CodeTask).supersededBy = [...subTaskIds];
      // Drop `completed:true` set by `completeTask` — superseded items
      // are NOT regular completions; we keep the timing/token snapshot
      // but signal lineage via `supersededBy` only. Without this, UI
      // surfaces (`completedTasks.length`, "completed" badges) would
      // mistakenly count the parent.
      (supersededParent as CodeTask).completed = false;
      state._supersededByBatchSplit = [
        ...(state._supersededByBatchSplit ?? []),
        supersededParent,
      ];

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
          // Path B spawns a NEW verification task (different id from the
          // dropped parent) — it must enter with a fresh conversation so the
          // `variants/verification/base.md` template is rendered (incl. the
          // `priorErrorTasks` block that surfaces completed error sub-tasks).
          //
          // Attaching `snapshot` here would carry the parent error task's
          // `conversations` (started from `variants/error/base.md`) into the
          // new FV. Combined with `task.interrupted=true` later being set
          // by `saveCheckpoint` / `captureWorkerSnapshots`, the worker's
          // restore gate (`task.interrupted && task.resumeState`) would
          // re-load that parent conversation and the FV would re-investigate
          // the same error from scratch (raw-clinging-beach regression).
          //
          // Path A above (`requeue-parent`) re-uses the SAME task id, so
          // carrying the snapshot is the intended behavior there.
          // i18n the FV task label — these strings surface in the kanban as
          // user-facing text. Match the response-language policy in
          // `jobs/code/base/injections/response-language.md`: user-facing
          // labels follow the user's detected language, code identifiers
          // stay English. `userLanguage` may be `'en'`, `'ko'`, or any
          // BCP-47 tag; only 'ko' has an explicit translation today, all
          // other non-en values fall through to English (the LLM-generated
          // siblings will still respect the user language because the
          // partial fires for them via {{userLanguage}}).
          const userLanguage = state.context?.userLanguage || 'en';
          const fvLabels = userLanguage === 'ko'
            ? {
                name: `최종 검증 (배치 분할: "${nextTask.name}")`,
                description: `"${nextTask.name}"의 배치 분할 하위 태스크들이 진단된 문제들을 해결했는지 검증합니다.`,
              }
            : {
                name: `Final Verification (batch-split of "${nextTask.name}")`,
                description: `Verify that the batch-split sub-tasks of "${nextTask.name}" resolved the diagnosed issues.`,
              };
          const verificationTask: CodeTask = {
            id: `final-verification-batch-split-${Date.now()}`,
            name: fvLabels.name,
            type: 'verification',
            priority: TASK_PRIORITIES.FINAL_VERIFICATION,
            description: fvLabels.description,
            techTiers,
            resumeState: undefined,
            batchSplitCount: newBatchSplitCount,
          };
          state.taskQueue.push(verificationTask);
        }
      }
    }
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
      wasTier2: state.executionTier === 2,
    });
    return '';
  } catch (err) {
    // T8 — `VerificationTerminalError` must propagate; only swallow JSON-
    // parse / coercion errors that would otherwise lose the terminal signal.
    // `BatchSplitSchemaViolation` also propagates so the plan-node retry
    // loop (decompose's `ExecutionTierViolation` pattern, ported) can
    // re-issue the LLM call with violation framing.
    if (err instanceof VerificationTerminalError) {
      throw err;
    }
    if (err instanceof BatchSplitSchemaViolation) {
      throw err;
    }
    logBatchSplit({ action: 'skipped', reason: 'json_parse_error', error: (err as Error).message, planTextPreview: planText.substring(0, 120), taskName: nextTask.name });
    return planText;
  }
}
