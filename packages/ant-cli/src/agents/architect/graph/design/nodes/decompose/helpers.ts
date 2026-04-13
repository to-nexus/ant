/**
 * Design Decompose - Shared Helpers
 * 
 * Common utilities for JSON parsing, checkpoint saving, 
 * Kanban updates, and default task creation.
 */

import { DesignGraphState } from "../../state";
import { DesignTask } from "../../../../types/task";
import { logPrompt } from "../../../../../../core/utils/promptLogger";
import { extractLLMInfo } from "../../../../../../core/ports/workflow";

// ============================================
// JSON Response Parsing
// ============================================

/**
 * Escape unescaped control characters inside JSON string literals.
 */
function sanitizeJsonControlChars(jsonStr: string): string {
  return jsonStr.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
    return match.replace(/[\x00-\x1f]/g, (ch) => {
      switch (ch) {
        case '\n': return '\\n';
        case '\r': return '\\r';
        case '\t': return '\\t';
        case '\b': return '\\b';
        case '\f': return '\\f';
        default: {
          const code = ch.charCodeAt(0).toString(16).padStart(4, '0');
          return `\\u${code}`;
        }
      }
    });
  });
}

/**
 * Parse LLM JSON response.
 * Priority: <decompose> tag → raw JSON → ```json fenced → embedded object with "tasks".
 */
export function parseLLMJsonResponse(textResponse: string): any {
  const trimmed = (textResponse || '').trim();

  const tagMatch = trimmed.match(/<decompose>\s*([\s\S]*?)\s*<\/decompose>/);
  if (tagMatch) return JSON.parse(sanitizeJsonControlChars(tagMatch[1]));

  try {
    return JSON.parse(sanitizeJsonControlChars(trimmed));
  } catch {
    const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/);
    const candidate = fenced?.[1] || trimmed.match(/\{[\s\S]*"tasks"[\s\S]*\}/)?.[0];
    if (!candidate) {
      throw new Error('Could not parse task breakdown from LLM response');
    }
    return JSON.parse(sanitizeJsonControlChars(candidate));
  }
}

// ============================================
// Checkpoint Saving
// ============================================

export interface CheckpointData {
  taskQueue: DesignTask[];
  currentTask?: DesignTask;
  completedTasks: string[];
  completedTasksDetails: DesignTask[];
  jobId: string;
  jobTiming: any;
  tokenUsage?: any;
  estimatingTokenUsage?: any;
  overrideDirective?: string;
  chatSource?: any;
  userLanguage?: string;
  techTier?: import('@ant/shared').TechTier;
}

/**
 * Save decompose checkpoint to session.
 */
export async function saveCheckpoint(
  state: DesignGraphState,
  data: CheckpointData
): Promise<void> {
  if (!state.deps?.session || !state.context.featureFolder) return;
  
  try {
    await state.deps.session.updateArtifacts(
      state.context.project,
      state.context.featureFolder,
      'design',
      {
        state: {
          taskQueue: data.taskQueue,
          currentTask: data.currentTask,
          completedTasks: data.completedTasks,
          completedTasksDetails: data.completedTasksDetails,
          jobId: data.jobId,
          jobTiming: data.jobTiming,
          tokenUsage: data.tokenUsage,
          estimatingTokenUsage: data.estimatingTokenUsage,
          overrideDirective: data.overrideDirective,
          chatSource: data.chatSource,
          userLanguage: data.userLanguage,
          techTier: data.techTier,
        }
      }
    );
  } catch (error) {
    console.warn(`⚠️  [Design Decompose] Failed to save checkpoint:`, error);
  }
}

// ============================================
// Kanban Updates
// ============================================

/**
 * Send Kanban task queue update.
 */
export function updateKanban(
  state: DesignGraphState,
  currentTask: DesignTask | null,
  queue: DesignTask[],
  completed: any[] = [],
  recursionCount = 0
): void {
  if (!state._httpJobId || !state.deps?.kanbanUpdate) return;
  state.deps.kanbanUpdate.updateTaskQueue(
    state._httpJobId,
    currentTask,
    queue,
    completed,
    recursionCount,
    undefined
  );
}

