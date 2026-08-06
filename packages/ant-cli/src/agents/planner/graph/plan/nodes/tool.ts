/**
 * Tool Node (Plan Job)
 *
 * Uses createToolNode factory. Generate node pushes the assistant
 * message; this node appends tool_result only.
 *
 * Session checkpoint is performed via onComplete hook.
 */

import { PlanGraphState } from '../state';
import { PLANNER_TOOL_MAP, type PlannerToolContext } from './tools';
import { createToolNode } from '../../../../common/tool/createToolNode';
import { createChatStatusReporter } from '../../../../common/tool/chatStatusAdapter';
import { createPlanToolRegistry } from '../../../../common/tool/presets';
import { ToolRegistry } from '../../../../common/tool/registry';
import { CONV_KEYS, getConv, type ConversationKey } from '../../../../common/graph/conversations';
import { TOOL_SETS } from '../../../../common/tool/toolCatalog';
import { getToolsByNames } from '../../../../common/tool/toolSchemas';
import { createSubagentSeam } from '../../../../common/subagent';
import type { ToolExecutionContext } from '../../../../common/tool/types';

/**
 * Resolve which conversation channel this tool round belongs to, based on the
 * active phase set by the upstream node (mirrors design's `activeConvKey`):
 *  - `_activePhase === 'execute'` → execute↔tool loop (NODE_EXECUTE)
 *  - otherwise (plan)            → plan↔tool loop (NODE_PLAN)
 *
 * Both loops share the one physical tool node; keying the channel off the
 * phase keeps the plan and execute transcripts severed — execute's tool
 * results never leak into the plan transcript (the whole point of the split).
 */
function activeConvKey(state: PlanGraphState): ConversationKey {
  return state._activePhase === 'execute' ? CONV_KEYS.NODE_EXECUTE : CONV_KEYS.NODE_PLAN;
}

let _registry: ToolRegistry | null = null;

function getRegistry(): ToolRegistry {
  if (_registry) return _registry;
  _registry = createPlanToolRegistry();

  for (const [name, toolDef] of PLANNER_TOOL_MAP) {
    _registry.register(name as any, async (ctx, args) => {
      const planCtx: PlannerToolContext = {
        featurePath: ctx.featurePath || ctx.workingDir,
        fileTreeUpdate: ctx.fileTreeUpdate,
        chatStatus: ctx.chatStatus,
      };
      try {
        const result = await toolDef.execute(args, planCtx);
        return { content: result };
      } catch (error: any) {
        return { content: `Error: ${error.message}`, error: error.message };
      }
    });
  }

  return _registry;
}

const toolNodeFn = createToolNode<PlanGraphState>({
  getPendingCalls(state) {
    return (state.pendingToolCalls || []).map(tc => ({
      id: tc.id,
      name: tc.name,
      args: tc.args,
    }));
  },

  buildContext(state) {
    const ctx: ToolExecutionContext = {
      fileSystem: state.deps?.fileSystem as any,
      chatStatus: createChatStatusReporter(),
      workingDir: state.featurePath,
      featurePath: state.featurePath,
      fileTreeUpdate: state.deps?.fileTreeUpdate as any,
    };
    // Explore-subagent seam. Child tools are the common read-only trio; the
    // planner's codebase gate only blocks WRITES, so reads need no gate.
    ctx.subagent = createSubagentSeam({
      jobId: state._httpJobId,
      jobKind: 'planner',
      llmJobType: 'plan',
      workspaceConfig: (state as any).workspaceConfig,
      baseCtx: ctx,
      registry: getRegistry(),
      childTools: getToolsByNames(TOOL_SETS.subagentPlanner),
      promptBuilder: state.deps?.promptBuilder,
    });
    return ctx;
  },

  registry: getRegistry(),
  // No resultManager — lightweight graph, no truncation needed

  getHistory(state) {
    return getConv(state.conversations, activeConvKey(state));
  },

  hooks: {
    onComplete: async (state, _events, { updatedHistory }) => {
      const session = state.deps?.session;
      if (!session) return;
      const key = activeConvKey(state);
      const pid = session.projectId || process.env.ANT_PROJECT_ID || 'default';
      const fname = session.featureName || process.env.ANT_FEATURE_NAME || 'skeleton';
      try {
        const sessionData = await session.load(pid, fname, 'plan');
        const updatedConversations = {
          ...sessionData.state?.conversations,
          [key]: updatedHistory,
        };
        await session.updateArtifacts(pid, fname, 'plan', {
          state: {
            ...sessionData.state,
            conversations: updatedConversations,
            tokenUsage: state.tokenUsage,
          }
        });
        console.log(`💾 [Planner:Tool] Checkpoint saved to ${key} (${updatedHistory.length} history entries)`);
      } catch (err: any) {
        console.warn(`⚠️ [Planner:Tool] Failed to save checkpoint: ${err.message}`);
      }

      if (state.deps?.stateSnapshot) {
        state.deps.stateSnapshot.conversations = { ...state.conversations, [key]: updatedHistory };
        state.deps.stateSnapshot.tokenUsage = state.tokenUsage;
      }
    },
  },

  buildReturn(state, { updatedHistory, executionEvents }) {
    // Tool-protocol authoring: a successful write this round IS forward
    // output. Reset the no-output window and record the authored paths so
    // the execute node's writer-integrity guard / session record / output
    // gate (`_authoredDocPaths`) see tool-channel writes.
    const writtenPaths: string[] = [];
    for (const ev of executionEvents || []) {
      if (ev.toolName !== 'create_file' && ev.toolName !== 'append_file' && ev.toolName !== 'edit_file') continue;
      const content = String(ev.result?.content ?? '');
      if (ev.result?.error || content.startsWith('Error')) continue;
      const p = ev.args?.path;
      if (typeof p === 'string' && p) writtenPaths.push(p);
    }
    const prevAuthored = state._authoredDocPaths || [];
    return {
      conversations: { [activeConvKey(state)]: updatedHistory },
      pendingToolCalls: [],
      ...(writtenPaths.length > 0
        ? {
            _noOutputCallCount: 0,
            _authoredDocPaths: [...new Set([...prevAuthored, ...writtenPaths])],
          }
        : {}),
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
  getRecursionCount(state) { return state.recursionCount; },
  getRecursionLimit(state) { return state.recursionLimit; },
});

export { toolNodeFn as toolNode };
