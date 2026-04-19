/**
 * Tool Node (Design Job)
 *
 * Uses createToolNode factory from common/tool/.
 * Design-specific handlers (sourceDoc, referenceImage, assets, figma)
 * are adapted via designToolAdapters and registered at runtime.
 *
 * State data needed by design handlers is injected via ToolExecutionContext
 * fields (sourceDocuments, uiReferences, uiAssetsList, etc.) — no module-level
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
import type { ToolExecutionContext, ToolExecutionEvent } from '../../../../../common/tool/types';
import { createDesignToolHandlers } from './designToolAdapters';
import { emitFileWriteTrace } from '../../../code/nodes/shared/emitFileWriteTrace';

const tokenManager = new TokenBudgetManager();
const designToolResultManager = new ToolResultManager(tokenManager, {
  maxReadFileTokens: 15000,
  maxSourceDocTokens: 15000,
});

/**
 * Registry is built lazily. State-dependent handlers use ctx fields
 * (sourceDocuments, uiReferences, uiAssetsList, figmaExplorationResult, etc.)
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
    return {
      fileSystem: state.deps?.fileSystem as any,
      chatStatus: createChatStatusReporter(),
      workingDir: state.context?.featurePath || process.cwd(),
      featurePath: state.context?.featurePath,
      project: state.context?.projectName,
      featureFolder: state.context?.featureFolder,
      git: state.deps?.git as any,
      redis: state.deps?.redis,
      fileTreeUpdate: state.deps?.fileTreeUpdate as any,
      figmaFileKey: state.figmaFileKey,
      figmaExplorationResult: state.figmaExplorationResult,
      figmaAvailable: state.figmaAvailable,
      figmaConfig: state.figmaConfig,
      userId: state.context?.userId,
      sourceDocuments: state.artifacts,
      uiReferences: state.uiReferences,
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
      // Forward file-mutating sideEffects to trace.jsonl (SSOT for
      // breadcrumb/touched — see core/context/breadcrumb.ts). Best-effort.
      emitFileWriteTrace({
        session: state.deps?.session,
        jobId: state.jobId,
        turnId: state.turnId,
        jobType: 'design',
        sideEffects: event.result.sideEffects,
      });
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
