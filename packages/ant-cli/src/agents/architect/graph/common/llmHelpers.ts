/**
 * LLM Helpers - Centralized token tracking middleware
 * 
 * Provides wrapper functions that automatically track token usage
 * and accumulate to state, eliminating code duplication across nodes.
 */

import { LLMClient, LLMInvokeResult, CacheableContent } from '../../../../core/ports/llm';
import { TaskTokenUsage } from '../../types/task';

/**
 * Re-export TaskTokenUsage as TokenUsage for convenience
 */
export type TokenUsage = TaskTokenUsage;

/**
 * State interface for token tracking
 * (Minimal interface - actual state can have more fields)
 */
export interface TokenTrackingState {
  _currentTaskTokenUsage?: TokenUsage;
  tokenUsage?: TokenUsage;  // Job-level token usage
}

/**
 * Initialize token usage object with zeros
 */
function initTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

/**
 * Accumulate token usage from LLM response to state
 * Updates both task-level and job-level counters
 */
export function accumulateTokenUsage(
  state: TokenTrackingState,
  usage: TokenUsage,
  options: {
    taskLevel?: boolean;  // Accumulate to task-level counter (default: true)
    jobLevel?: boolean;   // Accumulate to job-level counter (default: true)
  } = {}
): void {
  const { taskLevel = true, jobLevel = true } = options;
  
  // Task-level accumulation
  if (taskLevel) {
    if (!state._currentTaskTokenUsage) {
      state._currentTaskTokenUsage = initTokenUsage();
    }
    
    // ✅ inputTokens는 cache 제외한 "새로운" 토큰만 포함
    state._currentTaskTokenUsage.inputTokens += usage.inputTokens;
    state._currentTaskTokenUsage.outputTokens += usage.outputTokens;
    state._currentTaskTokenUsage.totalTokens += usage.totalTokens;
    
    // ✅ 캐시 토큰은 별도 누적
    if (usage.cacheReadTokens) {
      state._currentTaskTokenUsage.cacheReadTokens = 
        (state._currentTaskTokenUsage.cacheReadTokens || 0) + usage.cacheReadTokens;
    }
    if (usage.cacheCreationTokens) {
      state._currentTaskTokenUsage.cacheCreationTokens = 
        (state._currentTaskTokenUsage.cacheCreationTokens || 0) + usage.cacheCreationTokens;
    }
  }
  
  // Job-level accumulation
  if (jobLevel) {
    if (!state.tokenUsage) {
      state.tokenUsage = initTokenUsage();
    }
    
    state.tokenUsage.inputTokens += usage.inputTokens;
    state.tokenUsage.outputTokens += usage.outputTokens;
    state.tokenUsage.totalTokens += usage.totalTokens;
    
    if (usage.cacheReadTokens) {
      state.tokenUsage.cacheReadTokens = 
        (state.tokenUsage.cacheReadTokens || 0) + usage.cacheReadTokens;
    }
    if (usage.cacheCreationTokens) {
      state.tokenUsage.cacheCreationTokens = 
        (state.tokenUsage.cacheCreationTokens || 0) + usage.cacheCreationTokens;
    }
  }
}

/**
 * Invoke LLM with automatic token tracking
 * Supports both simple string prompts and cacheable content blocks
 * 
 * @param llm - LLM client
 * @param messages - Messages to send (string or CacheableContent[])
 * @param state - State object for token accumulation
 * @param options - Invoke options and tracking options
 * @returns LLM response content
 */
export async function invokeWithTracking(
  llm: LLMClient,
  messages: Array<{ role: string; content: string | CacheableContent[] }>,
  state: TokenTrackingState,
  options: {
    // LLM options
    temperature?: number;
    maxTokens?: number;
    // Tracking options
    taskLevel?: boolean;
    jobLevel?: boolean;
  } = {}
): Promise<string> {
  const { temperature, maxTokens, taskLevel = true, jobLevel = true } = options;
  
  // Use invokeWithUsage if available, fallback to invoke
  if (llm.invokeWithUsage) {
    const result = await llm.invokeWithUsage(messages, { temperature, maxTokens });
    
    if (result.usage) {
      accumulateTokenUsage(state, result.usage, { taskLevel, jobLevel });
    }
    
    return result.content;
  } else {
    // Fallback: no token tracking
    return await llm.invoke(messages, { temperature, maxTokens });
  }
}

