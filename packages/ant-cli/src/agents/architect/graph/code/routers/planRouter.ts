/**
 * Plan Router - Plan node exit routing
 *
 * Priority:
 * 1. Batch split completed (plan set done=true) -> checkTaskStatus (skip codeGen entirely)
 * 2. Plan exploring with tool calls -> tool
 * 3. Otherwise (planText ready) -> codeGen
 */

import { ArchitectGraphState } from '../state';

export function routeAfterPlan(state: ArchitectGraphState): string {
  if (state.llmResponse?.done === true && !state._planExploring) {
    console.log(`[planRouter] Batch split completed (done=true from plan) → checkTaskStatus`);
    return 'checkTaskStatus';
  }

  if (state._planExploring === true && (state.llmResponse?.toolCalls?.length ?? 0) > 0) {
    return 'tool';
  }

  return 'execute';
}
