/**
 * LLM Helpers - Centralized token tracking middleware
 * 
 * Provides wrapper functions that automatically track token usage
 * and accumulate to state, eliminating code duplication across nodes.
 * 
 * Architecture: docs/architecture/13-token-usage-tracking.md
 */

import { LLMClient, LLMInvokeResult, CacheableContent, LLMStreamEvent } from '../../../core/ports/llm';
import { TaskTokenUsage, PhaseTokenUsage } from '@ant/shared';
import { getTokenLogger, TokenLogContext } from '../../../core/utils/tokenLogger';
import { getEstimatingLabel, resolveNodePhaseLabel, type UILocale } from './timing/estimatingLabels';

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
  /**
   * Latest single LLM-call snapshot of the currently-running graph node.
   * Reset at node entry via `beginNodePhase()`. Overwritten (NOT accumulated)
   * by `accumulateTokenUsage()` since each call's `inputTokens` already
   * represents the full prompt sent. Used by the chat input context gauge.
   */
  currentPhaseTokenUsage?: PhaseTokenUsage;
}

/**
 * Mark the start of a graph node's LLM activity.
 * Resets the `currentPhaseTokenUsage` snapshot so subsequent `accumulateTokenUsage`
 * calls overwrite cleanly.
 *
 * The seeded snapshot carries `workerId` / `taskName` so parallel workers each
 * produce their own battery entry on the chat-input gauge.
 *
 * ⚠️ SSOT: Do NOT call this directly from inside a graph node. The two authorized
 * callers are:
 *  - `withPhaseTracking()` wrapping the node at graph wiring (phase label lookup
 *    via `resolveNodePhaseLabel`).
 *  - `applyEstimatingUsage()` for estimating sub-nodes (triage / detect / decompose)
 *    when an external subgraph returns a usage snapshot.
 */
export function beginNodePhase(
  state: TokenTrackingState,
  phase: string,
  label?: string,
): void {
  const workerId = (state as any).workerId;
  const taskName = (state as any).currentTask?.name;
  state.currentPhaseTokenUsage = {
    phase,
    ...(label && { label }),
    tokenUsage: initTokenUsage(),
    ...(typeof workerId === 'number' && { workerId }),
    ...(typeof taskName === 'string' && taskName.length > 0 && { taskName }),
  };
}

/**
 * Higher-order wrapper that seeds `currentPhaseTokenUsage` for a graph node
 * before invoking it. Applied at graph wiring time:
 *
 *   graph.addNode('plan', withPhaseTracking('plan', plan) as any);
 *
 * This is the SSOT for phase initialization — node implementations MUST NOT
 * call `beginNodePhase` themselves. The label is resolved via
 * `resolveNodePhaseLabel(phaseId, locale)` so there is exactly one place that
 * maps phase ids to human-readable wording.
 */
export function withPhaseTracking<S extends TokenTrackingState, R>(
  phaseId: string,
  node: (state: S) => Promise<R> | R,
): (state: S) => Promise<R> {
  return async (state: S): Promise<R> => {
    const locale = ((state as any)._uiLocale as UILocale | undefined) ?? 'en';
    beginNodePhase(state, phaseId, resolveNodePhaseLabel(phaseId, locale));
    return await node(state);
  };
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
    callCount: 0,
  };
}

/**
 * Helper: compute non-cache total from raw fields
 */
