/**
 * nodes/checkTaskStatus/workerIndex.ts — worker subgraph checkTaskStatus node
 *
 * Ported verbatim from `parallel/workerGraph.ts` L31~L251 (T6b-γ). The
 * violation-building logic is shared with the main graph via `evaluate.ts`
 * (which also dispatches to `hooksIfActive(state)?.check?.evaluate` for
 * task-type-specific completion judgement). The worker-specific bits —
 * `_taskCompleted` / `_batchSplitCompleted` signalling, skipped Kanban /
 * checkpoint (handled by `TaskOrchestrator.reportCompletion`) — stay
 * here.
 *
 * R1 — zero `task.type === '...'` comparisons in this file.
 */

import type { ArchitectGraphState, EnforcementFeedback } from '../../state';
import { TaskTimingHelper } from '../../state';
import { evaluateTaskStatus } from './evaluate';

export async function workerCheckTaskStatus(
  state: ArchitectGraphState,
): Promise<Partial<ArchitectGraphState>> {
  // Increment recursion count
  state.recursionCount = (state.recursionCount || 0) + 1;

  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const workerId = state.workerId ?? 0;
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority,
    } : undefined;
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'checkTaskStatus',
      workerId,
      taskInfo,
      undefined,
      state.recursionCount,
      state.recursionLimit,
    );
  }

  // Build violations from CURRENT state only (same fix as main graph).
  // Do NOT inherit state.violations — they contain stale violations from enforce→plan cycle.
  const { violations, stopRequested, batchSplitRequeued } = await evaluateTaskStatus(state, {
    logPrefix: 'Worker checkTaskStatus',
  });

  // ✅ CRITICAL: Check if user has requested a stop before marking task as completed.
  // Without this check, a task can be marked "completed" even when the user cancelled
  // the job mid-execution, because checkTaskStatus only looked at violations.
  if (stopRequested) {
    console.log(`🛑 [Worker checkTaskStatus] User stop requested — NOT marking task as completed`);
    if (state.deps?.workflowUpdate && state._httpJobId) {
      const workerId = state.workerId ?? 0;
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
    }
    return {
      _taskCompleted: false,
      violations: [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    } as any;
  }

  // Batch split: original task was re-enqueued — skip completion marking.
  // Sub-tasks and re-enqueued verification are already in the shared taskQueue
  // (pushed by processDiagnosticBatchSplit). The orchestrator's broadcastKanban
  // in reportCompletion will pick them up once the worker graph finishes.
  if (batchSplitRequeued) {
    const workerId = state.workerId ?? 0;
    // Count pending sub-tasks for the log line. Batch split currently
    // always emits error sub-tasks (see `plan/index.ts processDiagnosticBatchSplit`),
    // but the log is intentionally type-blind — adding a new batch-split
    // producer later should not require a change here.
    const pendingSubTasks = state.taskQueue?.getAll().filter((t: any) => !t.completed) || [];
    console.log(`📋 [Worker ${workerId} checkTaskStatus] Batch split completed: ${pendingSubTasks.length} sub-task(s) pending, original task re-enqueued`);

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
    }
    return {
      _taskCompleted: false,       // NOT completed — task is re-enqueued (back in todo)
      _batchSplitCompleted: true,  // Signal TaskWorker to release slot via reportBatchSplit()
      currentTask: undefined,
      violations: [],
      _batchSplitRequeued: false,
      _executeCallIndex: 0,
      planText: '',
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    } as any;
  }

  const hasViolations = violations.length > 0;

  // Workflow exit (await to ensure broadcast completes before next node's enterNode)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const workerId = state.workerId ?? 0;
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
  }

  if (!hasViolations && state.currentTask) {
    // Task succeeded — use _currentTaskTokenUsage as single source of truth.
    // _currentTaskTokenUsage already accumulated ALL plan + execute calls via
    // accumulateTokenUsage({ taskLevel: true, jobLevel: true }) in each node.
    // No additional merge or job-level re-accumulation needed here.
    const { getTaskTokenUsage } = await import('../../../../../common/graph/llmHelpers');
    const taskTokenUsage = getTaskTokenUsage(state);

    const completedTask = TaskTimingHelper.completeTask(state.currentTask, taskTokenUsage);
    console.log(`✅ [Worker] Task "${completedTask.name}" completed!`);

    // Log task_complete to debug/logs/
    if (state.context?.featurePath && state._httpJobId) {
      const { getExecutionLogger } = await import('../../../../../../core/utils/executionLogger');
      const execLogger = getExecutionLogger({
        featurePath: state.context.featurePath,
        jobId: state._httpJobId,
        jobType: 'code',
      });
      execLogger.logTaskComplete(completedTask.id, {
        taskName: completedTask.name,
        elapsedMs: completedTask.timing?.elapsedTime || 0,
        inputTokens: completedTask.tokenUsage?.inputTokens || 0,
        outputTokens: completedTask.tokenUsage?.outputTokens || 0,
        cacheReadTokens: completedTask.tokenUsage?.cacheReadTokens || 0,
        cacheCreationTokens: completedTask.tokenUsage?.cacheCreationTokens || 0,
        llmCallCount: completedTask.tokenUsage?.callCount ?? 0,
      }).catch(() => {});
    }

    return {
      currentTask: completedTask as any,
      _taskCompleted: true,
      retries: 0,
      violations: [],
      conversations: {},
      planText: '',
      _executeCallIndex: 0,
      _finalTaskLoopCount: 0,
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    } as any;
  }

  // SSOT: task hook declares `isRetryable`; filter down to retryable here.
  const retryableViolations = violations.filter(v => v.isRetryable === true);

  // All non-retryable → clear violations, signal retry intent if the same
  // task is alive (defence-in-depth against handleFreshTaskEntry fallthrough).
  if (retryableViolations.length === 0) {
    console.log(`✅ [Worker checkTaskStatus] All violations non-retryable (warnings only)`);
    return {
      _taskCompleted: false,
      violations: [],
      _nextPlanEntry: state.currentTask ? ('retry' as const) : undefined,
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    } as any;
  }

  // Append enforcement feedback for learn-phase lesson extraction.
  const feedback: EnforcementFeedback = {
    taskId: state.currentTask?.id || 'unknown',
    taskName: state.currentTask?.name || 'Unknown Task',
    attemptNumber: (state.retries || 0) + 1,
    violations: retryableViolations,
    fixStrategy: 'retry',
    timestamp: Date.now(),
  };
  const enforcementHistory = [...(state.enforcementHistory || []), feedback];

  // Task has retryable violations — propagate to plan for retry.
  // `state.retries += 1` is owned by `plan/handleRetryEntry`.
  return {
    violations: retryableViolations,
    enforcementHistory,
    _nextPlanEntry: 'retry' as const,
    _taskCompleted: false,
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
  } as any;
}
