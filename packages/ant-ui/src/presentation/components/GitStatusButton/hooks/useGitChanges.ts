import { useStore } from '@/domain/store';
import type { GitChanges as ApiGitChanges } from '@/infrastructure/http/api';

// Type re-exports preserve existing consumer imports:
//   import { GitChanges, FileChange } from '.../useGitChanges'
// The canonical definitions now live in infrastructure/http/api (the REST
// contract layer), not in this hook.
export type { FileChange, GitChanges } from '@/infrastructure/http/api';

interface UseGitChangesResult {
  gitChanges: ApiGitChanges | null;
  isGitInitialized: boolean | null;
  isFetchingChanges: boolean;
}

/**
 * Selector-only hook exposing Git working-tree state from the store.
 *
 * Previously this hook owned ~268 lines of fetch orchestration, sessionStorage
 * caching, SSE handler registration, and cross-slice re-injection. All of that
 * now lives in `gitSlice.fetchGitChanges` / `gitSlice.clearGitChanges` and
 * `sseSlice.initializeSSE`. This hook is the thin read-path only.
 */
export function useGitChanges(): UseGitChangesResult {
  return useStore((s): UseGitChangesResult => ({
    gitChanges: s.gitChanges,
    isGitInitialized: s.isGitInitialized,
    isFetchingChanges: s.isFetchingChanges,
  }));
}
