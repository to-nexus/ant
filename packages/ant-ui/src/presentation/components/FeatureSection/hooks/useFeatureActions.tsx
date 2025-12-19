import { AlertTriangle } from 'lucide-react';
import { useStore } from '@/domain/store';
import { 
  createFeature, 
  deleteFeature, 
  getGitChanges 
} from '@/infrastructure/http/api';
import { useAlertModal } from '@/application/hooks/ui/useAlertModal';

export function useFeatureActions(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  baseBranch: string
) {
  const setSelectedFeature = useStore((state) => state.setSelectedFeature);
  const refreshFileTree = useStore((state) => state.refreshFileTree);
  const { showConfirm } = useAlertModal();

  const handleCreateFeature = async (featureName: string) => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }
    await createFeature(selectedProject, featureName);
    await refreshFileTree();
    
    // After creating feature, directly select it
    setSelectedFeature(featureName);
  };

  const handleDeleteFeature = async (featureName: string) => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }
    await deleteFeature(selectedProject, featureName);
    await refreshFileTree();
  };

  const handleFeatureChange = async (featureName: string | null) => {
    if (!selectedProject) return;
    
    // Same feature selected - do nothing
    if (featureName === selectedFeature) return;
    
    // Convert null to undefined for setSelectedFeature
    const targetFeature = featureName === null ? undefined : featureName;
    
    try {
      // Check for uncommitted changes in current branch
      const changes = await getGitChanges(selectedProject);
      
      if (changes.hasChanges) {
        const totalChanges = changes.staged.length + changes.unstaged.length + changes.untracked.length;
        const targetBranch = featureName ? `feature/${featureName}` : baseBranch;
        
        // Show confirmation dialog
        showConfirm(
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                  Uncommitted Changes Detected
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  You have <strong>{totalChanges} uncommitted change{totalChanges > 1 ? 's' : ''}</strong> in the current branch.
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Switching to <strong>{targetBranch}</strong> may cause file loss or conflicts.
                </p>
                <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-2">
                  ⚠️ Please commit or stash your changes before switching branches.
                </p>
              </div>
            </div>
          </div>,
          {
            title: 'Warning',
            confirmText: 'Switch Anyway',
            cancelText: 'Cancel',
            onConfirm: () => {
              setSelectedFeature(targetFeature);
            },
            onCancel: () => {
              console.log('[useFeatureActions] Feature switch cancelled by user');
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
