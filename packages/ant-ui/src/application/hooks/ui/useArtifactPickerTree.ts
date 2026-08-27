import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { pruneFileTreeForWorkspaceDomain } from '@ant/shared';
import { useStore } from '@/domain/store';
import type { FileNode } from '@/infrastructure/http/api';
import { useAgentDefinitionPickerTree } from './useAgentDefinitionPickerTree';

/**
 * The artifact tree every `FileTreePicker` entry point browses.
 *
 * Domain-pruned so a workspace never exposes the other domain's asset pool
 * (I6). Pruning is driven by the PERSISTED project domain (`config.json` SSOT),
 * not the mutable `actionMetadata.domain` buffer — the chat composer's Browse
 * row used the buffer and could therefore show a different tree than the action
 * tab for the same workspace. While the config is still loading, skip pruning
 * rather than filter by an unknown domain.
 *
 * On a UNIVERSAL project the peer agent-definition subtree (`_agents/…`) is
 * grafted on here, so the typeahead, the Browse modal and the chip row all read
 * ONE tree and cannot disagree about what is attachable. Canonical projects
 * (the action-tab picker) never see it — the graft is null there.
 */
export function useArtifactPickerTree(): FileNode[] {
  const fileTree = useStore(s => s.fileTree);
  const status = useStore(s => s.projectConfig.status);
  const domain = useStore(s => s.projectConfig.data?.domain);
  const { t } = useTranslation('chat');
  const agentsNode = useAgentDefinitionPickerTree(t('mention.group.agentDefinitions'));

  return useMemo(
    () => {
      const pruned = status === 'ready'
        ? (pruneFileTreeForWorkspaceDomain(fileTree as any, domain) as typeof fileTree)
        : fileTree;
      return agentsNode ? [...pruned, agentsNode] : pruned;
    },
    [fileTree, status, domain, agentsNode],
  );
}
