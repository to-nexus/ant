import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { useStore } from '@/domain/store';
import { 
  createFeature, 
  deleteFeature, 
  getGitChanges
} from '@/infrastructure/http/api';
import type { ReactNode } from 'react';

export type ShowConfirmFn = (
  message: string | ReactNode,
  options?: {
    title?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => void | Promise<void>;
    onCancel?: () => void;
  }
) => void;

export function useFeatureActions(
  selectedProject: string | undefined,
  _selectedFeature: string | undefined,  // Used by parent
  baseBranch: string,
  showConfirm: ShowConfirmFn,
) {
  const { t } = useTranslation('explorer');
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
    
    // ✅ Create feature
    await createFeature(selectedProject, featureName);
    
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

  const handleFeatureChange = async (featureName: string | null) => {
    // ✅ FIXED: Always use latest selectedProject from store
    const currentProject = useStore.getState().selectedProject;
    const currentFeature = useStore.getState().selectedFeature;
    
    // ✅ FIXED: Handle empty string as null
    const normalizedFeatureName = featureName === '' ? null : featureName;
    
    if (!currentProject) {
      return;
    }
    
    // Same feature selected - do nothing
    if (normalizedFeatureName === currentFeature) {
      return;
    }
    
    // Convert null to undefined for setSelectedFeature
    const targetFeature = normalizedFeatureName === null ? undefined : normalizedFeatureName;
    
    try {
      // Check for uncommitted changes in current branch
      const changes = await getGitChanges(currentProject);
      
      // ✅ FIXED: Only check staged/unstaged (untracked files are safe to ignore)
      const hasRelevantChanges = changes.staged.length > 0 || changes.unstaged.length > 0;
      
      if (hasRelevantChanges) {
        const totalChanges = changes.staged.length + changes.unstaged.length;
        const targetBranch = normalizedFeatureName ? `feature/${normalizedFeatureName}` : baseBranch;
        
        // Show confirmation dialog
        showConfirm(
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                  {t('git.uncommittedTitle')}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  {t('git.uncommittedDesc', { count: totalChanges })}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t('git.uncommittedStash', { name: targetBranch })}
                </p>
              </div>
            </div>
          </div>,
          {
            title: t('common:warning.title'),
            confirmText: t('git.switchAnyway'),
            cancelText: t('common:button.cancel'),
            onConfirm: () => {
              setSelectedFeature(targetFeature);
            },
            onCancel: () => {
              // User cancelled
            }
          }
        );
      } else {
        // No changes - safe to switch
        setSelectedFeature(targetFeature);
      }
    } catch (error) {
      // If we can't check changes (e.g., Git not initialized), allow the switch
      console.warn('[useFeatureActions] Could not check Git changes:', error);
      setSelectedFeature(targetFeature);
    }
  };

  return {
    handleCreateFeature,
    handleDeleteFeature,
    handleFeatureChange
  };
}
