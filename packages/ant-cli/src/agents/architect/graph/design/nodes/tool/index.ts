/**
 * Tool Node (Design Job)
 *
 * Uses createToolNode factory from common/tool/.
 * Design-specific handlers (sourceDoc, referenceImage, assets, figma)
 * are adapted via designToolAdapters and registered at runtime.
 *
 * State data needed by design handlers is injected via ToolExecutionContext
 * fields (sourceDocuments, uiAssetsList, etc.) — no module-level
 * _cachedState variable.
 */

import { DesignGraphState } from '../../state';
import { CONV_KEYS, getConv } from '../../../../../common/graph/conversations';
import { TokenBudgetManager } from '../../../../../../core/utils/tokenBudget';
import { ToolResultManager } from '../../../../../../core/utils/toolResultManager';
import { getExecutionLogger } from '../../../../../../core/utils/executionLogger';
import { createToolNode } from '../../../../../common/tool/createToolNode';
import { createDesignToolRegistry } from '../../../../../common/tool/presets';
import { createChatStatusReporter } from '../../../../../common/tool/chatStatusAdapter';
import { CACHEABLE_TOOLS } from '../../../../../common/tool/toolCatalog';
import type { ToolExecutionContext, ToolSideEffect } from '../../../../../common/tool/types';
import { createDesignToolHandlers } from './designToolAdapters';
import { pickAssetsRoot } from './handlers';
import { isFigmaPipeline, isFigmaDataPopulated } from '@ant/shared';

const FIGMA_CONNECTION_LOST_THRESHOLD = 3;

/**
 * Apply figma sideEffects to the worker graph state. Exported for unit
 * tests; production callers go through the `afterExecution` hook below.
 *
 * Counter policy:
 * - `figmaSuccess`        → reset `_figmaConsecutiveErrors` to 0
 * - `figmaError(connection|environment)` → increment counter; flip
 *   `_figmaConnectionLost` once the threshold is crossed AND the active
 *   intent is figma-bound (else the flag would fire for code jobs that
 *   just happened to call figma without a real figma pipeline).
 * - `figmaError(data|rate_limit|other)`  → no counter change. `data`
 *   is per-request (e.g. invalid nodeId); `rate_limit` is re-thrown as
 *   `FigmaRateLimitError` upstream and handled globally; `other` is the
 *   safety bucket and avoids false-positive interrupts.
 */
export function applyFigmaSideEffects(
  state: DesignGraphState,
  sideEffects: readonly ToolSideEffect[] | undefined,
): void {
  if (!sideEffects || sideEffects.length === 0) return;
  for (const effect of sideEffects) {
    switch (effect.type) {
      case 'figmaSuccess':
        state._figmaConsecutiveErrors = 0;
        break;
      case 'figmaError': {
        if (effect.category === 'connection' || effect.category === 'environment') {
          state._figmaConsecutiveErrors = (state._figmaConsecutiveErrors || 0) + 1;
          const inFigmaPipeline =
            isFigmaPipeline(state.resolvedAction?.intent, isFigmaDataPopulated(state.figmaConfig)) ||
            state.figmaAvailable === true;
          if (inFigmaPipeline && (state._figmaConsecutiveErrors ?? 0) >= FIGMA_CONNECTION_LOST_THRESHOLD) {
            state._figmaConnectionLost = true;
          }
        }
        break;
      }
    }
  }
}

const tokenManager = new TokenBudgetManager();
const designToolResultManager = new ToolResultManager(tokenManager, {
  maxReadFileTokens: 15000,
  maxSourceDocTokens: 15000,
});

/**
 * Registry is built lazily. State-dependent handlers use ctx fields
 * (sourceDocuments, uiAssetsList, figmaExplorationResult, etc.)
 * populated by buildContext at call time — no _cachedState closure.
 */
const registry = createDesignToolRegistry();
const designHandlers = createDesignToolHandlers();
for (const [name, handler] of designHandlers) {
  registry.register(name as any, handler);
}

