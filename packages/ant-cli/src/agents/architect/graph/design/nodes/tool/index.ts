/**
 * Tool Node (Design Job)
 *
 * Uses createToolNode factory from common/tool/.
 * Design-specific handlers (sourceDoc, referenceImage, assets, figma)
 * are adapted via designToolAdapters and registered at runtime.
 *
 * State data needed by design handlers is injected via ToolExecutionContext
 * fields (sourceDocuments, assetsRoot, etc.) — no module-level
 * _cachedState variable.
 */

import { DesignGraphState } from '../../state';
import { CONV_KEYS, getConv, type ConversationKey } from '../../../../../common/graph/conversations';
import { TokenBudgetManager } from '../../../../../../core/utils/tokenBudget';
import { ToolResultManager } from '../../../../../../core/utils/toolResultManager';
import { getExecutionLogger } from '../../../../../../core/utils/executionLogger';
import { createToolNode } from '../../../../../common/tool/createToolNode';
import { gateDrainSalvage } from '../../../../../common/tool/drainSalvageGate';
import { createDesignToolRegistry } from '../../../../../common/tool/presets';
import { createChatStatusReporter } from '../../../../../common/tool/chatStatusAdapter';
import { CACHEABLE_TOOLS, TOOL_SETS } from '../../../../../common/tool/toolCatalog';
import { getToolsByNames } from '../../../../../common/tool/toolSchemas';
import { createSubagentSeam } from '../../../../../common/subagent';
import { mergeReferenceRequests } from '../../../../../common/tool/reference/merge';
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

/**
 * Count successful artifact-write sideEffects in a tool batch.
 * Exported for unit tests; the production consumer is `buildReturn` below.
 *
 * - success-based: `fileCreated` / `fileModified` / `fileDeleted` are emitted
 *   only on handler success (`fileNotChanged` deliberately excluded);
 * - `codebase/**` writes are not design artifacts and never count;
 * - plan-phase batches never count (exploration, not document writing).
 */
export function countArtifactToolWrites(
  activePhase: string | undefined,
  executionEvents: ReadonlyArray<{ result: { sideEffects?: readonly ToolSideEffect[] } }> | undefined,
): number {
  if (activePhase === 'plan') return 0;
  const ARTIFACT_WRITE_EFFECTS = new Set(['fileCreated', 'fileModified', 'fileDeleted']);
  const isCodebaseLike = (p: unknown) =>
    typeof p === 'string' && (p === 'codebase' || p.startsWith('codebase/') || p.includes('/codebase/'));
  return (executionEvents || []).reduce(
    (n, e) =>
      n +
      (e.result.sideEffects || []).filter(
        (ef: any) => ARTIFACT_WRITE_EFFECTS.has(ef.type) && !isCodebaseLike(ef.path),
      ).length,
    0,
  );
}

const tokenManager = new TokenBudgetManager();
const designToolResultManager = new ToolResultManager(tokenManager, {
  maxReadFileTokens: 15000,
  maxSourceDocTokens: 15000,
});

/**
 * Resolve which conversation key the tool node should mutate based on
 * the active phase signal set by the upstream node:
 *  - `_activePhase === 'plan'`  → plan↔tool loop (NODE_PLAN)
 *  - otherwise                  → execute↔tool loop (NODE_EXECUTE)
 *
 * Both loops share the same physical tool node and the read-only
 * `_toolResultCache`. That means a `read_file` performed during plan
 * can be served from cache when execute reads the same path — token
 * savings without any cross-phase coupling beyond the cache.
 */
function activeConvKey(state: DesignGraphState): ConversationKey {
  return state._activePhase === 'plan' ? CONV_KEYS.NODE_PLAN : CONV_KEYS.NODE_EXECUTE;
}

