/**
 * Plan Router - Plan node exit routing
 *
 * If plan left tool calls (_planExploring + llmResponse.toolCalls) -> tool
 * Otherwise (planText ready) -> codeGen
 */

import { ArchitectGraphState } from '../state';

export function routeAfterPlan(state: ArchitectGraphState): string {
  const exploring = state._planExploring === true;
  const hasToolCalls = (state.llmResponse?.toolCalls?.length ?? 0) > 0;

  if (exploring && hasToolCalls) {
    return 'tool';
  }
  return 'codeGen';
}
