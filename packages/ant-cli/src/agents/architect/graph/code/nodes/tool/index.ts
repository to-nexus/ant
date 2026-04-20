/**
 * Tool Node (Code Job)
 *
 * Uses createToolNode factory from common/tool/.
 * Code-specific logic (verificationTracker, commandHistory,
 * plan/execute dual history) is handled via hooks.
 * Execute/plan nodes push assistant messages; this node appends tool_result only.
 */

import { ArchitectGraphState } from '../../state';
import { CONV_KEYS, getConv } from '../../../../../common/graph/conversations';
import { toolResultManager } from './utils/managers';
import { buildTaskReminder, updateCommandHistory } from './utils/helpers';
import { isTypecheckCommand, isBuildCommand, isTestCommand } from '../../../../../common/tool/constants';
import { createToolNode } from '../../../../../common/tool/createToolNode';
import { createCodeToolRegistry } from '../../../../../common/tool/presets';
import { createChatStatusReporter } from '../../../../../common/tool/chatStatusAdapter';
import type { ToolExecutionContext, ToolExecutionEvent } from '../../../../../common/tool/types';
import { inDeepDiagnosticMode } from '../../utils/deepDiagnosticMode';
import { emitFileWriteTrace } from '../shared/emitFileWriteTrace';
import { hooksIfActive } from '../../tasks/_shared/registry';

const registry = createCodeToolRegistry();

