import { useMemo } from 'react';
import { pruneFileTreeForWorkspaceDomain } from '@ant/shared';
import { useStore } from '@/domain/store';
import type { FileNode } from '@/infrastructure/http/api';

/**
 * The artifact tree every `FileTreePicker` entry point browses.
 *
 * Domain-pruned so a workspace never exposes the other domain's asset pool
 * (I6). Pruning is driven by the PERSISTED project domain (`config.json` SSOT),
 * not the mutable `actionMetadata.domain` buffer — the chat composer's Browse
 * row used the buffer and could therefore show a different tree than the action
 * tab for the same workspace. While the config is still loading, skip pruning
 * rather than filter by an unknown domain.
 */
export function useArtifactPickerTree(): FileNode[] {
  const fileTree = useStore(s => s.fileTree);
  const status = useStore(s => s.projectConfig.status);
  const domain = useStore(s => s.projectConfig.data?.domain);

  return useMemo(
    () => (status === 'ready'
      ? (pruneFileTreeForWorkspaceDomain(fileTree as any, domain) as typeof fileTree)
      : fileTree),
    [fileTree, status, domain],
  );
}