function computeTotal(usage: TokenUsage): number {
  return (usage.inputTokens || 0) + (usage.outputTokens || 0);
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
    
    state._currentTaskTokenUsage.inputTokens += usage.inputTokens;
    state._currentTaskTokenUsage.outputTokens += usage.outputTokens;
    state._currentTaskTokenUsage.totalTokens = computeTotal(state._currentTaskTokenUsage);
    state._currentTaskTokenUsage.callCount = (state._currentTaskTokenUsage.callCount ?? 0) + 1;
    
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
    state.tokenUsage.totalTokens = computeTotal(state.tokenUsage);
    state.tokenUsage.callCount = (state.tokenUsage.callCount ?? 0) + 1;
    
    if (usage.cacheReadTokens) {
      state.tokenUsage.cacheReadTokens = 
        (state.tokenUsage.cacheReadTokens || 0) + usage.cacheReadTokens;
    }
    if (usage.cacheCreationTokens) {
      state.tokenUsage.cacheCreationTokens = 
        (state.tokenUsage.cacheCreationTokens || 0) + usage.cacheCreationTokens;
    }
  }

  // Current-node snapshot (overwrite, not accumulate).
  // Each call's inputTokens already includes the full prompt (system + history +
  // current message), so accumulating across calls in the same node produces a
  // misleading number. Overwriting keeps the gauge at the true current context
  // fullness. Only updates if `beginNodePhase()` has initialized the snapshot.
  //
  // SSOT: accumulateTokenUsage is the SINGLE authorized publisher of the
  // chat-input token-gauge update. Other helpers
  // (updateKanbanTokenUsage / applyEstimatingUsage / direct updateTokenUsage
  // calls in visual nodes) MUST NOT invoke `updateCurrentPhaseTokenUsage` —
  // they rely on this block to broadcast once per LLM call.
  if (state.currentPhaseTokenUsage) {
    state.currentPhaseTokenUsage.tokenUsage = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.inputTokens + usage.outputTokens,
      ...(usage.cacheReadTokens !== undefined && { cacheReadTokens: usage.cacheReadTokens }),
      ...(usage.cacheCreationTokens !== undefined && { cacheCreationTokens: usage.cacheCreationTokens }),
      callCount: 1,
    };

    const kanbanUpdate = (state as KanbanUpdatableState).deps?.kanbanUpdate;
    kanbanUpdate?.updateCurrentPhaseTokenUsage?.(state.currentPhaseTokenUsage);
  }
}

/**
 * State interface for phase-level token tracking (visual/plan jobs).
 */
export interface PhaseTrackingState {
  phaseTokenUsages?: PhaseTokenUsage[];
}

/**
 * Upsert a phase's token usage into phaseTokenUsages array.
 * Merges if a matching phase already exists (for looping nodes like generate/direct).
 */
export function upsertPhaseTokenUsage(
  state: PhaseTrackingState,
  phase: string,
  usage: TaskTokenUsage,
  label?: string,
): void {
  if (!state.phaseTokenUsages) {
    state.phaseTokenUsages = [];
  }

  const existing = state.phaseTokenUsages.find(p => p.phase === phase);
  if (existing) {
    existing.tokenUsage.inputTokens += usage.inputTokens;
    existing.tokenUsage.outputTokens += usage.outputTokens;
    existing.tokenUsage.totalTokens =
      existing.tokenUsage.inputTokens + existing.tokenUsage.outputTokens;
    existing.tokenUsage.callCount = (existing.tokenUsage.callCount ?? 0) + 1;
    if (usage.cacheReadTokens) {
      existing.tokenUsage.cacheReadTokens =
        (existing.tokenUsage.cacheReadTokens || 0) + usage.cacheReadTokens;
    }
    if (usage.cacheCreationTokens) {
      existing.tokenUsage.cacheCreationTokens =
        (existing.tokenUsage.cacheCreationTokens || 0) + usage.cacheCreationTokens;
    }
    if (label) existing.label = label;
  } else {
    state.phaseTokenUsages.push({
      phase,
      label,
      tokenUsage: { ...usage, callCount: usage.callCount ?? 1 },
    });
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
    enableThinking?: boolean;
    thinkingBudget?: number;
    // Tracking options
    taskLevel?: boolean;
    jobLevel?: boolean;
  } = {}
): Promise<string> {
  const { temperature, maxTokens, enableThinking, thinkingBudget, taskLevel = true, jobLevel = true } = options;
  
  // Use invokeWithUsage if available, fallback to invoke
  if (llm.invokeWithUsage) {
    const result = await llm.invokeWithUsage(messages, { temperature, maxTokens, enableThinking, thinkingBudget });
    
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
    const input = event.usage.inputTokens || 0;
    const output = event.usage.outputTokens || 0;
    return {
      inputTokens: input,
      outputTokens: output,
      totalTokens: input + output,
      cacheReadTokens: event.usage.cacheReadTokens,
      cacheCreationTokens: event.usage.cacheCreationTokens,
    };
  }
  return undefined;
}

/**
 * Log token usage to debug file (non-blocking, fire-and-forget).
 * Call this after each LLM call with the captured usage and context.
 * 
 * @param featurePath - Absolute path to feature directory
 * @param jobId - Job identifier
 * @param usage - Token usage from API response
 * @param context - Call context (task, node, metrics)
 */
