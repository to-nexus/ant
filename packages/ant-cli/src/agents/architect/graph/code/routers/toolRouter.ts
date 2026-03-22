/**
 * Tool Router - Tool node exit routing
 *
 * If we were in plan exploration (_planExploring) -> back to plan (with tool results)
 * Otherwise (from codeGen) -> codeGen
 */

import { ArchitectGraphState } from '../state';

export function routeAfterTool(state: ArchitectGraphState): string {
  if (state._planExploring === true) {
    return 'plan';
  }
  return 'execute';
}
