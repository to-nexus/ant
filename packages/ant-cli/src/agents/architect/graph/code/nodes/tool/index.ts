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
import { createToolNode } from '../../../../../common/tool/createToolNode';
import { createCodeToolRegistry } from '../../../../../common/tool/presets';
import { createChatStatusReporter } from '../../../../../common/tool/chatStatusAdapter';
import type { ToolExecutionContext, ToolExecutionEvent } from '../../../../../common/tool/types';
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
      // Tier-Verification Alignment: Tier 2 Exploratory self-verify flag flows from the
      // task into the command-policy layer. When true, task-type guards lift
      // the default build/test/typecheck block so the task can run its own
      // verification gate chain before emitting <done>true</done>.
      currentTaskSelfVerifyOnDone:
        (state.currentTask as any)?.selfVerifyOnDone === true ? true : undefined,
      // T4b-β: verification cycle state is carried by `state.verification`
      // (VerificationSession). Tool handlers that need gate / install
      // information read it off the session directly via the
      // `verificationSession` slot — no tracker fan-out from state is
      // necessary any more. Dep install status itself lives on the codebase
      // (package.json vs node_modules/<name>) and is observed directly by
      // `areDepsInstalled` at plan entry (F3), not carried as a tool signal.
      verificationSession: state.verification,
      retries: state.retries,
      // Deep-diagnostic activates once the Session's attempt count crosses
      // the threshold; the hook layer owns the predicate.
      isDeepDiagnostic: state.verification?.inDeepMode() ?? false,
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
      // Per-task touched-files SSOT. chat.jsonl file_* events are ephemeral
      // UI feed — the durable record lives on `currentTask.touchedFiles`
      // and persists into `code.json.state.completedTasksDetails[i]` when
      // `checkTaskStatus` pushes the completed task. Readers: learn node
      // (lessonMetadata.relatedFiles / SessionRun.output.files).
      recordFileTouch: (_op, p) => {
        if (!state.currentTask) return;
        const arr = (state.currentTask.touchedFiles ??= []);
        if (!arr.includes(p)) arr.push(p);
      },
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
      // NOTE: chat.jsonl `chat_status` lines (statusType=file_create /
      // file_edit / file_delete + failed variants) are emitted by
      // `FileOperationHandler.addFileOperation` (SSOT) when tool handlers
      // call `ctx.chatStatus.completeFileCreation/Edit/Deletion`. No
      // separate emission is needed here.
      // R1 — task-type-specific side-effect handling lives on the task's
      // tool hook (verification: gate invalidation / install status / deep-
      // diagnostic marking via the Session API). The inline switch below
      // owns only phase-blind bookkeeping (command history) that the hook
      // layer does not mediate. `_executeModifiedFiles` is computed in
      // `buildReturn` from `executionEvents` and returned as a state
      // update so LangGraph's `LastValue` reducer commits it to the
      // graph state — direct `state._executeModifiedFiles = true`
      // mutation was a latent bug (mutations outside the return object
      // never propagate via the Annotation channel).
      hooksIfActive(state)?.tool?.onEvent(state, event);
      const effects = event.result.sideEffects || [];
      for (const effect of effects) {
        switch (effect.type) {
          case 'commandExecuted': {
            const { exitCode, command, success } = effect;
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

    // SSOT for `_executeModifiedFiles`: any execute-phase tool invocation
    // whose side effects include `verificationInvalidated` (emitted by
    // file-mutating handlers: edit_file / create_file / delete_file) flips
    // the flag so `routeAfterDone` can reach the reverify branch. Returned
    // from the node so LangGraph actually commits it to graph state.
    const touchedFiles = state._activePhase !== 'plan' && executionEvents.some(e =>
      (e.result.sideEffects || []).some(ef => ef.type === 'verificationInvalidated'),
    );

    const base: Partial<ArchitectGraphState> = {
      llmResponse: { ...state.llmResponse!, toolCalls: [] },
      toolResults: [...(state.toolResults || []), ...allToolResults],
      planText: state.planText,
      recursionCount: (state.recursionCount || 0) + 1,
      recursionLimit: state.recursionLimit,
      ...(touchedFiles ? { _executeModifiedFiles: true } : {}),
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
