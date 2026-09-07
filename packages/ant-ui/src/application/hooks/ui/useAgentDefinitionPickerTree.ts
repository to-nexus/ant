import { useEffect, useMemo } from 'react';
import { UNIVERSAL_AGENTS_DIRNAME, classifyDefinitionDir, isAllowedDefinitionPath } from '@ant/shared';
import type { CustomAgentDefinitionFileNode, CustomAgentScope, CustomAgentSummary } from '@ant/shared';
import { useStore } from '@/domain/store';
import type { FileNode } from '@/infrastructure/http/api';

/**
 * The `_agents` subtree the universal `@ctx:` picker browses — peer agent
 * DEFINITION files, grafted client-side.
 *
 * Definitions are account-owned and live outside the project, so they are
 * deliberately absent from the project file-tree endpoint (which is Redis-cached
 * per project × feature for 24h and re-broadcast by `FileTreeBroadcaster` — a
 * definition saved through the account-scoped write funnel could never bust
 * that key). The source here is `ensureDefinitionTree`, the same deduped
 * per-agent cache the settings rail uses, so there is no second read owner.
 *
 * Paths are prefixed `_agents/{agentId}/…` — the reserved namespace the accept
 * gate and the tool sandbox both resolve.
 */

/** Scope suffix on the agent row — a shared org agent should not read as yours. */
function agentRowName(agent: CustomAgentSummary): string {
  const suffix: Partial<Record<CustomAgentScope, string>> = { org: ' · org', builtin: ' · builtin' };
  return `${agent.name}${suffix[agent.scope] ?? ''}`;
}

/**
 * `CustomAgentDefinitionFileNode[]` → `FileNode[]`, re-rooted under the mount.
 *
 * Offered ⇒ resolvable: the server tree lists every file on disk (the settings
 * rail must show a stray file so it can be deleted), but the accept gate admits
 * only the definition whitelist. Filter here with the SAME shared rules the
 * gate applies, so a row the picker offers is never a 400 at job start.
 */
export function mapDefinitionNodes(nodes: readonly CustomAgentDefinitionFileNode[], prefix: string): FileNode[] {
  const out: FileNode[] = [];
  for (const n of nodes) {
    const path = `${prefix}/${n.path}`;
    if (n.type === 'directory') {
      if (classifyDefinitionDir(n.path) === 'unknown') continue;
      out.push({ name: n.name, path, type: 'directory', children: mapDefinitionNodes(n.children ?? [], prefix) });
    } else if (isAllowedDefinitionPath(n.path)) {
      out.push({ name: n.name, path, type: 'file' });
    }
  }
  return out;
}

/**
 * Build the `_agents` node. An agent whose tree has not loaded yet renders as
 * an empty directory rather than disappearing — the row is what the user clicks
 * to make the fetch happen.
 */
export function buildAgentsNode(
  agents: readonly CustomAgentSummary[],
  trees: Record<string, { tree: CustomAgentDefinitionFileNode[] }>,
  label: string,
): FileNode | null {
  if (agents.length === 0) return null;
  return {
    name: label,
    path: UNIVERSAL_AGENTS_DIRNAME,
    type: 'directory',
    children: agents.map((agent): FileNode => {
      const prefix = `${UNIVERSAL_AGENTS_DIRNAME}/${agent.id}`;
      return {
        name: agentRowName(agent),
        path: prefix,
        type: 'directory',
        children: mapDefinitionNodes(trees[agent.id]?.tree ?? [], prefix),
      };
    }),
  };
}

/**
 * Live `_agents` node for the current universal project, fetching each agent's
 * definition tree once (a failed or stale entry is re-read — see
 * `shouldFetchDefinitionTree`). Returns null on canonical projects, when
 * disabled by the caller, and when the account has no agents. A disabled
 * caller never fetches.
 */
export function useAgentDefinitionPickerTree(label: string, enabled = true): FileNode | null {
  const projectType = useStore(s => s.projectType);
  const agents = useStore(s => s.customAgents);
  const trees = useStore(s => s.definitionTrees);
  const ensureDefinitionTree = useStore(s => s.ensureDefinitionTree);
  const active = enabled && projectType === 'universal';

  useEffect(() => {
    if (!active) return;
    for (const agent of agents) void ensureDefinitionTree(agent.id);
  }, [active, agents, ensureDefinitionTree]);

  return useMemo(
    () => (active ? buildAgentsNode(agents, trees as any, label) : null),
    [active, agents, trees, label],
  );
}
