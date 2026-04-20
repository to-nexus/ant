/**
 * Plan Router - pure predicate on plan node output.
 *
 * R1 — the router is a read-only function of `state`. Any short-circuit
 * `llmResponse.done` flag was already set by the plan node (see handoff
 * §7.5 / T6b-α). Router responsibilities:
 *
 *   1. Plan node signalled done (batch split / diagnostic pass / empty
 *      implementation) → checkTaskStatus.
 *   2. Plan is in its tool loop (tool calls present) → tool.
 *   3. Otherwise (planText ready) → execute.
 */

import { ArchitectGraphState } from '../state';

export function routeAfterPlan(state: ArchitectGraphState): string {
  if (state.llmResponse?.done === true && state._activePhase !== 'plan') {
    console.log(`[planRouter] Plan signalled done=true → checkTaskStatus`);
    return 'checkTaskStatus';
  }

  if (state._activePhase === 'plan' && (state.llmResponse?.toolCalls?.length ?? 0) > 0) {
    return 'tool';
  }

  return 'execute';
}
