/**
 * Plan Router - Plan node exit routing
 *
 * Priority:
 * 1. Batch split completed (plan set done=true) -> checkTaskStatus (skip execute entirely)
 * 2. Plan in tool loop with tool calls -> tool
 * 3. Empty implementation plan (verification/error tasks) -> checkTaskStatus (skip execute)
 * 4. Otherwise (planText ready) -> execute
 */

import { ArchitectGraphState } from '../state';

/**
 * Strip ```json ... ``` fences from a plan text before JSON.parse.
 */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/);
  return m ? m[1].trim() : trimmed;
}

/**
 * Axis F-1 — detect a plan JSON whose implementation is literally empty
 * (no modify/create/delete entries and no batches). An empty plan followed by
 * execute is a guaranteed no-op that will still consume LLM calls; route
 * straight to checkTaskStatus instead.
 */
export function hasEmptyImplementation(planText: string | undefined): boolean {
  if (!planText) return false;
  const body = stripFences(planText);
  if (!body.length) return false;
  try {
    const parsed = JSON.parse(body);
    const impl = parsed.implementation || {};
    const modifyCount = Array.isArray(impl.modify) ? impl.modify.length : 0;
    const createCount = Array.isArray(impl.create) ? impl.create.length : 0;
    const deleteCount = Array.isArray(impl.delete) ? impl.delete.length : 0;
    const hasBatches = Array.isArray(parsed.batches) && parsed.batches.length > 0;
    return !hasBatches && modifyCount === 0 && createCount === 0 && deleteCount === 0;
  } catch {
    return false;
  }
}

export function routeAfterPlan(state: ArchitectGraphState): string {
  if (state.llmResponse?.done === true && state._activePhase !== 'plan') {
    console.log(`[planRouter] Batch split completed (done=true from plan) → checkTaskStatus`);
    return 'checkTaskStatus';
  }

  if (state._activePhase === 'plan' && (state.llmResponse?.toolCalls?.length ?? 0) > 0) {
    return 'tool';
  }

  // Axis F-1 — empty implementation plan for diagnostic tasks: execute has nothing
  // to do. Short-circuit to checkTaskStatus and mark done to avoid budget burn.
  const taskType = state.currentTask?.type;
  const isDiagnostic = taskType === 'verification' || taskType === 'error';
  if (isDiagnostic && hasEmptyImplementation(state.planText)) {
    console.log(`[planRouter] Empty implementation plan detected for ${taskType} task → checkTaskStatus`);
    state.llmResponse = { done: true, textResponse: '', thinking: '', toolCalls: [] };
    return 'checkTaskStatus';
  }

  return 'execute';
}
