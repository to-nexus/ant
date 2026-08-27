/**
 * Design Job Worker Subgraph Builder
 *
 * Builds a LangGraph StateGraph for a single design task execution
 * within a TaskWorker. This is a lighter version of the main design
 * graph that handles only the task execution lifecycle.
 *
 * Flow: plan → execute ↔ tool → workerCheckTaskStatus → workerLearn → END
 *
 * Design tasks don't have enforce nodes.
 * The includeInstallValidate parameter is accepted for API compatibility
 * with WorkerGraphBuilder but has no effect for design tasks.
 */

import { Annotation, StateGraph } from '@langchain/langgraph';
import type { DesignGraphState } from '../state';
import { DesignGraphChannels } from '../graph';
import { plan } from '../nodes/plan';
import { execute } from '../nodes/execute/index';
import { tool } from '../nodes/tool';
import path from 'node:path';
import { learn } from '../nodes/learn';
import type { WorkerGraphBuilder } from '../../../../common/graph/parallelTypes';
import { routeAfterExecute } from '../routers/executeRouter';
import { routeAfterPlan, routeAfterTool } from '../routing';
import { FigmaMCPConnectionError } from '../../../../../periphery/adapters/figma/errors';
import { withPhaseTracking } from '../../../../common/graph/llmHelpers';
import { designDirOf } from '@ant/shared';
import { getExecutionLogger } from '../../../../../core/utils/executionLogger';
import { CONV_KEYS, getConv } from '../../../../common/graph/conversations';
import { validateAssetReferences, buildAssetRetryMessage, isAssetTask } from '../nodes/checkTaskStatus/assetValidation';
import { reconcileSpecDoc, buildSpecRevisionRetryMessage } from '../nodes/checkTaskStatus/specDocIntegrity';
import { isNoOutputCompletion, buildDesignNoOutputInterruption } from '../nodes/checkTaskStatus/outputVerification';
import {
  isHandoffBundleTask,
  validateTaskBundleCoherence,
  buildBundleCoherenceRetryMessage,
} from '../nodes/checkTaskStatus/bundleCoherence';
import { DesignNoOutputError } from '../errors';

const INTERNAL_MARKER_RE = /\n?<!-- (?:SECTION_PATTERN|LAST_SECTION)[^>]*-->\s*/g;

/**
 * Check task status within a design worker subgraph.
 *
 * Validation gates (parity with code job checkTaskStatus):
 * 0.   _isStopRequested → return without completing (user-initiated stop)
 * 1.   _figmaConnectionLost → throw FigmaMCPConnectionError (global interrupt)
 * 2.   fileErrors → throw (incomplete file operations detected)
 * 3.   Normal completion → mark task as completed
 *
 * Note: the historical "Gate 1: Call budget exhausted" was retired along with
 * the code job's Safety Net D/E. Runaway execute loops are bounded by LangGraph
 * `recursionLimit`; non-productive streaks are signaled to the LLM via the
 * advisory warnings in `nodes/execute/index.ts`.
 */
