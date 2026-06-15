/**
 * Application Layer: Job History Hook
 *
 * Fetches the feature's board-bearing jobs (code/design/learn) in one
 * feature-wide list, ordered most-recent first and tagged per-entry with
 * its own type. NOT scoped to the selected job type — selecting an entry
 * re-converges the identity to that entry's type (see `selectJobId`).
 * Refetches whenever the selected project / feature changes, when the
 * current jobId changes (a new job just started or finished), or when an
 * explicit refresh is requested via the returned `refresh` callback.
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
      const result = await fetchJobHistory(selectedProject, selectedFeature);
      setEntries(result.jobs);
    } catch (err: any) {
      setError(err?.message || 'Failed to load job history');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [selectedProject, selectedFeature]);

  useEffect(() => {
    void refresh();
  }, [refresh, currentJobId]);

  return { entries, loading, error, refresh };
}
