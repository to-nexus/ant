import { useCallback } from 'react';
import { useStore } from '@/domain/store';

/**
 * "Send" affordance of an artifacts panel: opens the Transfer tab on the Send
 * sub-tab with the clicked node preselected as the source. One hook for both
 * project kinds — the codespace panel passes `(project, feature)`, the workspace
 * panel `(project, UNIVERSAL_FEATURE)`.
 */
export function useSendToTransfer(
  projectId: string | null | undefined,
  featureId: string | null | undefined,
): (path: string, type: 'file' | 'directory') => void {
  const openTransferTab = useStore((s) => s.openTransferTab);
  return useCallback(
    (path, type) => {
      if (!projectId || !featureId) return;
      openTransferTab({
        subTab: 'send',
        preselectedSource: { projectId, featureId, path, type },
      });
    },
    [openTransferTab, projectId, featureId],
  );
}
