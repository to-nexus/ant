/**
 * The pure rules of the universal card surface — no React, no store, so both
 * mount sites and the tests read the same functions.
 *
 * Partition an agent list into its scope groups — personal, organization,
 * built-in — in one place.
 *
 * Three surfaces list agents (the settings rail, the composer menu, the action
 * cards) and each used to decide its own order. The order is
 * `CUSTOM_AGENT_SCOPE_PRIORITY`: closest-scope-first is both the collision
 * precedence and the right reading order, so there is no second constant to
 * drift from it.
 *
 * Empty groups are dropped. That is deliberately unlike `AgentTree`, which
 * renders all three headers so an author can see that a scope they own is
 * empty — a picker has no such reader, and an empty header there is dead space.
 */

import { CUSTOM_AGENT_SCOPE_PRIORITY, type CustomAgentScope, type CustomAgentSummary } from '@ant/shared';

export interface AgentScopeGroup<T = CustomAgentSummary> {
  scope: CustomAgentScope;
  agents: T[];
}

export function groupAgentsByScope<T extends { scope: CustomAgentScope }>(agents: T[]): AgentScopeGroup<T>[] {
  return CUSTOM_AGENT_SCOPE_PRIORITY.map((scope) => ({
    scope,
    agents: agents.filter((a) => a.scope === scope),
  })).filter((group) => group.agents.length > 0);
}

/** Which card level a step draws. See {@link universalCardLevel}. */
export type UniversalCardLevel = 'agent' | 'job' | 'intent';

/**
 * step → card level. This IS the both-surfaces invariant: the actions panel and
 * the chat action area — the only two places the agent/job/intent cards are
 * exposed — read ONE channel through this one rule, so they cannot show
 * different depths of the same vocabulary.
 *
 * `intent-detail` belongs to the panel (a full-height page with its own
 * footer); the chat clamps to the level above rather than blanking its action
 * area. Canonical-only steps never reach a universal project but still resolve
 * to a drawable level rather than throwing.
 */
export function universalCardLevel(step: string): UniversalCardLevel {
  if (step === 'pick-agent') return 'agent';
  if (step === 'pick-intent') return 'intent';
  return 'job';
}
