/**
 * LLM Helpers - Centralized token tracking middleware
 * 
 * Provides wrapper functions that automatically track token usage
 * and accumulate to state, eliminating code duplication across nodes.
 * 
 * Architecture: docs/architecture/13-token-usage-tracking.md
 */

import { LLMClient, LLMInvokeResult, CacheableContent, LLMStreamEvent } from '../../../core/ports/llm';
import { TaskTokenUsage, PhaseTokenUsage, TokenUsageByModel, getModelContextWindow } from '@ant/shared';
import { getTokenLogger, TokenLogContext } from '../../../core/utils/tokenLogger';
import { getEstimatingLabel, resolveNodePhaseLabel, type UILocale } from './timing/estimatingLabels';

/**
 * Resolve the active model id from the graph state. SSOT lookup path is
 * `state.deps.llm.modelName` — every LLM-calling node has an `LLMClient`
 * injected through `state.deps.llm`, and the `LLMClient` interface exposes
 * `readonly modelName: string`. Throws if missing so a misconfigured DI
 * surfaces immediately instead of producing a silent denominator drift.
 */
function resolveModelName(state: TokenTrackingState): string {
  const deps = (state as { deps?: { llm?: { modelName?: string } } }).deps;
  const modelName = deps?.llm?.modelName;
  if (!modelName) {
    throw new Error(
      '[llmHelpers] state.deps.llm.modelName is missing — every LLM-calling ' +
      'node must inject an LLMClient via state.deps.llm. No silent fallback.',
    );
  }
  return modelName;
}

/**
 * Resolve the live model id for debug-log / cost attribution, never throwing.
 * Returns `'unknown'` when DI has not injected an LLMClient (estimating
 * pre-RAC nodes, tests). Billing prices `'unknown'` conservatively.
 */
export function resolveModelIdSafe(state: { deps?: { llm?: { modelName?: string } | any } | any }): string {
  return state?.deps?.llm?.modelName ?? 'unknown';
}

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
   * Per-model job-level token usage, keyed by `state.deps.llm.modelName`.
   * Accumulated alongside `tokenUsage` so the billing pipeline can price each
   * model's tokens at its own rate (a job mixes models across nodes). SSOT for
   * accurate cost — `tokenUsage` is the model-agnostic sum, this is the
   * cost-bearing breakdown.
   */
  tokenUsageByModel?: TokenUsageByModel;
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
 * calls overwrite cleanly AND broadcasts the zero-seed immediately so the
 * chat-input gauge does not linger on the previous node's final numbers.
 *
 * The seeded snapshot carries `workerId` / `taskName` so parallel workers each
 * produce their own battery entry on the chat-input gauge.
 *
 * ⚠️ SSOT: preferred callers:
 *  - `withPhaseTracking()` wrapping the node at graph wiring (phase label lookup
 *    via `resolveNodePhaseLabel`).
 *  - `applyEstimatingUsage()` for estimating sub-nodes (triage / detect / decompose)
 *    when an external subgraph returns a usage snapshot.
 *
 * Direct calls are permitted for nodes that (a) are NOT wrapped by
 * `withPhaseTracking` AND (b) need the gauge seeded EARLY so in-flight
 * `usage_partial` events have a target to overwrite before
 * `applyEstimatingUsage` runs at stream end (e.g. code-graph `decompose`).
 * `applyEstimatingUsage` tolerates a pre-existing snapshot for the same
 * phase id — it re-seeds only when absent or mismatched — so such direct
 * calls are idempotent with the estimating bookkeeping.
 */
