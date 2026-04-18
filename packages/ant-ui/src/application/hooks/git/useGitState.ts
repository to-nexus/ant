import { useStore } from '@/domain/store';
import type { GitStatusResponse, GitChangesResponse } from '@ant/shared';
import type { GitPhase } from '@/domain/store/types';

export interface UseGitStateResult {
  gitStatus: GitStatusResponse | null;
  gitChanges: GitChangesResponse | null;
  statusFetchState: 'idle' | 'pending';
  changesFetchState: 'idle' | 'pending';
  gitStatusPhase: GitPhase | null;
}

/**
 * Read-only Git state for presentation components.
 *
 * Presentation MUST use this hook (or `useGitActions`) instead of calling
 * `useStore` directly for git fields — see `docs/architecture/30-frontend-architecture.md`
 * layer rules.
 */
export function useGitState(): UseGitStateResult {
  const gitStatus = useStore((s) => s.gitStatus);
  const gitChanges = useStore((s) => s.gitChanges);
  const statusFetchState = useStore((s) => s.statusFetchState);
  const changesFetchState = useStore((s) => s.changesFetchState);
  const gitStatusPhase = useStore((s) => s.gitStatusPhase);
  return { gitStatus, gitChanges, statusFetchState, changesFetchState, gitStatusPhase };
}
