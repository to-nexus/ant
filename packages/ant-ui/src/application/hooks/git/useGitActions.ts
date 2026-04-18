import { useStore } from '@/domain/store';
import type { GitPhase } from '@/domain/store/types';

export interface UseGitActionsResult {
  fetchGitStatus: (projectId: string, feature?: string) => Promise<void>;
  fetchGitChanges: (projectId: string, feature?: string) => Promise<void>;
  fetchGitAll: (projectId: string, feature?: string) => Promise<void>;
  fetchFromRemote: (projectId: string, feature?: string) => Promise<void>;
  setGitStatusPhase: (phase: GitPhase | null) => void;
  clearGitState: () => void;
}

/**
 * Write-side Git actions for presentation components.
 *
 * All actions are explicit — no auto-triggered side effects from phase
 * transitions, no carrier flags (bypassFetchTimer), no counter refreshes.
 */
export function useGitActions(): UseGitActionsResult {
  const fetchGitStatus = useStore((s) => s.fetchGitStatus);
  const fetchGitChanges = useStore((s) => s.fetchGitChanges);
  const fetchGitAll = useStore((s) => s.fetchGitAll);
  const fetchFromRemote = useStore((s) => s.fetchFromRemote);
  const setGitStatusPhase = useStore((s) => s.setGitStatusPhase);
  const clearGitState = useStore((s) => s.clearGitState);
  return {
    fetchGitStatus,
    fetchGitChanges,
    fetchGitAll,
    fetchFromRemote,
    setGitStatusPhase,
    clearGitState,
  };
}