/**
 * Registry is built lazily. State-dependent handlers use ctx fields
 * (sourceDocuments, assetsRoot, figmaExplorationResult, etc.)
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

  // Drain-salvage enforcement: during forced finalization the execute node
  // narrows the ADVERTISED tools, but OpenAI-compat providers (GLM) keep
  // emitting undeclared history-pattern reads — refuse them here instead of
  // executing (narrow-ending-flour RCA). See common/tool/drainSalvageGate.ts.
  gateCall(state, call) {
    // Execute-only: the plan loop shares this node but never drains.
    if (state._activePhase === 'plan') return { allowed: true };
    return gateDrainSalvage(state._drainSalvageTools, call);
  },

  buildContext(state): ToolExecutionContext {
    const assetsRoot = pickAssetsRoot({
      workspaceDomain: (state.workspaceConfig as { domain?: any } | undefined)?.domain,
      racDomain: state.resolvedAction?.domain,
      intentGroup: state.resolvedAction?.intentGroup,
    });

    const ctx: ToolExecutionContext = {
      fileSystem: state.deps?.fileSystem as any,
      chatStatus: createChatStatusReporter(),
      workingDir: state.context?.featurePath || process.cwd(),
      featurePath: state.context?.featurePath,
      project: state.context?.project,
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
      // Reference-codebase tools — sibling-project resolution + registration gate.
      workspaceResolver: state.deps?.workspaceResolver,
      referenceRequests: state.referenceRequests,
      resolvedActionMode: state.resolvedAction?.mode,
      taskId: state.currentTask?.id,
      assetsRoot,
      sourceDocuments: state.artifacts,
      existingDesignDocs: state.existingDesignDocs,
      // Codebase mutation gate — design job's artifact lives under
      // architecture/, plan/, assets/, etc. Any `codebase/` write
      // belongs to the downstream code job, so close the gate
      // throughout design (plan + execute).
      allowMutateInCodebase: false,
      // Shell execution gate — design job is document-producing; no
      // legitimate `run_command` use exists. The design tool registry
      // also omits `RUN_COMMAND` (`0b9b9227`); this flag is the
      // defence-in-depth handler-side enforcement for the same policy.
      allowShellExecution: false,
    };
    // Explore-subagent seam — design is RAC-orthogonal for codebase reads
    // (no gate); the child inherits sourceDocuments so read_source_doc works.
    ctx.subagent = createSubagentSeam({
      jobId: state._httpJobId,
      jobKind: 'design',
      llmJobType: 'design',
      workspaceConfig: state.workspaceConfig,
      baseCtx: ctx,
      registry,
      childTools: getToolsByNames(TOOL_SETS.subagentDesign),
      promptBuilder: state.deps?.promptBuilder,
    });
    return ctx;
  },

  registry,
  resultManager: designToolResultManager,

  getHistory(state) {
    return getConv(state.conversations, activeConvKey(state));
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
            // `phase` distinguishes plan↔tool from execute↔tool calls so
            // log analysis can attribute exploration vs document-writing
            // tool budget separately.
            phase: state._activePhase ?? 'execute',
            sideEffects: event.result.sideEffects as Array<Record<string, any>> | undefined,
          } as any).catch(() => { /* non-blocking */ });
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

  buildReturn(state, { updatedHistory, updatedCache, executionEvents, hookUpdates }) {
    // Reference-registration channel writer (mirrors the code tool node).
    const refDeltas = (executionEvents || []).flatMap(e =>
      (e.result.sideEffects || [])
        .filter((ef): ef is { type: 'referenceRegistered'; project: string; branch?: string } =>
          ef.type === 'referenceRegistered')
        .map(ef => ({ project: ef.project, branch: ef.branch })),
    );
    const mergedReferenceRequests = refDeltas.length
      ? mergeReferenceRequests(state.referenceRequests, refDeltas)
      : undefined;

    // Successful artifact tool writes this batch (edit_file / create_file /
    // delete_file sideEffects — success-based, `fileNotChanged` excluded).
    // Execute folds this into `_taskFilesWritten` + `hasNewFileOutput` so
    // every write channel registers output: the no-output breaker resets on
    // productive edits and the design_no_output gate sees tool-written
    // files. Plan-phase batches
    // never count (exploration, not document writing). SideEffects are the
    // SSOT of "a write happened" — same pattern as the figma error counter.
    const turnToolWrites = countArtifactToolWrites(state._activePhase, executionEvents as any);

    return {
      conversations: { [activeConvKey(state)]: updatedHistory },
      files: state.files,
      ...(turnToolWrites > 0 ? { _turnToolWrites: turnToolWrites } : {}),
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
      ...(mergedReferenceRequests ? { referenceRequests: mergedReferenceRequests } : {}),
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
