import { useStore } from '@/domain/store';

/**
 * Returns whether the currently-selected project has a GitHub repo URL
 * configured. Previously this hook ran its own `fetchProjectConfig` call
 * on tab open; that duplicated projectConfigSlice and left stale data in
 * the failure path. Now it simply projects off the slice which is the
 * single source of truth.
 *
 *   status === 'idle' | 'loading' → null  (unknown yet)
 *   status === 'ready' | 'empty'  → boolean (based on data.githubRepo)
 *   status === 'error'            → false  (conservative: hide the action)
 */
export function useGitHubRepoConfig(selectedProject: string | undefined): boolean | null {
  const status = useStore((s) => s.projectConfig.status);
  const githubRepo = useStore((s) => s.projectConfig.data?.githubRepo);

  if (!selectedProject) return null;
  if (status === 'idle' || status === 'loading') return null;
  if (status === 'error') return false;
  return !!githubRepo;
}