const toolNodeFn = createToolNode<ArchitectGraphState>({
  getPendingCalls(state) {
    return (state.llmResponse?.toolCalls || []).map(tc => ({
      id: tc.id,
      name: tc.name,
      args: tc.args,
    }));
  },

  buildContext(state): ToolExecutionContext {
    return {
      fileSystem: state.deps?.fileSystem as any,
      chatStatus: createChatStatusReporter(),
      workingDir: state.context?.featurePath || process.cwd(),
      featurePath: state.context?.featurePath,
      project: state.context?.projectName,
      featureFolder: state.context?.featureFolder,
      command: state.deps?.command as any,
      git: state.deps?.git as any,
      redis: state.deps?.redis,
      fileTreeUpdate: state.deps?.fileTreeUpdate as any,
      figmaFileKey: state.figmaFileKey,
      activePhase: state._activePhase as 'plan' | 'execute' | undefined,
      currentTaskType: (state.currentTask as any)?.type,
      verificationTracker: state._verificationTracker as any,
      depFileHash: state._depFileHash,
      retries: state.retries,
      // Deep-diagnostic activates at the 2nd re-entry into the task (see
      // utils/deepDiagnosticMode.ts for the full set of effects).
      isDeepDiagnostic: inDeepDiagnosticMode(state),
      referenceRequests: state.referenceRequests,
      resolvedActionMode: state.resolvedAction?.mode,
      retriever: state.deps?.retriever as any,
      vectorDB: state.deps?.vectorDB,
      workspaceResolver: state.deps?.workspaceResolver,
      userId: state.context?.userId,
      organizationId: state.context?.organizationId,
      // Phase 3-15 — surface plan-phase search_web usage to the handler.
      planSearchWebCount: state._planSearchWebCount ?? 0,
      planSearchWebLimit: parseInt(process.env.ANT_PLAN_SEARCH_WEB_MAX || '3', 10),
    };
  },

  registry,
  resultManager: toolResultManager,

  getHistory(state) {
    return state._activePhase === 'plan'
      ? getConv(state.conversations, CONV_KEYS.NODE_PLAN)
      : getConv(state.conversations, CONV_KEYS.NODE_EXECUTE);
  },

  hooks: {
    afterExecution(state, event) {
      // Phase 3-15 — count successful plan-phase search_web executions so
      // subsequent rounds see the bumped counter via buildContext.
      if (state._activePhase === 'plan' && event.toolName === 'search_web' && !event.result.error) {
        state._planSearchWebCount = (state._planSearchWebCount ?? 0) + 1;
      }
      // Emit trace.jsonl file_write events (SSOT for touched-file collection
      // in learn/breadcrumb — see core/context/breadcrumb.ts). Best-effort:
      // failures log and continue so tool execution never regresses.
      emitFileWriteTrace({
        session: state.deps?.session,
        jobId: state.jobId,
        turnId: state.turnId,
        jobType: 'code',
        sideEffects: event.result.sideEffects,
      });
      // R1 — task-type-specific side-effect handling lives on the task's
      // tool hook (verification: tracker reset / install status / deep-
      // diagnostic). The inline switch below stays as a transitional
      // dual-write until T4b removes the `_verificationTracker` /
      // `_installNeeded` state fields; at that point the hook is the
      // sole writer. See docs/tmp/verification-task-redesign-handoff.md
      // §7.3 (T6b-α 편승).
      hooksIfActive(state)?.tool?.onEvent(state, event);
      const effects = event.result.sideEffects || [];
      for (const effect of effects) {
        switch (effect.type) {
          case 'verificationInvalidated': {
            // Scope-based selective invalidation (see utils/invalidationScope.ts).
            // Narrow the reset to the steps actually affected by the file change
            // so already-passed steps (e.g. typecheck) remain cached across edits.
            const tracker = state._verificationTracker;
            const { scope } = effect;
            if (tracker) {
              const invalidateTypecheck = scope === 'typecheck' || scope === 'all';
              const invalidateBuild = scope === 'build' || scope === 'all';
              const invalidateTest = scope === 'test' || scope === 'all';
              if (invalidateTypecheck) {
                tracker.typecheckPassed = false;
                tracker.typecheckAttempted = false;
              }
              if (invalidateBuild) {
                tracker.buildPassed = false;
                tracker.buildAttempted = false;
              }
              if (invalidateTest) {
                tracker.testPassed = false;
                tracker.testAttempted = false;
              }
            }
            if (effect.installNeeded === true) {
              state._installNeeded = true;
            }
            if (state._activePhase !== 'plan') {
              state._executeModifiedFiles = true;
            }
            break;
          }

          case 'depFileHashChanged': {
            // Reflect updated dependency hash into state so the
            // "bare install skipped" guard in runCommand can actually fire
            // on the next verification cycle.
            state._depFileHash = effect.newHash;
            state._installNeeded = false;
            break;
          }

          case 'commandExecuted': {
            const { exitCode, command, success } = effect;
            const tracker = state._verificationTracker;
            if (tracker && exitCode !== -1) {
              if (isTypecheckCommand(command)) tracker.typecheckPassed = success;
              if (isBuildCommand(command)) tracker.buildPassed = success;
              if (isTestCommand(command)) tracker.testPassed = success;
            }

            const commandExecuted = { command, success, exitCode };
            const { shouldWarn, warningMessage } = updateCommandHistory(
              state, commandExecuted, event.result.error, event.result.content,
            );
            if (shouldWarn && warningMessage && typeof event.result.content === 'string') {
              event.result.content = event.result.content + warningMessage;
            }
            break;
          }
        }
      }
    },

    buildExtraUserContent(state) {
      if (state._activePhase === 'plan') return [];
      const taskReminder = buildTaskReminder(state);
      if (!taskReminder) return [];
      return [{ type: 'text' as const, text: taskReminder }];
    },
  },

  buildReturn(state, { updatedHistory, executionEvents, hookUpdates }) {
    const allToolResults = executionEvents.map(e => {
      const isFigma = Array.isArray(e.result.content) &&
        e.result.content.some((b: any) => b.type === 'image');
      return {
        toolCallId: e.toolCallId,
        result: isFigma ? '[figma_image]' : e.result.content,
        error: e.result.error,
      };
    });

    const base: Partial<ArchitectGraphState> = {
      llmResponse: { ...state.llmResponse!, toolCalls: [] },
      toolResults: [...(state.toolResults || []), ...allToolResults],
      planText: state.planText,
      recursionCount: (state.recursionCount || 0) + 1,
      recursionLimit: state.recursionLimit,
      ...hookUpdates,
    };

    if (state._activePhase === 'plan') {
      return { ...base, conversations: { [CONV_KEYS.NODE_PLAN]: updatedHistory } };
    }
    return { ...base, conversations: { [CONV_KEYS.NODE_EXECUTE]: updatedHistory } };
  },

  getWorkflowUpdate(state) {
    if (!state.deps?.workflowUpdate) return undefined;
    return {
      enterNode: state.deps.workflowUpdate.enterNode.bind(state.deps.workflowUpdate),
      exitNode: state.deps.workflowUpdate.exitNode.bind(state.deps.workflowUpdate),
    };
  },
  getHttpJobId(state) { return state._httpJobId; },
  getWorkerId(state) { return state.workerId ?? 0; },
  getTaskInfo(state) {
    if (!state.currentTask) return undefined;
    return {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority,
    };
  },
  getRecursionCount(state) { return state.recursionCount; },
  getRecursionLimit(state) { return state.recursionLimit; },
  getFigmaContext(_state) {
    return undefined;
  },
});

export async function tool(state: ArchitectGraphState): Promise<Partial<ArchitectGraphState>> {
  const { traceNodeEntry } = await import('../../../../../../utils/verificationTrace');
  traceNodeEntry('tool', state.currentTask ?? undefined);
  return toolNodeFn(state);
}
