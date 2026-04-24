import { useStore } from '@/domain/store';
import { 
  createFeature, 
  deleteFeature, 
} from '@/infrastructure/http/api';

export function useFeatureActions(
  selectedProject: string | undefined,
) {
  const setSelectedFeature = useStore((state) => state.setSelectedFeature);
  const fetchFeatures = useStore((state) => state.fetchFeatures);
  const addFeatureOptimistic = useStore((state) => state.addFeatureOptimistic);
  const refreshFileTree = useStore((state) => state.refreshFileTree);

  const handleCreateFeature = async (featureName: string) => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }

    console.log(`[useFeatureActions] 🆕 Creating feature: ${featureName}`);

    const language = useStore.getState().language;
    await createFeature(selectedProject, featureName, language);

    addFeatureOptimistic(featureName);
    fetchFeatures(selectedProject);
    await refreshFileTree();

    console.log(`[useFeatureActions] ✅ Feature created, auto-selecting: ${featureName}`);
    // Selecting the feature causes `useProjectLifecycle` (mounted in App.tsx)
    // to reset git-world state and refetch authoritative snapshot+PAT for the
    // new worktree. SSE `reconnectRefill` arrives shortly after.
    setSelectedFeature(featureName);
  };

  const handleDeleteFeature = async (featureName: string) => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }
    
    console.log(`[useFeatureActions] 🗑️ Deleting feature: ${featureName}`);
    
    // ✅ Delete feature
    await deleteFeature(selectedProject, featureName);
    
    // ✅ Refresh features list to remove deleted feature
    await fetchFeatures(selectedProject);
    
    // ✅ Refresh file tree
    await refreshFileTree();
    
    console.log(`[useFeatureActions] ✅ Feature deleted: ${featureName}`);
    
    // ✅ CRITICAL: If deleted feature was currently selected, switch to base
    const currentFeature = useStore.getState().selectedFeature;
    if (currentFeature === featureName) {
      console.log(`[useFeatureActions] ⚠️ Deleted feature was selected, switching to base branch`);
      setSelectedFeature(undefined);
    }
  };

  const handleFeatureChange = (featureName: string | null) => {
    const currentFeature = useStore.getState().selectedFeature;
    
    const normalizedFeatureName = featureName === '' ? null : featureName;
    
    if (normalizedFeatureName === currentFeature) {
      return;
    }
    
    const targetFeature = normalizedFeatureName === null ? undefined : normalizedFeatureName;
    setSelectedFeature(targetFeature);
  };

  return {
    handleCreateFeature,
    handleDeleteFeature,
    handleFeatureChange
  };
}
