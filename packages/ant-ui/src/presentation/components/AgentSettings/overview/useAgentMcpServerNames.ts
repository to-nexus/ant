/**
 * Read-only fetch of the agent.yaml MCP server names for the hook editor's
 * action picker (H8's server set is job ∪ agent, but the job-level doc layout
 * deliberately does not load agent.yaml as an editable buffer). One fetch per
 * agent selection; failures degrade to [] — the picker's Custom escape hatch
 * still accepts any name and the BE loader stays the authority.
 */

import { useEffect, useState } from 'react';
import { fetchDefinitionFile } from '@/infrastructure/http/api/accountAgents';
import { deriveMcpServers, parseYamlDoc } from './definitionDocs';

export function useAgentMcpServerNames(agentId: string | undefined): string[] {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    setNames([]);
    if (!agentId) return;
    let cancelled = false;
    fetchDefinitionFile(agentId, 'agent.yaml')
      .then((r) => {
        if (cancelled) return;
        const { doc } = parseYamlDoc(r.content);
        setNames(Object.keys(deriveMcpServers(doc)));
      })
      .catch(() => {
        if (!cancelled) setNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  return names;
}
