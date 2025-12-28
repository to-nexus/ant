import { useEffect } from 'react';
import { useStore } from '@/domain/store';

export function useFileTree(
  selectedProject: string | undefined,
  selectedFeature: string | undefined
) {
  const fileTree = useStore((state) => state.fileTree);
  const setFileTree = useStore((state) => state.setFileTree);
  const refreshFileTree = useStore((state) => state.refreshFileTree);
  const connectionStatus = useStore((state) => state.connectionStatus);

  useEffect(() => {
    if (!selectedProject || !selectedFeature) {
      setFileTree([]);
      return;
    }

    // ✅ Refresh-safe:
    // On hard refresh, selectedProject/selectedFeature can be restored before the backend
    // connection is fully initialized. If we fetch too early and it fails once, we wouldn't
    // automatically retry (because project/feature don't change). So we also react to
    // connectionStatus transitioning to 'connected'.
    if (connectionStatus !== 'connected') return;

    refreshFileTree();
  }, [selectedProject, selectedFeature, connectionStatus, refreshFileTree, setFileTree]);

  return { fileTree, refreshFileTree };
}