export function logTokenUsageToFile(
  featurePath: string | undefined,
  jobId: string | undefined,
  usage: TokenUsage,
  context: TokenLogContext
): void {
  if (!featurePath || !jobId) return;

  // Fire-and-forget: don't await, don't block execution
  const logger = getTokenLogger({ featurePath, jobId });
  logger.log(usage, context).catch(() => {
    // Silently ignore - non-blocking
  });
}

export interface KanbanUpdatableState extends TokenTrackingState {
  _httpJobId?: string;
  currentTask?: any;
  deps?: { kanbanUpdate?: any; [key: string]: any };
  workerId?: number;
  taskQueue?: any;
  completedTasksDetails?: any[];
  recursionCount?: number;
  recursionLimit?: number;
}

/**
 * Update Kanban with real-time token usage for in-progress task.
 * Call this after each LLM interaction to reflect token consumption immediately.
 *
 * Copies task-level usage onto currentTask so individual task cards update,
 * and passes job-level usage to the broadcaster for the header badge.
 */
export function updateKanbanTokenUsage(state: KanbanUpdatableState): void {
  if (!state._httpJobId || !state.deps?.kanbanUpdate || !state.currentTask) {
    return;
  }
  
  const taskTokens = getTaskTokenUsage(state);
  const jobTokens = getJobTokenUsage(state);

  // Note: `updateCurrentPhaseTokenUsage` is NOT broadcast here. That SSOT
  // lives in `accumulateTokenUsage()` — any LLM call that reaches this
  // function has already triggered it.

  const isWorkerCtx = state.workerId !== undefined && state.workerId !== null;
  if (isWorkerCtx) {
    state.currentTask.tokenUsage = { ...taskTokens };
    state.deps.kanbanUpdate.updateInProgressTaskTokenUsage?.(
      state.currentTask.id,
      { ...taskTokens }
    );
    return;
  }
  
  if (computeTotal(jobTokens) === 0) {
    return;
  }
  
  // Sync task-level accumulation onto the live task object so the
  // broadcaster's snapshot includes per-task token counts.
  state.currentTask.tokenUsage = { ...taskTokens };
  
  const taskQueue = state.taskQueue;
  const queue = taskQueue ? (taskQueue.getRemaining?.() ?? taskQueue.getAll?.() ?? []) : [];
  const completedTasks = state.completedTasksDetails || [];
  
  state.deps.kanbanUpdate.updateTaskQueue(
    state._httpJobId,
    state.currentTask,
    queue,
    completedTasks,
    state.recursionCount,
    state.recursionLimit,
    jobTokens
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Estimating-phase unified LLM runner (triage / detect / decompose)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// All LLM calls made BEFORE a task queue exists must route through one of
// these three entry points. They guarantee:
//   1. `setEstimatingActivity(nodeId)` is called so `updateTokenUsage`'s
//      broadcast gate always passes.
//   2. Token usage is accumulated to job-level only (`taskLevel: false`),
//      since `_currentTaskTokenUsage` belongs to per-task execution.
//   3. `updateTokenUsage(state.tokenUsage)` is broadcast after every call.
//   4. `logTokenUsageToFile` is written to `debug/tokens/token-{jobId}.json`
//      with `{ taskId: 'estimating', node: nodeId }` — so detect/triage
//      LLM calls appear in the debug log (previously absent).
//
// See docs/architecture/13-token-usage-tracking.md for the full rationale.

export type EstimatingNodeId = 'triage' | 'detect' | 'decompose';

export interface EstimatingState extends KanbanUpdatableState {
  _uiLocale?: UILocale;
  featurePath?: string;
  context?: { featurePath?: string; [key: string]: any };
  tokenUsage?: TokenUsage;
}

export interface EstimatingOpts {
  /** Sub-node identifier (e.g. 'system', 'ui', 'repair') for debug logging */
  subNode?: string;
  /** Caller-maintained call index for debug log disambiguation */
  callIndex?: number;
  /** Estimated prompt char count for TokenLogger */
  promptChars?: number;
}

function resolveFeaturePath(state: EstimatingState): string | undefined {
  return state.context?.featurePath ?? state.featurePath;
}

function ensureEstimatingActivity(state: EstimatingState, nodeId: EstimatingNodeId): void {
  const label = getEstimatingLabel(nodeId, state._uiLocale);
  state.deps?.kanbanUpdate?.setEstimatingActivity?.(label, nodeId);
}

/**
 * Apply a captured usage to the estimating pipeline without running the LLM.
 *
 * Used when an external subgraph (e.g. the ask graph invoked from triage)
 * has already executed the LLM and returned a usage snapshot — there's
 * nothing to wrap, but we still need the uniform accumulate + broadcast +
 * log sequence the rest of the estimating phase relies on.
 */
export function applyEstimatingUsage(
  state: EstimatingState,
  nodeId: EstimatingNodeId,
  usage: TokenUsage | undefined,
  opts: EstimatingOpts = {},
): void {
  if (!usage) return;

  ensureEstimatingActivity(state, nodeId);
  // Seed the current-node snapshot so `accumulateTokenUsage` has a target to
  // overwrite. Label is the localized estimating label already used for the
  // kanban banner — keeps the gauge tooltip wording consistent.
  if (!state.currentPhaseTokenUsage || state.currentPhaseTokenUsage.phase !== nodeId) {
    beginNodePhase(state, nodeId, getEstimatingLabel(nodeId, state._uiLocale));
  }
  accumulateTokenUsage(state, usage, { taskLevel: false, jobLevel: true });

  if (state.tokenUsage) {
    state.deps?.kanbanUpdate?.updateTokenUsage?.(state.tokenUsage);
  }
  // Note: currentPhaseTokenUsage broadcast handled by accumulateTokenUsage (SSOT).

  logTokenUsageToFile(resolveFeaturePath(state), state._httpJobId, usage, {
    taskId: 'estimating',
    taskName: opts.subNode ?? nodeId,
    node: nodeId,
    callIndex: opts.callIndex ?? 0,
    estimatedPromptChars: opts.promptChars ?? 0,
  });

  console.log(
    `   [${nodeId}${opts.subNode ? ':' + opts.subNode : ''}] Tokens: ` +
    `${(usage.totalTokens ?? (usage.inputTokens + usage.outputTokens))} total ` +
    `(${usage.inputTokens} in, ${usage.outputTokens} out)`,
  );
}

/**
 * Run an `invokeWithUsage`-style LLM call with uniform estimating-phase bookkeeping.
 */
export async function runEstimatingLLM(
  state: EstimatingState,
  nodeId: EstimatingNodeId,
  invoke: () => Promise<{ content: string; usage?: TokenUsage }>,
  opts: EstimatingOpts = {},
): Promise<{ content: string; usage?: TokenUsage }> {
  ensureEstimatingActivity(state, nodeId);
  const { content, usage } = await invoke();
  if (usage) {
    applyEstimatingUsage(state, nodeId, usage, opts);
  }
  return { content, usage };
}

/**
 * Run a streaming LLM call with uniform estimating-phase bookkeeping.
 *
 * The `consume` callback receives each stream event (text / retry / etc.) so
 * the caller can build the response string, feed a UI orchestrator, or
 * handle retries. Returning `null` from `consume` on a `retry` event causes
 * the accumulated response to be reset.
 */
export async function runEstimatingLLMStream(
  state: EstimatingState,
  nodeId: EstimatingNodeId,
  stream: () => AsyncIterable<LLMStreamEvent>,
  consume: (event: LLMStreamEvent, currentResponse: string) => string | void | Promise<string | void>,
  opts: EstimatingOpts = {},
): Promise<{ response: string; usage?: TokenUsage }> {
  ensureEstimatingActivity(state, nodeId);

  let response = '';
  let capturedUsage: TokenUsage | undefined;

  for await (const event of stream()) {
    if (event.type === 'retry') {
      response = '';
      capturedUsage = undefined;
      const next = await consume(event, response);
      if (typeof next === 'string') response = next;
      continue;
    }

    const usage = extractTokenUsageFromStreamEvent(event);
    if (usage) capturedUsage = usage;

    if (event.text) response += event.text;
    const next = await consume(event, response);
    if (typeof next === 'string') response = next;
  }

  if (capturedUsage) {
    applyEstimatingUsage(state, nodeId, capturedUsage, opts);
  }

  return { response, usage: capturedUsage };
}