async function workerCheckTaskStatus(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
  // ✅ Increment recursion count (per-worker, track node execution for UI gauge)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  const workerId = state.workerId ?? 0;
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority,
    } : undefined;
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 'checkTaskStatus', workerId, taskInfo,
      undefined, state.recursionCount, state.recursionLimit
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Gate 0: User stop requested — do NOT mark task as completed
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const isStopRequested = typeof state._isStopRequested === 'function'
    ? state._isStopRequested()
    : false;

  if (isStopRequested) {
    console.log(`🛑 [Design Worker checkTaskStatus] User stop requested — NOT marking task as completed`);
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
    }
    return {
      _taskCompleted: false,
      violations: [],
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    } as any;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Gate 1: Figma MCP connection lost — global interrupt via TaskOrchestrator
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state._figmaConnectionLost && state.currentTask) {
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
    }
    throw new FigmaMCPConnectionError(
      `Figma MCP connection lost (${state._figmaConsecutiveErrors || 0} failures) for "${state.currentTask.name}"`
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Gate 2: File operation errors — fail task
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.fileErrors && state.fileErrors.length > 0 && state.currentTask) {
    console.error(`❌ [workerCheckTaskStatus] ${state.fileErrors.length} file error(s) for "${state.currentTask.name}":`);
    for (const err of state.fileErrors) {
      console.error(`   - ${err.substring(0, 200)}`);
    }
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
    }
    
    throw new Error(
      `Task "${state.currentTask.name}" had ${state.fileErrors.length} file operation error(s): ${state.fileErrors[0].substring(0, 200)}`
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Gate 2.5: Asset validation (WS2 §1d — parallel-path parity)
  // Mirror of the serial `checkTaskStatus` asset gate. game-art decompose is
  // always `parallelGroup`, so WITHOUT this gate the D20/D21/I6 checks never
  // ran under the default concurrency > 1 — dangling srcs + over-complex inline
  // payloads shipped silently. Same shared helper; same 2-retry re-prompt, then
  // proceed. Routes back to execute via `routeAfterWorkerCheckTaskStatus`.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.currentTask && isAssetTask(state.currentTask.id) && (state._assetValidationRetried || 0) < 2) {
    const validation = await validateAssetReferences(state.context.featurePath, state.currentTask.id);
    if (!validation.valid) {
      console.warn(`⚠️  [Worker checkTaskStatus] Asset validation failed: ${validation.missingFiles.length} missing/illegal src, ${validation.inlineViolations.length} inline-ceiling violation(s)`);
      const retryMessage = {
        role: 'user' as const,
        content: buildAssetRetryMessage(validation, state.currentTask.id),
      };
      if (state.deps?.workflowUpdate && state._httpJobId) {
        await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
      }
      return {
        conversations: { [CONV_KEYS.NODE_EXECUTE]: [...getConv(state.conversations, CONV_KEYS.NODE_EXECUTE), retryMessage] },
        _assetValidationFailed: true,
        _assetValidationRetried: (state._assetValidationRetried || 0) + 1,
        _executeCallIndex: 0,
        _noOutputCallCount: 0,
        _drainSalvageTools: null,
        _taskCompleted: false,
        recursionCount: state.recursionCount,
        recursionLimit: state.recursionLimit,
      } as any;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Gate 2.6: Design-doc reconcile (mirror of the serial gate).
  // generate: duplicate-root heal. refactor: revision-preservation gate —
  // unsanctioned section loss rolls the original back and re-prompts execute
  // (retry authority = violation.isRetryable, cap 2). At the cap, completion
  // proceeds with the restored original (fail-open).
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.currentTask && state.deps?.fileSystem && state.context?.featurePath) {
    const reconcile = await reconcileSpecDoc(
      state.deps.fileSystem as any,
      state.context.featurePath,
      state.currentTask as any,
      state.resolvedAction?.mode || 'generate',
      {
        planText: state.planText,
        directive: state.overrideDirective || state.directive,
        logPrefix: 'workerCheckTaskStatus',
      },
    );
    if (reconcile.violation?.isRetryable === true) {
      if ((state._specRevisionRetried || 0) < 2) {
        const retryMessage = {
          role: 'user' as const,
          content: buildSpecRevisionRetryMessage(
            reconcile.violation.missingHeadings,
            state.currentTask.targetFile || '',
          ),
        };
        if (state.deps?.workflowUpdate && state._httpJobId) {
          await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
        }
        return {
          conversations: { [CONV_KEYS.NODE_EXECUTE]: [...getConv(state.conversations, CONV_KEYS.NODE_EXECUTE), retryMessage] },
          _specRevisionFailed: true,
          _specRevisionRetried: (state._specRevisionRetried || 0) + 1,
          _executeCallIndex: 0,
          _noOutputCallCount: 0,
          _drainSalvageTools: null,
          _taskCompleted: false,
          recursionCount: state.recursionCount,
          recursionLimit: state.recursionLimit,
        } as any;
      }
      console.warn(
        `⚠️  [Worker checkTaskStatus] Revision preservation retry limit reached (${state._specRevisionRetried}). ` +
        `Completing with the restored pre-revision original — the directive's delta was NOT applied.`,
      );
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Gate 2.7: Zero-output completion guard (design_no_output).
  // A degenerate/drained execute that landed no file write and left its target
  // absent must fail loud (resumable) — not complete as a phantom success.
  // Thrown as a typed error so the shared TaskOrchestrator raises the
  // interruption (mirror of the figma-connection-lost global interrupt).
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (
    state.currentTask &&
    (await isNoOutputCompletion(
      state.deps?.fileSystem as any,
      state.context?.featurePath,
      state.currentTask as any,
      state._taskFilesWritten,
    ))
  ) {
    console.error(
      `❌ [workerCheckTaskStatus] "${state.currentTask.name}" produced no output ` +
      `(target "${state.currentTask.targetFile}" absent/empty) — raising resumable design_no_output pause.`,
    );
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
    }
    throw new DesignNoOutputError(
      buildDesignNoOutputInterruption(state.currentTask, {
        callIndex: state._executeCallIndex || 0,
        completedCount: (state.completedTasks || []).length,
        tasksRemaining: state.taskQueue?.size() || 0,
      }),
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Gate 2.8: Handoff bundle name-binding coherence (mirror of the serial gate).
  // Runs AFTER the zero-output guard so a task that wrote nothing raises
  // design_no_output instead. generate mode only — a hand-dropped refactor
  // bundle may already be incoherent through no fault of this task.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (
    isHandoffBundleTask(state.currentTask as any) &&
    (state.resolvedAction?.mode || 'generate') === 'generate'
  ) {
    if ((state._bundleCoherenceRetried || 0) >= 2) {
      console.warn(
        `⚠️  [Worker checkTaskStatus] Bundle coherence retry limit reached (${state._bundleCoherenceRetried}). ` +
        `Completing "${state.currentTask!.name}" with unbound names — the job-level report will list them.`,
      );
    } else {
      const coherence = await validateTaskBundleCoherence(
        state.deps?.fileSystem as any,
        state.context?.featurePath,
        state.currentTask as any,
      );
      if (!coherence.ok) {
        for (const f of coherence.findings) {
          console.warn(`⚠️  [Worker checkTaskStatus] ${f.code} in ${f.file}: ${f.reason}`);
        }
        if (state.deps?.workflowUpdate && state._httpJobId) {
          await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
        }
        return {
          conversations: {
            [CONV_KEYS.NODE_EXECUTE]: [
              ...getConv(state.conversations, CONV_KEYS.NODE_EXECUTE),
              {
                role: 'user' as const,
                content: buildBundleCoherenceRetryMessage(coherence, state.currentTask!.targetFile || ''),
              },
            ],
          },
          _bundleCoherenceFailed: true,
          _bundleCoherenceRetried: (state._bundleCoherenceRetried || 0) + 1,
          _executeCallIndex: 0,
          _noOutputCallCount: 0,
          _drainSalvageTools: null,
          _taskCompleted: false,
          recursionCount: state.recursionCount,
          recursionLimit: state.recursionLimit,
        } as any;
      }
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Normal completion
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.currentTask) {
    const { TaskTimingHelper } = await import('../../code/state');
    // Subagent leak guard — worker task scope ends here; drop undelivered
    // explore entries (mirrors serial checkTaskStatus).
    {
      const { clearSubagentOwner, ownerKeyFor } = await import('../../../../common/subagent');
      const dropped = clearSubagentOwner(ownerKeyFor(state._httpJobId));
      if (dropped > 0) {
        console.warn(`⚠️ [workerCheckTaskStatus] Dropped ${dropped} undelivered subagent entr(ies) at task completion`);
      }
    }
    const { getTaskTokenUsage, rollUpTaskUsageToJob } = await import('../../../../common/graph/llmHelpers');

    const taskTokenUsage = getTaskTokenUsage(state);
    const completedTask = TaskTimingHelper.completeTask(state.currentTask, taskTokenUsage);

    // Roll into worker job-level totals, preserving per-model attribution. The
    // worker also reports `_currentTaskTokenUsageByModel` as a delta to the
    // orchestrator (TaskWorker), which is the parallel-mode billing SSOT.
    rollUpTaskUsageToJob(state);

    console.log(`✅ [Worker] Design task "${completedTask.name}" completed!`);

    // Log task_complete to debug/logs/ (inside workerGraph where state._executeCallIndex is accessible)
    if (state.context?.featurePath && state._httpJobId) {
      const execLogger = getExecutionLogger({
        featurePath: state.context.featurePath,
        jobId: state._httpJobId,
        jobType: 'design',
      });
      execLogger.logTaskComplete(completedTask.id, {
        taskName: completedTask.name,
        elapsedMs: completedTask.timing?.elapsedTime || 0,
        inputTokens: completedTask.tokenUsage?.inputTokens || 0,
        outputTokens: completedTask.tokenUsage?.outputTokens || 0,
        cacheReadTokens: completedTask.tokenUsage?.cacheReadTokens || 0,
        cacheCreationTokens: completedTask.tokenUsage?.cacheCreationTokens || 0,
        llmCallCount: completedTask.tokenUsage?.callCount ?? state._executeCallIndex ?? 0,
      }).catch(() => {});
    }

    // Strip internal markers from output file when last chapter for a document completes
    const taskForMarkers = state.currentTask as any;
    if (taskForMarkers?.isLastTaskForDocument && taskForMarkers?.targetFile && state.deps?.fileSystem && state.context?.featurePath) {
      try {
        const dir = taskForMarkers.targetDir ?? designDirOf(taskForMarkers.targetFile);
        const filePath = path.join(state.context.featurePath, dir, taskForMarkers.targetFile);
        const fs = state.deps.fileSystem as any;
        const content = await fs.readFile(filePath);
        const cleaned = (content as string).replace(INTERNAL_MARKER_RE, '');
        if (cleaned !== content) {
          await fs.writeFile(filePath, cleaned.trimEnd() + '\n');
          console.log(`🧹 [workerCheckTaskStatus] Stripped internal markers from ${taskForMarkers.targetFile}`);
        }
      } catch { /* File may not exist, ignore */ }
    }

    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
    }

    return {
      currentTask: completedTask as any,
      _taskCompleted: true,
      planText: '',
      conversations: {},
      files: [],
      fileErrors: undefined,
      tokenUsage: state.tokenUsage,
      // Per-model delta — execute accumulates it via state mutation and (as
      // of the oat-choosing-horse fix) publishes it as a channel; re-return
      // it here so the worker's invoke() result carries it to
      // TaskWorker.reportCompletion (orchestrator sums deltas job-level).
      // Deliberately NOT returning the cumulative `tokenUsageByModel`: the
      // worker inherits the job-cumulative map from sharedContext, and
      // TaskWorker's fallback would report it as a per-task figure —
      // double-counting the seed (see TaskWorker workerState comment).
      _currentTaskTokenUsageByModel: state._currentTaskTokenUsageByModel,
      _executeCallIndex: 0,
      _noOutputCallCount: 0,
      _drainSalvageTools: null,
      _toolResultCache: undefined,
      _assetValidationFailed: false,
      _assetValidationRetried: 0,
      _specRevisionFailed: false,
      _specRevisionRetried: 0,
      _bundleCoherenceFailed: false,
      _bundleCoherenceRetried: 0,
      _taskFilesWritten: 0,
      _turnToolWrites: 0,
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    } as any;
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus', workerId);
  }

  return {
    currentTask: undefined,
    _taskCompleted: false,
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
  } as any;
}

/**
 * Route out of the worker `checkTaskStatus`. Mirrors the serial
 * `routeAfterCheckTaskStatus` asset-retry branch: a failed asset gate loops
 * back to execute for a re-prompt; otherwise the worker task is done → learn.
 */
function routeAfterWorkerCheckTaskStatus(state: DesignGraphState): string {
  return state._assetValidationFailed || state._specRevisionFailed || state._bundleCoherenceFailed ? 'execute' : 'learn';
}

/**
 * Lightweight learn node for design worker subgraph.
 */
async function workerLearn(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
  return learn(state) as any;
}

const DesignWorkerSubgraphAnnotation = Annotation.Root({
  // Inherit ALL channels from main graph (SSOT — no manual sync needed)
  ...DesignGraphChannels,

  // Worker-only fields (not in main graph)
  prd: Annotation<any>,
  design: Annotation<any>,
  sourceDocuments: Annotation<any>,
  _allTasksSummary: Annotation<any>,
  _taskCompleted: Annotation<any>,
});

/**
 * Build a design worker subgraph.
 *
 * @param _includeInstallValidate - Ignored for design tasks (API compat only)
 */
function buildDesignWorkerSubgraph(_includeInstallValidate: boolean) {
  const graph = new StateGraph(DesignWorkerSubgraphAnnotation);

  // Register nodes
  graph.addNode('plan', withPhaseTracking('plan', plan) as any);
  graph.addNode('execute', withPhaseTracking('execute', execute, 'designExecute') as any);
  graph.addNode('tool', tool as any);
  graph.addNode('checkTaskStatus', workerCheckTaskStatus as any);
  graph.addNode('learn', workerLearn as any);

  // Edges
  graph.addEdge('__start__' as any, 'plan' as any);

  // plan routing (tool-loop / sealed-plan handoff to execute)
  graph.addConditionalEdges(
    'plan' as any,
    routeAfterPlan as any,
    { tool: 'tool', execute: 'execute' } as any,
  );

  // execute routing (tool call / done / retry — with call budget safety net)
  graph.addConditionalEdges(
    'execute' as any,
    routeAfterExecute as any,
    { tool: 'tool', checkTaskStatus: 'checkTaskStatus', execute: 'execute' } as any,
  );

  // tool routing (plan↔tool / execute↔tool dispatched via _activePhase)
  graph.addConditionalEdges(
    'tool' as any,
    routeAfterTool as any,
    { plan: 'plan', execute: 'execute' } as any,
  );

  // checkTaskStatus → execute (asset-gate retry) / learn (done). Mirrors the
  // serial graph's `routeAfterCheckTaskStatus` asset-validation branch so the
  // parallel path can re-prompt on a failed asset gate instead of shipping it.
  graph.addConditionalEdges(
    'checkTaskStatus' as any,
    routeAfterWorkerCheckTaskStatus as any,
    { execute: 'execute', learn: 'learn' } as any,
  );

  // Learn → END
  graph.addEdge('learn' as any, '__end__' as any);

  return (graph as any).compile();
}

/**
 * Create a WorkerGraphBuilder for design job tasks.
 * This function is passed to TaskOrchestrator as the graphBuilder callback.
 */
export function createDesignWorkerGraphBuilder(): WorkerGraphBuilder {
  return (_includeInstallValidate: boolean) => {
    return buildDesignWorkerSubgraph(_includeInstallValidate);
  };
}
