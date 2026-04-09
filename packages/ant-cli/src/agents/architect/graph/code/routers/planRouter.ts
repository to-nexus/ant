/**
 * Plan Router - Plan node exit routing
 *
 * Priority:
 * 1. Batch split completed (plan set done=true) -> checkTaskStatus (skip execute entirely)
 * 2. Plan in tool loop with tool calls -> tool
 * 3. Otherwise (planText ready) -> execute
 */

import { ArchitectGraphState } from '../state';

export function routeAfterPlan(state: ArchitectGraphState): string {
  if (state.llmResponse?.done === true && state._activePhase !== 'plan') {
    console.log(`[planRouter] Batch split completed (done=true from plan) → checkTaskStatus`);
    return 'checkTaskStatus';
  }

  if (state._activePhase === 'plan' && (state.llmResponse?.toolCalls?.length ?? 0) > 0) {
    return 'tool';
  }

  return 'execute';
}
