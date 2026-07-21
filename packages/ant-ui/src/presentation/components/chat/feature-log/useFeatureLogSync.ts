import { useEffect } from 'react';
import { useStore } from '@/domain/store';

/**
 * Sync feature.jsonl breadcrumbs into the `featureLog` slice whenever the
 * active project/feature changes. Post-mount updates are driven by
 * `chatSseHandler` re-issuing `loadFeatureBreadcrumbs` when a
 * `job_status=completed|failed` event arrives for the current feature.
 */
export function useFeatureLogSync(projectId: string | null, featureName: string | null) {
  const loadFeatureBreadcrumbs = useStore(s => s.loadFeatureBreadcrumbs);
  const loadContextEstimate = useStore(s => s.loadContextEstimate);
  const clearFeatureLog = useStore(s => s.clearFeatureLog);

  useEffect(() => {
    if (!projectId || !featureName) {
      clearFeatureLog();
      return;
    }
    void loadFeatureBreadcrumbs(projectId, featureName);
    // Context Lens (E2-4): seed the carry-over gauge on feature switch.
    void loadContextEstimate(projectId, featureName);
  }, [projectId, featureName, loadFeatureBreadcrumbs, loadContextEstimate, clearFeatureLog]);
}
