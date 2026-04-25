/**
 * Application Layer: Job History Hook
 *
 * Fetches the list of past (and currently running) job ids for the same
 * feature × jobType, ordered most-recent first. Refetches whenever the
 * selected project / feature / jobType changes, when the current jobId
 * changes (a new job just started or finished), or when an explicit
 * refresh is requested via the returned `refresh` callback.
 *
 * The hook is intentionally lightweight (no global cache / SWR layer) —
 * the dropdown only consults this on open / after deletion.
 */

import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/domain/store';
import { fetchJobHistory, type JobHistoryEntry } from '@/infrastructure/http/api';

interface UseJobHistoryReturn {
  entries: JobHistoryEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useJobHistory(): UseJobHistoryReturn {
  const selectedProject = useStore((s) => s.selectedProject);
  const selectedFeature = useStore((s) => s.selectedFeature);
  const selectedJobType = useStore((s) => s.selectedJobType);
  const currentJobId = useStore((s) => s.currentJobId);

  const [entries, setEntries] = useState<JobHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!selectedProject || !selectedFeature) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchJobHistory(
        selectedProject,
        selectedFeature,
        selectedJobType || 'code',
      );
      setEntries(result.jobs);
    } catch (err: any) {
      setError(err?.message || 'Failed to load job history');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [selectedProject, selectedFeature, selectedJobType]);

  useEffect(() => {
    void refresh();
  }, [refresh, currentJobId]);

  return { entries, loading, error, refresh };
}