export function beginNodePhase(
  state: TokenTrackingState,
  phase: string,
  label?: string,
): void {
  const workerId = (state as any).workerId;
  const taskName = (state as any).currentTask?.name;
  // Zero-seed carries the live model's full context window so the gauge has
  // a correct denominator from frame 0, even before the first usage_partial
  // arrives. `mode: 'live'` because subsequent overwrites all flow from LLM
  // API events; the only `mode: 'estimating'` writer is
  // `applyEstimatedInputTokens` further below.
  const modelName = resolveModelName(state);
  state.currentPhaseTokenUsage = {
    phase,
    ...(label && { label }),
    tokenUsage: initTokenUsage(),
    mode: 'live',
    contextWindow: getModelContextWindow(modelName),
    modelId: modelName,
    ...(typeof workerId === 'number' && { workerId }),
    ...(typeof taskName === 'string' && taskName.length > 0 && { taskName }),
  };

  // Broadcast the zero-seed snapshot immediately so the chat-input token gauge
  // resets the moment control moves to a new node — before the next LLM call
  // has produced any usage. Without this, the gauge would hold the previous
  // phase's final numbers (e.g. plan=170k) until the first `done` event of the
  // new node, which can be tens of seconds later for long-streaming nodes.
  //
  // SSOT note: this is NOT a violation of the "single publisher" rule on the
  // accumulate path. `beginNodePhase` is the node-entry publisher; the
  // accumulate / partial publishers sit downstream on the LLM-call path.
  // Together they form three disjoint publishing moments (entry, in-flight,
  // terminal), each with distinct semantics.
  const kanbanUpdate = (state as KanbanUpdatableState).deps?.kanbanUpdate;
  kanbanUpdate?.updateCurrentPhaseTokenUsage?.(state.currentPhaseTokenUsage);
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
 * Accumulate one LLM call's usage into the per-model job-level breakdown,
 * keyed by the live model id (`state.deps.llm.modelName`). Resolution failures
 * are swallowed to `'unknown'` rather than thrown — token tracking must never
 * abort a job, and the settle hook prices `'unknown'` conservatively.
 */
function accumulatePerModelUsage(state: TokenTrackingState, usage: TokenUsage): void {
  let modelId: string;
  try {
    modelId = resolveModelName(state);
  } catch {
    modelId = 'unknown';
  }
  if (!state.tokenUsageByModel) state.tokenUsageByModel = {};
  const entry = (state.tokenUsageByModel[modelId] ??= initTokenUsage());
  entry.inputTokens += usage.inputTokens;
  entry.outputTokens += usage.outputTokens;
  entry.totalTokens = computeTotal(entry);
  entry.callCount = (entry.callCount ?? 0) + 1;
  if (usage.cacheReadTokens) {
    entry.cacheReadTokens = (entry.cacheReadTokens || 0) + usage.cacheReadTokens;
  }
  if (usage.cacheCreationTokens) {
    entry.cacheCreationTokens = (entry.cacheCreationTokens || 0) + usage.cacheCreationTokens;
  }
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

    // Per-model job-level accumulation — keyed by the live model id so the
    // billing settle hook can price each model's tokens at its own rate.
    // Mirrors the job-level fields above but partitioned by model.
    accumulatePerModelUsage(state, usage);
  }

  // Current-node snapshot (overwrite, not accumulate).
  // Each call's inputTokens already includes the full prompt (system + history +
  // current message), so accumulating across calls in the same node produces a
  // misleading number. Overwriting keeps the gauge at the true current context
  // fullness. Only updates if `beginNodePhase()` has initialized the snapshot.
  //
  // SSOT: the chat-input token-gauge snapshot has FOUR authorized publishers,
  // partitioned by distinct moments in a phase's LLM lifecycle:
  //   1. `beginNodePhase` — seeds a zero snapshot on node entry so the gauge
  //      resets promptly rather than holding the previous node's final value.
  //   2. `applyEstimatedInputTokens` — optional pre-call approximation
  //      (prompt-char → tokens) tagged `estimating: true`, covers the gap
  //      before the first API event arrives.
  //   3. `updatePhaseTokenUsageSnapshot` — fires mid-stream from
  //      `usage_partial` events (Anthropic `message_start`/`message_delta`,
  //      Gemini `usageMetadata` chunks). Overwrite-only; clears `estimating`.
  //   4. `accumulateTokenUsage` (this function) — fires once per LLM call at
  //      the terminal `done` event, carrying the FINAL usage. Also clears
  //      `estimating` as a safety net for providers without usage_partial.
  // Other helpers (updateKanbanTokenUsage / applyEstimatingUsage / direct
  // updateTokenUsage calls in visual nodes) MUST NOT invoke
  // `updateCurrentPhaseTokenUsage` directly — they rely on the four publishers
  // above.
  if (state.currentPhaseTokenUsage) {
    state.currentPhaseTokenUsage.tokenUsage = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.inputTokens + usage.outputTokens,
      ...(usage.cacheReadTokens !== undefined && { cacheReadTokens: usage.cacheReadTokens }),
      ...(usage.cacheCreationTokens !== undefined && { cacheCreationTokens: usage.cacheCreationTokens }),
      // callCount intentionally omitted — `state.currentPhaseTokenUsage` is
      // the LATEST-call snapshot (overwrite semantics), so a stamped
      // `callCount: 1` would be misleading. Job-level / task-level counts
      // live on `state.tokenUsage` / `state._currentTaskTokenUsage`.
    };
    // Promote the snapshot back to `'live'` — any prior `'estimating'` state
    // installed by `applyEstimatedInputTokens` is now superseded by an
    // API-reported usage. This is also the safety net for providers without
    // usage_partial events (OpenAI) where `maybeUpdatePhaseTokenUsage`
    // never fires mid-stream.
    state.currentPhaseTokenUsage.mode = 'live';

    const kanbanUpdate = (state as KanbanUpdatableState).deps?.kanbanUpdate;
    kanbanUpdate?.updateCurrentPhaseTokenUsage?.(state.currentPhaseTokenUsage);
  }
}

