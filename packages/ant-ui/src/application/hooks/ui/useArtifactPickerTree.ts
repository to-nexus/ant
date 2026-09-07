import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { pruneFileTreeForWorkspaceDomain } from '@ant/shared';
import { useStore } from '@/domain/store';
import type { FileNode } from '@/infrastructure/http/api';
import { useAgentDefinitionPickerTree } from './useAgentDefinitionPickerTree';
import { usePipelineDefinitionPickerTree } from './usePipelineDefinitionPickerTree';

export interface ArtifactPickerTreeOptions {
  /**
   * Graft the agent-plane definition mounts (`_agents/`, `_pipelines/`) on a
   * universal project. The chat `@ctx:` surfaces want them; a pipeline step's
   * context pins resolve against the artifacts tree only, so that caller
   * passes false and no definition fetch happens on its behalf.
   */
  definitionMounts?: boolean;
}

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
 * On a UNIVERSAL project the definition mounts (`_agents/…`, `_pipelines/…`)
 * are grafted on here, so the typeahead, the Browse modal and the chip row all
 * read ONE tree and cannot disagree about what is attachable. Canonical
 * projects (the action-tab picker) never see them — the grafts are null there.
 */
export function useArtifactPickerTree(opts: ArtifactPickerTreeOptions = {}): FileNode[] {
  const definitionMounts = opts.definitionMounts ?? true;
  const fileTree = useStore(s => s.fileTree);
  const status = useStore(s => s.projectConfig.status);
  const domain = useStore(s => s.projectConfig.data?.domain);
  const { t } = useTranslation('chat');
  const agentsNode = useAgentDefinitionPickerTree(t('mention.group.agentDefinitions'), definitionMounts);
  const pipelinesNode = usePipelineDefinitionPickerTree(t('mention.group.pipelineDefinitions'), definitionMounts);

  return useMemo(
    () => {
      const pruned = status === 'ready'
        ? (pruneFileTreeForWorkspaceDomain(fileTree as any, domain) as typeof fileTree)
        : fileTree;
      return [...pruned, agentsNode, pipelinesNode].filter((n): n is FileNode => n !== null);
    },
    [fileTree, status, domain, agentsNode, pipelinesNode],
  );
}
