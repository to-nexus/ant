/**
 * The ONE lookup of an agent's icon descriptor.
 *
 * Two `CustomAgentSummary[]` lists are loaded independently — `customAgents`
 * (project-scoped, what the composer and the actions surface read) and
 * `accountAgents` (account-scoped, what Agent Settings and Pipelines read) —
 * and a surface may render an agent that only the other list holds. Resolving
 * that here means no consumer re-derives it, and the icon can never differ
 * between two surfaces showing the same agent.
 */

import type { CustomAgentIconRef, CustomAgentSummary } from '@ant/shared';

interface AgentListState {
  customAgents?: CustomAgentSummary[];
  accountAgents?: CustomAgentSummary[];
}

export function selectAgentIcon(
  state: AgentListState,
  agentId: string | undefined,
): CustomAgentIconRef | undefined {
  if (!agentId) return undefined;
  const found =
    state.customAgents?.find((a) => a.id === agentId) ??
    state.accountAgents?.find((a) => a.id === agentId);
  return found?.icon;
}