/**
 * Mid-stream overwrite of `state.currentPhaseTokenUsage` + broadcast.
 *
 * Called from stream consumers when the LLM adapter emits a `usage_partial`
 * event (Anthropic `message_start`/`message_delta`, Gemini `usageMetadata`
 * chunks). Unlike `accumulateTokenUsage`:
 *   - Does NOT touch `_currentTaskTokenUsage` or `state.tokenUsage` — the
 *     per-task and per-job counters remain authoritative via the `done` event
 *     only. Partial snapshots would over-count if accumulated.
 *   - Does NOT log to the token debug file.
 *   - Same overwrite-then-broadcast contract as `accumulateTokenUsage`'s
 *     current-phase block, so the chat-input gauge reflects in-flight usage.
 *
 * No-op when `beginNodePhase()` has not seeded a snapshot (estimating pre-RAC
 * nodes may run without one).
 */
export function updatePhaseTokenUsageSnapshot(
  state: TokenTrackingState,
  usage: TokenUsage,
): void {
  if (!state.currentPhaseTokenUsage) return;

  state.currentPhaseTokenUsage.tokenUsage = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.inputTokens + usage.outputTokens,
    ...(usage.cacheReadTokens !== undefined && { cacheReadTokens: usage.cacheReadTokens }),
    ...(usage.cacheCreationTokens !== undefined && { cacheCreationTokens: usage.cacheCreationTokens }),
    // callCount omitted — overwrite semantics (see accumulateTokenUsage).
  };
  // Promote to `'live'` — any prior estimating snapshot is superseded by an
  // API-reported usage_partial event.
  state.currentPhaseTokenUsage.mode = 'live';

  const kanbanUpdate = (state as KanbanUpdatableState).deps?.kanbanUpdate;
  kanbanUpdate?.updateCurrentPhaseTokenUsage?.(state.currentPhaseTokenUsage);
}

/**
 * One-line stream-loop helper. Call inside `for await (const event of stream)`
 * and it will transparently update the chat-input gauge snapshot whenever the
 * LLM adapter emits a `usage_partial` event. No-op for other event types.
 *
 * Also clears the `estimating` flag on any update path since any API-derived
 * usage supersedes the pre-call approximation installed by
 * `applyEstimatedInputTokens`.
 */
export function maybeUpdatePhaseTokenUsage(
  state: TokenTrackingState,
  event: { type?: string; usage?: TokenUsage },
): void {
  if (event.type === 'usage_partial' && event.usage) {
    // `updatePhaseTokenUsageSnapshot` already sets `mode: 'live'`; nothing
    // further to clear (the legacy boolean `estimating` flag is gone).
    updatePhaseTokenUsageSnapshot(state, event.usage);
  }
}

/**
 * Very rough char→token ratio. Tuned for mixed English/Korean workloads:
 *   - English latin text: ~4 chars/token
 *   - Korean / CJK: ~1.5–2 chars/token
 *   - Code & markdown: ~3.5 chars/token
 * The middle-ground ratio `3` is deliberately on the pessimistic side so the
 * pre-call estimate does not visually over-promise headroom.
 *
 * We intentionally avoid importing tiktoken / an Anthropic tokenizer here:
 *   - Tokenizer startup cost (WASM / dictionary load) > 50 ms, dwarfing the
 *     100–500 ms gap R3 is trying to fill.
 *   - Ratios differ per provider; the gauge is a coarse visual indicator, not
 *     an accounting surface. The real numbers arrive within hundreds of ms
 *     via R1's `usage_partial` path and overwrite this estimate.
 */
const APPROX_CHARS_PER_TOKEN = 3;

export function approxTokenCountFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.round(chars / APPROX_CHARS_PER_TOKEN);
}

/**
 * Seed the chat-input gauge with a provisional input-token count derived from
 * the built prompt's character size. Intended to be called immediately BEFORE
 * issuing the LLM stream — covers the 100–500 ms gap before the first
 * `usage_partial` event arrives.
 *
 * Marks the snapshot with `estimating: true`. Will be overwritten (and the
 * flag cleared) as soon as `maybeUpdatePhaseTokenUsage` / the `done` event
 * delivers API-reported usage.
 *
 * Requires `beginNodePhase` to have seeded `state.currentPhaseTokenUsage`
 * (no-op otherwise).
 */
export function applyEstimatedInputTokens(
  state: TokenTrackingState,
  promptChars: number,
): void {
  const snapshot = state.currentPhaseTokenUsage;
  if (!snapshot) return;

  const approxInput = approxTokenCountFromChars(promptChars);
  if (approxInput <= 0) return;

  snapshot.tokenUsage = {
    inputTokens: approxInput,
    outputTokens: 0,
    totalTokens: approxInput,
    // callCount omitted — phase snapshot uses overwrite semantics.
  };
  snapshot.mode = 'estimating';

  const kanbanUpdate = (state as KanbanUpdatableState).deps?.kanbanUpdate;
  kanbanUpdate?.updateCurrentPhaseTokenUsage?.(snapshot);
}

