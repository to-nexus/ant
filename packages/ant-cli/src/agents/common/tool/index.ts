/**
 * Unified Tool System — public API
 */

export type {
  ChatStatusReporter,
  ToolExecutionContext,
  ToolResult,
  ToolSideEffect,
  ToolHandler,
  ToolCall,
  ToolExecutionEvent,
  BatchExecutionResult,
  CommandPort,
  GitPort,
  FileTreeUpdatePort,
} from './types';

export {
  ToolName,
  JobType,
  TOOL_DISPLAY_NAMES,
  TOOL_HANDLERS,
  JOB_TOOL_MATRIX,
  TOOL_SETS,
  SHADOW_ALIASES,
  CACHEABLE_TOOLS,
  FIGMA_TOOLS,
  resolveToolName,
  isFigmaTool,
  getToolsForJob,
  getAllToolNames,
} from './toolCatalog';

export { ToolRegistry } from './registry';

export { createChatStatusReporter, createNoopChatStatusReporter } from './chatStatusAdapter';

export {
  createCodeToolRegistry,
  createDesignToolRegistry,
  createPlanToolRegistry,
  createAskToolRegistry,
} from './presets';

export { ToolOrchestrator } from './orchestrator';
export type { OrchestratorConfig, OrchestratorBatchOptions, WorkflowUpdate } from './orchestrator';

export { buildToolResultMessage, buildAssistantMessage } from './messageBuilder';
export type { AssistantMessageOptions } from './messageBuilder';

export { createToolNode } from './createToolNode';
export type { ToolNodeConfig } from './createToolNode';
