/**
 * Tool Node (Code Job)
 *
 * Uses createToolNode factory from common/tool/.
 * Code-specific logic (verificationTracker, commandHistory, diagnostics,
 * plan/execute dual history) is handled via hooks.
 * Execute/plan nodes push assistant messages; this node appends tool_result only.
 */

import { ArchitectGraphState } from '../../state';
import { toolResultManager } from './utils/managers';
import { buildTaskReminder, updateCommandHistory } from './utils/helpers';
import { isTypecheckCommand, isBuildCommand, isTestCommand } from '../../../../../common/tool/constants';
import { createToolNode } from '../../../../../common/tool/createToolNode';
import { createCodeToolRegistry } from '../../../../../common/tool/presets';
import { createChatStatusReporter } from '../../../../../common/tool/chatStatusAdapter';
import type { ToolExecutionContext, ToolExecutionEvent } from '../../../../../common/tool/types';

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
      referenceRequests: state.referenceRequests,
      resolvedActionMode: state.resolvedAction?.mode,
      retriever: state.deps?.retriever as any,
      vectorDB: state.deps?.vectorDB,
      workspaceResolver: state.deps?.workspaceResolver,
      userId: state.context?.userId,
      organizationId: state.context?.organizationId,
    };
  },

  registry,
  resultManager: toolResultManager,

  getHistory(state) {
    return state._activePhase === 'plan'
      ? (state.planConversationHistory || [])
      : (state.conversationHistory || []);
  },

  hooks: {
    afterExecution(state, event) {
      const effects = event.result.sideEffects || [];
      for (const effect of effects) {
        switch (effect.type) {
          case 'verificationInvalidated':
            if (state._verificationTracker) {
              state._verificationTracker.typecheckPassed = false;
              state._verificationTracker.buildPassed = false;
              state._verificationTracker.testPassed = false;
            }
            if (state._activePhase !== 'plan') {
              state._executeModifiedFiles = true;
            }
            break;

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

            if (!success) {
              runDiagnostics(command, event.result.error, event.result.content, state);
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
      return { ...base, planConversationHistory: updatedHistory };
    }
    return { ...base, conversationHistory: updatedHistory };
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

function runDiagnostics(command: string, error: string | undefined, content: any, state: ArchitectGraphState) {
  try {
    import('../diagnostics').then(({ diagnoseError }) => {
      import('../diagnostics/errorStats').then(({ errorStatsCollector }) => {
        const errorOutput = error || (typeof content === 'string' ? content : '') || '';
        const diagnosis = diagnoseError(errorOutput, {
          command,
          workDir: state.context?.featurePath,
        });
        if (diagnosis) {
          errorStatsCollector.recordError(diagnosis, {
            command,
            workDir: state.context?.featurePath,
          });
        }
      }).catch(() => {});
    }).catch(() => {});
  } catch { /* non-blocking */ }
}

export async function tool(state: ArchitectGraphState): Promise<Partial<ArchitectGraphState>> {
  return toolNodeFn(state);
}
