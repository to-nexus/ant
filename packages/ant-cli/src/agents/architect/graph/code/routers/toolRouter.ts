/**
 * Tool Router - Tool node exit routing
 *
 * If we were in plan's tool loop (_activePhase === 'plan') -> back to plan
 * Otherwise (from execute) -> execute
 */

import { ArchitectGraphState } from '../state';

export function routeAfterTool(state: ArchitectGraphState): string {
  if (state._activePhase === 'plan') {
    return 'plan';
  }
  return 'execute';
}
