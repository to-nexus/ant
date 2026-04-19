/**
 * runToolCallsAndCollect — batch tool execution wrapper.
 *
 * Thin facade over ToolOrchestrator for direct-style ReAct loops that own
 * their own conversation history. Tool / execute nodes do not use this — they
 * go through createToolNode() which handles history append inside the factory.
 */

import { ToolOrchestrator, type WorkflowUpdate } from '../../../../../common/tool/orchestrator';
import type { ToolRegistry } from '../../../../../common/tool/registry';
import type {
  ToolCall,
  ToolExecutionContext,
  BatchExecutionResult,
} from '../../../../../common/tool/types';
import type { ToolResultManager, FigmaContext } from '../../../../../../core/utils/toolResultManager';

export interface RunToolCallsInput {
  registry: ToolRegistry;
  resultManager?: ToolResultManager;
  ctx: ToolExecutionContext;
  calls: ToolCall[];
  workflowUpdate?: WorkflowUpdate;
  httpJobId?: string;
  workerId?: number;
  taskInfo?: any;
  recursionCount?: number;
  recursionLimit?: number;
  figmaContext?: FigmaContext;
}

export async function runToolCallsAndCollect(
  input: RunToolCallsInput,
): Promise<BatchExecutionResult> {
  const orchestrator = new ToolOrchestrator({
    registry: input.registry,
    resultManager: input.resultManager,
  });

  return orchestrator.executeBatch(input.ctx, {
    calls: input.calls,
    workflowUpdate: input.workflowUpdate,
    httpJobId: input.httpJobId,
    workerId: input.workerId,
    taskInfo: input.taskInfo,
    recursionCount: input.recursionCount,
    recursionLimit: input.recursionLimit,
    figmaContext: input.figmaContext,
  });
}