/**
 * Reset task-level token counter
 * Call this when starting a new task
 */
export function resetTaskTokenUsage(state: TokenTrackingState): void {
  state._currentTaskTokenUsage = initTokenUsage();
}

/**
 * Get current task token usage
 * Returns zero-initialized usage if not yet set
 */
export function getTaskTokenUsage(state: TokenTrackingState): TokenUsage {
  return state._currentTaskTokenUsage || initTokenUsage();
}

/**
 * Get job-level token usage
 * Returns zero-initialized usage if not yet set
 */
export function getJobTokenUsage(state: TokenTrackingState): TokenUsage {
  return state.tokenUsage || initTokenUsage();
}

/**
 * Process LLM stream event and extract token usage
 * Use this when iterating over stream events
 * 
 * @param event - Stream event from LLM
 * @returns Token usage if present in done event, undefined otherwise
 */
export function extractTokenUsageFromStreamEvent(event: any): TokenUsage | undefined {
  if (event.type === 'done' && event.usage) {
    return {
      inputTokens: event.usage.inputTokens || 0,
      outputTokens: event.usage.outputTokens || 0,
      totalTokens: (event.usage.inputTokens || 0) + (event.usage.outputTokens || 0),
      cacheReadTokens: event.usage.cacheReadTokens,
      cacheCreationTokens: event.usage.cacheCreationTokens,
    };
  }
  return undefined;
}

/**
 * Stream wrapper that automatically tracks tokens
 * Call this after stream completes with the accumulated token usage
 * 
 * Example:
 * ```
 * let capturedUsage: TokenUsage | undefined;
 * for await (const event of llm.stream(...)) {
 *   capturedUsage = extractTokenUsageFromStreamEvent(event) || capturedUsage;
 * }
 * if (capturedUsage) {
 *   finalizeStreamTokenUsage(state, capturedUsage);
 * }
 * ```
 */
export function finalizeStreamTokenUsage(
  state: TokenTrackingState,
  usage: TokenUsage,
  options: {
    taskLevel?: boolean;
    jobLevel?: boolean;
  } = {}
): void {
  accumulateTokenUsage(state, usage, options);
  
  // Log token usage
  console.log(`   Tokens: ${usage.totalTokens} total (${usage.inputTokens} in, ${usage.outputTokens} out)`);
  if (usage.cacheReadTokens) {
    console.log(`   Cache read: ${usage.cacheReadTokens} tokens`);
  }
  if (usage.cacheCreationTokens) {
    console.log(`   Cache creation: ${usage.cacheCreationTokens} tokens`);
  }
}

/**
 * Update Kanban with real-time token usage for in-progress task
 * Call this after each LLM interaction to reflect token consumption immediately
 */
export function updateKanbanTokenUsage(
  state: any  // ArchitectGraphState or DesignGraphState
): void {
  if (!state._httpJobId || !state.deps?.kanbanUpdate || !state.currentTask) {
    return;
  }
  
  const tokenUsage = getTaskTokenUsage(state);
  
  // Only update if there's actual token usage
  if (tokenUsage.totalTokens === 0) {
    return;
  }
  
  // Get current snapshot to preserve other data
  const taskQueue = (state as any).taskQueue;
  const queue = taskQueue ? taskQueue.getRemaining() : [];
  const completedTasks = (state as any).completedTasksDetails || [];
  
  console.log(`[Token Usage] 📊 Updating Kanban with real-time tokens: ${tokenUsage.totalTokens} total`);
  
  state.deps.kanbanUpdate.updateTaskQueue(
    state._httpJobId,
    state.currentTask,
    queue,
    completedTasks,
    (state as any).recursionCount,
    (state as any).recursionLimit,
    tokenUsage  // ✅ Real-time token usage
  );
}