// ============================================
// Default Task Creation
// ============================================

/**
 * Create a single default design task (fallback when spec is empty or LLM fails).
 */
export function createDefaultTask(): DesignTask {
  return {
    id: 'design-doc',
    name: 'Create Design Document',
    type: 'doc',
    priority: 250,
    description: 'Create design document based on requirements',
    completed: false
  };
}

/**
 * Create explain mode task.
 */
export function createExplainTask(state: DesignGraphState): DesignTask {
  return {
    id: 'explain-1',
    name: 'Explain: Design documents',
    type: 'doc',
    priority: 200,
    targetFile: state.resolvedAction?.intentGroup === 'design-ui' ? 'ui-spec.json' : 'be-system-main.md',
    description: state.directive || 'Analyze and explain the design documents'
  };
}

// ============================================
// Prompt Logging
// ============================================

/**
 * Log prompt structure to debug file (non-blocking, never throws).
 */
export async function safeLogPrompt(
  featurePath: string | undefined,
  jobId: string,
  subNode: string,
  promptLength: number,
  metadata: Record<string, any>
): Promise<void> {
  if (!featurePath) return;
  try {
    await logPrompt(featurePath, jobId, 'design', subNode, promptLength, metadata);
  } catch {
    // Non-critical
  }
}

// ============================================
// LLM Client Resolution
// ============================================

/**
 * Get LLM client, optionally overridden by workspace config.
 */
export async function resolveLLMClient(state: DesignGraphState) {
  const llm = state.deps?.llm;
  if (!state.workspaceConfig) return llm;
  
  const { createLLMClient } = await import('../../../../../../periphery/adapters/llm/LLMClientFactory');
  return createLLMClient(
    'architect',
    undefined,
    { jobType: 'design', nodeType: 'decompose' },
    state.workspaceConfig
  );
}

/**
 * Show chat placeholder before LLM call.
 */
export async function showChatPlaceholder(): Promise<void> {
  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');
}

/** Internal call counter for decompose token logging */
let _decomposeCallIndex = 0;

/** Reset decompose call counter (call at decompose start) */
export function resetDecomposeCallIndex(): void {
  _decomposeCallIndex = 0;
}

/**
 * Accumulate token usage from LLM result (job-level only for decompose).
 */
export async function trackTokenUsage(state: DesignGraphState, usage: any, subNode?: string): Promise<void> {
  if (!usage) return;
  const { accumulateTokenUsage, logTokenUsageToFile } = await import('../../../../../common/graph/llmHelpers');
  accumulateTokenUsage(state, usage, { taskLevel: false, jobLevel: true });
  // ✅ Push live token update to Kanban UI during estimating phase
  if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
    state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage);
  }
  
  logTokenUsageToFile(
    state.context?.featurePath,
    state.jobId || state._httpJobId,
    usage,
    {
      taskId: 'estimating',
      taskName: subNode || 'decompose',
      node: 'decompose',
      callIndex: _decomposeCallIndex++,
    }
  );
}

// ============================================
// Workflow Instrumentation
// ============================================

export async function enterDecomposeNode(state: DesignGraphState): Promise<void> {
  // ✅ Increment recursion count (track node execution for UI gauge)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  if (!state.deps?.workflowUpdate || !state._httpJobId) return;
  const taskInfo = state.currentTask ? {
    id: state.currentTask.id,
    name: state.currentTask.name,
    type: state.currentTask.type,
    description: state.currentTask.description,
    priority: state.currentTask.priority
  } : undefined;
  await state.deps.workflowUpdate.enterNode(
    state._httpJobId, 'decompose', 0, taskInfo,
    state.deps?.llm ? extractLLMInfo(state.deps.llm) : undefined,
    state.recursionCount, state.recursionLimit
  );
}

export async function exitDecomposeNode(state: DesignGraphState): Promise<void> {
  if (!state.deps?.workflowUpdate || !state._httpJobId) return;
  await state.deps.workflowUpdate.exitNode(state._httpJobId, 'decompose', 0);
}
