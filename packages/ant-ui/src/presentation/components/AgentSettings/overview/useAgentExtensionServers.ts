/**
 * Read-only fetch of the agent.yaml capability-server names for the hook
 * editor's action picker (H8's server set is job ∪ agent, but the job-level
 * doc layout deliberately does not load agent.yaml as an editable buffer).
 * One fetch per agent selection covers every channel; failures degrade to
 * empty — the picker's Custom escape hatch still accepts any name and the BE
 * loader stays the authority.
 */

import { useEffect, useState } from 'react';
import { fetchDefinitionFile } from '@/infrastructure/http/api/accountAgents';
import { deriveApiServers, deriveMcpServers, parseYamlDoc } from './definitionDocs';
import type { ExtensionServers } from './actionHook';

const NONE: ExtensionServers = { mcp: [], api: [] };

export function useAgentExtensionServers(agentId: string | undefined): ExtensionServers {
  const [servers, setServers] = useState<ExtensionServers>(NONE);

  useEffect(() => {
    setServers(NONE);
    if (!agentId) return;
    let cancelled = false;
    fetchDefinitionFile(agentId, 'agent.yaml')
      .then((r) => {
        if (cancelled) return;
        const { doc } = parseYamlDoc(r.content);
        setServers({ mcp: Object.keys(deriveMcpServers(doc)), api: Object.keys(deriveApiServers(doc)) });
      })
      .catch(() => {
        if (!cancelled) setServers(NONE);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  return servers;
}
