import { useEffect } from 'react';
import { useStore } from '@/domain/store';

/**
 * Sync trace.jsonl + feature.jsonl breadcrumbs into the `featureLog` slice
 * whenever the active project/feature changes. Live updates continue to flow
 * through the SSE workflow/chat streams; this hook only drives the
 * read-only initial load.
 */
export function useFeatureLogSync(projectId: string | null, featureName: string | null) {
  const loadFeatureTrace = useStore(s => s.loadFeatureTrace);
  const loadFeatureBreadcrumbs = useStore(s => s.loadFeatureBreadcrumbs);
  const clearFeatureLog = useStore(s => s.clearFeatureLog);

  useEffect(() => {
    if (!projectId || !featureName) {
      clearFeatureLog();
      return;
    }
    void loadFeatureTrace(projectId, featureName);
    void loadFeatureBreadcrumbs(projectId, featureName);
  }, [projectId, featureName, loadFeatureTrace, loadFeatureBreadcrumbs, clearFeatureLog]);
}
