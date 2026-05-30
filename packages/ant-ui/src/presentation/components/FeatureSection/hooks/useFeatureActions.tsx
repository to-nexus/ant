import type { FeatureDeletionErrorShape } from '@ant/shared';
import { useStore } from '@/domain/store';
import {
  createFeature,
  deleteFeature,
} from '@/infrastructure/http/api';
import { ApiError } from '@/infrastructure/http/api/client';

export function useFeatureActions(
  selectedProject: string | undefined,
) {
  const setSelectedFeature = useStore((state) => state.setSelectedFeature);
  const fetchFeatures = useStore((state) => state.fetchFeatures);
  const addFeatureOptimistic = useStore((state) => state.addFeatureOptimistic);
  const refreshFileTree = useStore((state) => state.refreshFileTree);

  const startFeatureDeletion = useStore((s) => s.startFeatureDeletion);
  const markFeatureDeletionComplete = useStore((s) => s.markFeatureDeletionComplete);
  const markFeatureDeletionFailed = useStore((s) => s.markFeatureDeletionFailed);
  const resetFeatureDeletionSession = useStore((s) => s.resetFeatureDeletionSession);

  const handleCreateFeature = async (featureName: string) => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }

    console.log(`[useFeatureActions] 🆕 Creating feature: ${featureName}`);

    const language = useStore.getState().language;
    await createFeature(selectedProject, featureName, language);

    addFeatureOptimistic(featureName);
    await fetchFeatures(selectedProject);
    await refreshFileTree();

    console.log(`[useFeatureActions] ✅ Feature created, auto-selecting: ${featureName}`);
    // Selecting the feature causes `useProjectLifecycle` (mounted in App.tsx)
    // to reset git-world state and refetch authoritative snapshot+PAT for the
    // new worktree. SSE `reconnectRefill` arrives shortly after.
    setSelectedFeature(featureName);
  };

  /**
   * Delete a feature with phase-progress UX. The BE broadcasts each
   * cascade phase as a `featureDeletionPhase` SSE event; sseSlice routes
   * it into `featureDeletionSlice` so `<FeatureDeletionPanel>` shows the
   * step rail in real time.
   *
   * On 409 (ApiError with kind='featureDeletion'), we surface the
   * structured shape so the panel can render the failed banner + Force
   * Delete CTA. Other errors reset the session and rethrow.
   */
  const runDeleteFeature = async (featureName: string, force: boolean) => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }
    const projectId = selectedProject;

    startFeatureDeletion(projectId, featureName);
    try {
      await deleteFeature(projectId, featureName, { force });
      markFeatureDeletionComplete();

      await fetchFeatures(projectId);
      await refreshFileTree();

      const currentFeature = useStore.getState().selectedFeature;
      if (currentFeature === featureName) {
        setSelectedFeature(undefined);
      }
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'featureDeletion' && error.stage) {
        const shape: FeatureDeletionErrorShape = {
          kind: 'featureDeletion',
          stage: error.stage as FeatureDeletionErrorShape['stage'],
          message: error.message,
          canForceCleanup: error.canForceCleanup ?? false,
          retryable: error.canForceCleanup ?? false,
          ...(error.hint !== undefined ? { hint: error.hint } : {}),
          ...(error.leftovers !== undefined ? { leftovers: error.leftovers } : {}),
        };
        markFeatureDeletionFailed(shape, error.correlationId ?? '');
        return;
      }
      resetFeatureDeletionSession();
      throw error;
    }
  };

  const handleDeleteFeature = async (featureName: string) => {
    await runDeleteFeature(featureName, false);
  };

  const handleForceDeleteFeature = () => {
    const sess = useStore.getState().featureDeletionSession;
    if (sess.kind !== 'failed') return;
    void runDeleteFeature(sess.featureName, true);
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
    handleForceDeleteFeature,
    handleFeatureChange,
  };
}
