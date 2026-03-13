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
  const setBypassFetchTimer = useStore((state) => state.setBypassFetchTimer);

  const handleCreateFeature = async (featureName: string) => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }
    
    console.log(`[useFeatureActions] 🆕 Creating feature: ${featureName}`);
    
    // ✅ Create feature (pass UI language for localized templates)
    const language = useStore.getState().language;
    await createFeature(selectedProject, featureName, language);
    
    // ✅ Optimistic update: immediately reflect in store (prevents race with fetchFeatures)
    addFeatureOptimistic(featureName);
    
    // ✅ Background sync: reconcile with backend
    fetchFeatures(selectedProject);
    
    // ✅ Refresh file tree
    await refreshFileTree();
    
    // ✅ CRITICAL: Bypass fetch timer for newly created feature
    // New features need immediate fetch to get remote tracking info
    console.log(`[useFeatureActions] ✅ Feature created, setting bypass flag and auto-selecting: ${featureName}`);
    setBypassFetchTimer(true);
    
    // ✅ Select the newly created feature
    // This will trigger useFeatureBranchManager to switch to the new branch
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
