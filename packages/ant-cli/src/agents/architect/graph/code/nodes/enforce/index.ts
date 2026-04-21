/**
 * Enforce Node
 *
 * Pure routing gate between violation discovery (checkTaskStatus) and Plan
 * re-entry:
 *   1. Reads `violation.isRetryable` (SSOT declared by each task hook's
 *      `check.evaluate`) and splits into retryable vs warning-only.
 *   2. If nothing is retryable, clears `violations` and, when the current
 *      task is still alive, signals `_nextPlanEntry: 'retry'` so Plan does
 *      NOT fall through to `handleFreshTaskEntry` (which would emit a
 *      duplicate `task_start` event and reset token counters).
 *   3. Otherwise increments `state.retries`, appends an
 *      `EnforcementFeedback` entry for learn-phase lesson extraction, and
 *      forwards all retryable violations — grouping and root-cause
 *      selection are the Plan LLM's responsibility (see
 *      `templates/.../plan/variants/verification/rules.md`).
 *
 * The two `special formatter` branches (`cross_worker_conflict`,
 * `file_operation_failed`) are presentation-only: they substitute the
 * generic `formatViolations` output with a concise, actionable message.
 * Neither branch changes routing behavior.
 */

import { ArchitectGraphState, Violation, EnforcementFeedback } from "../../state";
import { formatViolations } from "../../utils/violationFormatter";

export async function enforce(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  state.recursionCount = (state.recursionCount || 0) + 1;

  const { traceNodeEntry } = await import('../../../../../../utils/verificationTrace');
  traceNodeEntry('enforce', state.currentTask ?? undefined);

  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'enforce',
      state.workerId ?? 0,
      taskInfo,
      undefined,
      state.recursionCount,
      state.recursionLimit
    );
  }

  const violations: Violation[] = state.violations || [];

  console.log(`\n⚠️  ENFORCEMENT triggered (retry ${state.retries + 1}/${state.maxRetries})`);
  console.log(`   Violations: ${violations.length}`);

  // SSOT: each task hook declares whether a violation can be resolved via
  // regeneration. Enforce reads the flag and routes — it never re-judges
  // retryability based on score / retry count.
  const retryableViolations = violations.filter(v => v.isRetryable === true);
  console.log(`   Retryable: ${retryableViolations.length}/${violations.length}\n`);

  if (retryableViolations.length === 0) {
    console.log('✅ No retryable violations — warnings/info only. Returning to plan.\n');

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'enforce', state.workerId ?? 0);
    }

    // Defense-in-depth: when `currentTask` is still set, the same task is
    // alive — treat this as a `retry` re-entry so plan does NOT fall into
    // `handleFreshTaskEntry`, which would emit a duplicate `task_start`
    // event, reset token counters, and inflate the cycle count.
    return {
      ...state,
      violations: [],
      _nextPlanEntry: state.currentTask ? ('retry' as const) : undefined,
    };
  }

  let formattedViolations = formatViolations(retryableViolations);

  const errorType = retryableViolations[0]?.type;

  if (errorType === 'cross_worker_conflict') {
    const conflictFiles = retryableViolations
      .map(v => v.file)
      .filter(Boolean);
    const fileList = conflictFiles.map(f => `  - ${f}`).join('\n');

    formattedViolations = `
🚨 CROSS-WORKER FILE CONFLICT

Another parallel task already created these files:
${fileList}

⛔ DO NOT use <file> tag to overwrite these files directly.

✅ REQUIRED (2 steps):
1. Call read_file("path") to get the CURRENT content and version
2. Then EITHER:
   a. Use <file path="path"> with MERGED content (full rewrite)
   b. Use edit_file tool to partially modify
`;
  } else if (errorType === 'file_operation_failed') {
    const searchBlockErrors = retryableViolations.filter(v =>
      v.message.includes('Search block not found') ||
      v.message.includes('Duplicate edit')
    );

    if (searchBlockErrors.length > 0) {
      const files = searchBlockErrors
        .map(v => v.file)
        .filter(Boolean)
        .join(', ');

      formattedViolations = `
🚨 PREVIOUS ATTEMPT FAILED: ${searchBlockErrors.length} file edit error(s)

Files: ${files}

REASON: Search block mismatch (outdated content)

✅ REQUIRED FIX (2 steps):
1. Call read_file("path") to get CURRENT content
2. Use EXACT old_str from read_file result in edit_file tool
`;
    }
  }

  console.log(`\n📋 Violation Summary:\n${formattedViolations}\n`);

  const feedback: EnforcementFeedback = {
    taskId: state.currentTask?.id || 'unknown',
    taskName: state.currentTask?.name || 'Unknown Task',
    attemptNumber: state.retries + 1,
    violations: retryableViolations,
    fixStrategy: 'retry',
    timestamp: Date.now()
  };

  const enforcementHistory = [...(state.enforcementHistory || []), feedback];

  console.log('💾 Enforcement feedback saved for lesson extraction');
  console.log('📨 Passing violations to Plan node for strategy decision...\n');

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'enforce', state.workerId ?? 0);
  }

  return {
    ...state,
    violations: retryableViolations,
    violationMessage: formattedViolations,
    retries: state.retries + 1,
    lastViolations: retryableViolations,
    enforcementHistory,
    _nextPlanEntry: 'retry' as const,
  };
}