const toolNodeFn = createToolNode<DesignGraphState>({
  getPendingCalls(state) {
    return (state.llmResponse?.toolCalls || []).map(tc => ({
      id: tc.id,
      name: tc.name,
      args: tc.args,
    }));
  },

  buildContext(state): ToolExecutionContext {
    const assetsRoot = pickAssetsRoot({
      workspaceDomain: (state.workspaceConfig as { domain?: any } | undefined)?.domain,
      racDomain: state.resolvedAction?.domain,
      intentGroup: state.resolvedAction?.intentGroup,
    });

    return {
      fileSystem: state.deps?.fileSystem as any,
      chatStatus: createChatStatusReporter(),
      workingDir: state.context?.featurePath || process.cwd(),
      featurePath: state.context?.featurePath,
      project: state.context?.projectName,
      featureFolder: state.context?.featureFolder,
      git: state.deps?.git as any,
      command: state.deps?.command as any,
      redis: state.deps?.redis,
      fileTreeUpdate: state.deps?.fileTreeUpdate as any,
      figmaFileKey: state.figmaFileKey,
      figmaExplorationResult: state.figmaExplorationResult,
      figmaAvailable: state.figmaAvailable,
      figmaConfig: state.figmaConfig,
      userId: state.context?.userId,
      organizationId: state.context?.organizationId,
      taskId: state.currentTask?.id,
      assetsRoot,
      sourceDocuments: state.artifacts,
      uiAssetsList: state.uiAssetsList,
      existingDesignDocs: state.existingDesignDocs,
    };
  },

  registry,
  resultManager: designToolResultManager,

  getHistory(state) {
    return getConv(state.conversations, CONV_KEYS.NODE_DOCGEN);
  },

  getCache(state) {
    return state._toolResultCache;
  },
  cacheableTools: CACHEABLE_TOOLS,

  hooks: {
    afterExecution(state, event) {
      // NOTE: chat.jsonl `chat_status` lines (statusType=file_create /
      // file_edit / file_delete + failed variants) are emitted by
      // `FileOperationHandler.addFileOperation` (SSOT) when tool handlers
      // call `ctx.chatStatus.completeFileCreation/Edit/Deletion`. No
      // separate emission is needed here.
      const jobId = state._httpJobId;
      const featurePath = state.context?.featurePath;
      const taskId = (state.currentTask as any)?.id;
      if (jobId && featurePath && taskId) {
        try {
          const logger = getExecutionLogger({ featurePath, jobId, jobType: 'design' });
          const isImageContent = Array.isArray(event.result.content) &&
            event.result.content.some((b: any) => b.type === 'image');
          const resultStr = isImageContent
            ? `[multimodal: ${event.result.content.length} blocks]`
            : (typeof event.result.content === 'string' ? event.result.content : JSON.stringify(event.result.content ?? ''));
          logger.logToolCall(taskId, {
            toolName: event.toolName,
            args: event.args,
            resultChars: resultStr.length,
            resultPreview: isImageContent ? resultStr : (resultStr.length <= 500 ? resultStr : undefined),
            wasTruncated: false,
            error: event.result.error,
          }).catch(() => { /* non-blocking */ });
        } catch { /* non-blocking */ }
      }

      // Figma error counter — drives Gate 1.5 in workerCheckTaskStatus.
      // Throwaway-state mutation in the figma handler (the previous design)
      // never reached worker graph state; the SSOT is now the sideEffect
      // emitted by `common/tool/handlers/figma.ts` and consumed here via
      // `applyFigmaSideEffects`. Counter policy is documented on that helper.
      applyFigmaSideEffects(state, event.result.sideEffects);
    },

  },

  buildReturn(state, { updatedHistory, updatedCache, hookUpdates }) {
    return {
      conversations: { [CONV_KEYS.NODE_DOCGEN]: updatedHistory },
      files: state.files,
      _currentTaskTokenUsage: state._currentTaskTokenUsage,
      tokenUsage: state.tokenUsage,
      _toolResultCache: updatedCache ?? state._toolResultCache,
      _figmaConsecutiveErrors: state._figmaConsecutiveErrors,
      _figmaConnectionLost: state._figmaConnectionLost,
      recursionCount: (state.recursionCount || 0) + 1,
      recursionLimit: state.recursionLimit,
      llmResponse: {
        ...state.llmResponse!,
        toolCalls: [],
      },
      ...hookUpdates,
    };
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
  getFigmaContext(state) {
    if (!state.figmaExplorationResult) return undefined;
    return {
      queriedNodeId: undefined,
      nodeSummary: state.figmaExplorationResult.nodeSummary,
    };
  },
});

export async function tool(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
  return toolNodeFn(state);
}
