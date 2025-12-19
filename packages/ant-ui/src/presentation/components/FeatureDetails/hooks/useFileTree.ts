import { useEffect } from 'react';
import { useStore } from '@/domain/store';

export function useFileTree(
  selectedProject: string | undefined,
  selectedFeature: string | undefined
) {
  const fileTree = useStore((state) => state.fileTree);
  const setFileTree = useStore((state) => state.setFileTree);
  const refreshFileTree = useStore((state) => state.refreshFileTree);

  useEffect(() => {
    if (!selectedProject || !selectedFeature) {
      setFileTree([]);
      return;
    }

    refreshFileTree();
  }, [selectedProject, selectedFeature, refreshFileTree, setFileTree]);

  return { fileTree, refreshFileTree };
}
