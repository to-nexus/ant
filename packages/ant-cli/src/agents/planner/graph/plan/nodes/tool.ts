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
import { CONV_KEYS, getConv } from '../../../../common/graph/conversations';

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
    return {
      fileSystem: {} as any,
      chatStatus: createChatStatusReporter(),
      workingDir: state.featurePath,
      featurePath: state.featurePath,
      fileTreeUpdate: state.deps?.fileTreeUpdate as any,
    };
  },

  registry: getRegistry(),
  // No resultManager — lightweight graph, no truncation needed

  getHistory(state) {
    return getConv(state.conversations, CONV_KEYS.NODE_GENERATE);
  },

  hooks: {
    onComplete: async (state, _events, { updatedHistory }) => {
      const session = state.deps?.session;
      if (!session) return;
      const pid = session.projectId || process.env.ANT_PROJECT_ID || 'default';
      const fname = session.featureName || process.env.ANT_FEATURE_NAME || 'skeleton';
      try {
        const sessionData = await session.load(pid, fname, 'plan');
        const updatedConversations = {
          ...sessionData.state?.conversations,
          [CONV_KEYS.NODE_GENERATE]: updatedHistory,
        };
        await session.updateArtifacts(pid, fname, 'plan', {
          state: {
            ...sessionData.state,
            conversations: updatedConversations,
            tokenUsage: state.tokenUsage,
          }
        });
        console.log(`💾 [Planner:Tool] Checkpoint saved (${updatedHistory.length} history entries)`);
      } catch (err: any) {
        console.warn(`⚠️ [Planner:Tool] Failed to save checkpoint: ${err.message}`);
      }

      if (state.deps?.stateSnapshot) {
        state.deps.stateSnapshot.conversations = { ...state.conversations, [CONV_KEYS.NODE_GENERATE]: updatedHistory };
        state.deps.stateSnapshot.tokenUsage = state.tokenUsage;
      }
    },
  },

  buildReturn(state, { updatedHistory }) {
    return {
      conversations: { [CONV_KEYS.NODE_GENERATE]: updatedHistory },
      pendingToolCalls: [],
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