/**
 * Convenience wrapper: sums character length of a messages[] array and
 * feeds it to `applyEstimatedInputTokens`. Intended for the common case
 * where a node has just built the `messages` payload and is about to call
 * `llm.stream(messages, ...)`.
 *
 * Accepts both string and structured (MessageContentBlock[] / CacheableContent[])
 * content shapes — structured content is char-counted via JSON.stringify.
 *
 * Centralizing this logic keeps every LLM entry point to a one-liner and
 * avoids per-site ad-hoc char-count reducers drifting apart.
 */
export function applyEstimatedInputTokensFromMessages(
  state: TokenTrackingState,
  messages: Array<{ role: string; content: string | unknown }>,
): void {
  if (!state.currentPhaseTokenUsage) return;
  const chars = messages.reduce(
    (sum, m) =>
      sum +
      (typeof m.content === 'string'
        ? m.content.length
        : JSON.stringify(m.content ?? '').length),
    0,
  );
  applyEstimatedInputTokens(state, chars);
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
 *
 * Unlike `currentPhaseTokenUsage` (overwrite semantics for the latest single
 * call), `phaseTokenUsages` entries accumulate across calls within the same
 * phase — `callCount` is meaningful here and represents the total LLM calls
 * aggregated into the entry.
 */
export function upsertPhaseTokenUsage(
  state: PhaseTrackingState & TokenTrackingState,
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
    const modelName = resolveModelName(state);
    state.phaseTokenUsages.push({
      phase,
      label,
      tokenUsage: { ...usage, callCount: usage.callCount ?? 1 },
      mode: 'live',
      contextWindow: getModelContextWindow(modelName),
      modelId: modelName,
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
  
  // Cache the per-model breakdown BEFORE updateTaskQueue persists the Redis
  // snapshot the billing settle reads — caching after would lag it by one
  // broadcast (the last call's tokens would be missing from the final snapshot).
  if (state.tokenUsageByModel) {
    state.deps.kanbanUpdate.updateTokenUsageByModel?.(state.tokenUsageByModel);
  }

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

  // Cache per-model breakdown before the updateTokenUsage broadcast persists
  // the snapshot — so estimating-only / direct-answer jobs (no task queue)
  // still carry per-model usage into the snapshot the billing settle reads.
  if (state.tokenUsageByModel) {
    state.deps?.kanbanUpdate?.updateTokenUsageByModel?.(state.tokenUsageByModel);
  }
  if (state.tokenUsage) {
    state.deps?.kanbanUpdate?.updateTokenUsage?.(state.tokenUsage);
  }
  // Note: currentPhaseTokenUsage broadcast handled by accumulateTokenUsage (SSOT).

  logTokenUsageToFile(resolveFeaturePath(state), state._httpJobId, usage, {
    taskId: 'estimating',
    taskName: opts.subNode ?? nodeId,
    node: nodeId,
    callIndex: opts.callIndex ?? 0,
    modelId: resolveModelIdSafe(state),
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

  // T1 pre-call estimate — seed the chat-input gauge so detect/triage
  // nodes reveal input-token progress immediately instead of waiting for
  // the full LLM response. Requires a current-phase snapshot; seed one if
  // the caller hasn't via `beginNodePhase`.
  if (opts.promptChars && opts.promptChars > 0) {
    if (!state.currentPhaseTokenUsage || state.currentPhaseTokenUsage.phase !== nodeId) {
      beginNodePhase(state, nodeId, getEstimatingLabel(nodeId, state._uiLocale));
    }
    applyEstimatedInputTokens(state, opts.promptChars);
  }

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

  // T1 pre-stream estimate — makes the chat-input gauge reflect detect /
  // decompose / triage input size BEFORE the first usage_partial event.
  // Seed `currentPhaseTokenUsage` if the caller hasn't, so both T1 and the
  // in-flight `maybeUpdatePhaseTokenUsage` below have a target to write.
  if (opts.promptChars && opts.promptChars > 0) {
    if (!state.currentPhaseTokenUsage || state.currentPhaseTokenUsage.phase !== nodeId) {
      beginNodePhase(state, nodeId, getEstimatingLabel(nodeId, state._uiLocale));
    }
    applyEstimatedInputTokens(state, opts.promptChars);
  }

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

    // In-flight gauge update from usage_partial events. During estimating
    // phases `beginNodePhase` may not have been invoked yet (the caller
    // seeds on first `applyEstimatingUsage`), in which case this is a
    // silent no-op — acceptable because the subsequent final 'done' still
    // publishes via `applyEstimatingUsage`.
    maybeUpdatePhaseTokenUsage(state, event);

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
