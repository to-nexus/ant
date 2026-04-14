/**
 * Tool Node (Ask Job)
 *
 * Executes pending tool calls using createToolNode factory from common/tool/.
 * Agent node pushes the assistant message; this node appends tool_result only.
 *
 * No ToolResultManager needed (small results, no truncation).
 */

import { AskGraphState, AskToolCall } from '../state';
import { createToolNode } from '../../../../common/tool/createToolNode';
import { createAskToolRegistry } from '../../../../common/tool/presets';
import { ToolRegistry } from '../../../../common/tool/registry';
import { createNoopChatStatusReporter } from '../../../../common/tool/chatStatusAdapter';
import type { ToolHandler } from '../../../../common/tool/types';
import { ToolName } from '../../../../common/tool/toolCatalog';
import {
  readAntSource,
  listAntFiles,
  searchAntCode,
  readWorkspaceFile,
  listWorkspaceFiles,
} from '../tools';

let _registry: ToolRegistry | null = null;

function getRegistry(): ToolRegistry {
  if (_registry) return _registry;
  _registry = createAskToolRegistry();

  const wrap = (fn: (args: any) => Promise<{ success: boolean; content?: string; error?: string }>): ToolHandler =>
    async (_ctx, args) => {
      const result = await fn(args);
      return {
        content: result.success ? (result.content || 'No content returned') : `Error: ${result.error}`,
        error: result.success ? undefined : result.error,
      };
    };

  _registry.register(ToolName.READ_ANT_SOURCE, wrap(readAntSource));
  _registry.register(ToolName.LIST_ANT_FILES, wrap(listAntFiles));
  _registry.register(ToolName.SEARCH_ANT_CODE, wrap(searchAntCode));
  _registry.register(ToolName.READ_WORKSPACE_FILE, wrap(readWorkspaceFile));
  _registry.register(ToolName.LIST_WORKSPACE_FILES, wrap(listWorkspaceFiles));

  return _registry;
}

const toolNodeFn = createToolNode<AskGraphState>({
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
      chatStatus: createNoopChatStatusReporter(),
      workingDir: state.featurePath || process.cwd(),
    };
  },

  registry: getRegistry(),
  // No resultManager — lightweight graph, no truncation needed

  getHistory(state) {
    return state.conversationHistory;
  },

  buildReturn(state, { updatedHistory, executionEvents }) {
    const toolCallRecords: AskToolCall[] = executionEvents.map(e => ({
      name: e.toolName,
      args: e.args,
      result: typeof e.result.content === 'string' ? e.result.content : JSON.stringify(e.result.content),
      error: e.result.error,
      timestamp: Date.now(),
    }));

    return {
      conversationHistory: updatedHistory,
      toolCalls: [...state.toolCalls, ...toolCallRecords],
      pendingToolCalls: [],
    };
  },
});

export { toolNodeFn as toolNode };
