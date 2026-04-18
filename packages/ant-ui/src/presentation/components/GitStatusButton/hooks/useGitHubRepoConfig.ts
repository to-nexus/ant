import { useState, useEffect, useRef } from 'react';
import { fetchProjectConfig } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';

/**
 * Watches `projectConfig.githubRepo` for the given project. Previously this
 * hook also re-ran when a global `gitStatusRefreshTrigger` counter bumped —
 * that carrier is gone. Re-loads now happen on:
 *   - project change
 *   - opening the project-config tab (handled by the existing
 *     `mainPanelOpenTabs.projectConfig` dep)
 * ConfigEditor's save handler calls `fetchGitAll` directly when it mutates
 * the repo URL, which triggers any downstream selector re-renders.
 */
export function useGitHubRepoConfig(selectedProject: string | undefined) {
  const mainPanelOpenTabs = useStore((state) => state.mainPanelOpenTabs);
  const prevProjectConfigTabOpenRef = useRef(mainPanelOpenTabs.projectConfig);
  const [hasGitHubRepo, setHasGitHubRepo] = useState<boolean | null>(null);

  useEffect(() => {
    if (!selectedProject) {
      setHasGitHubRepo(null);
      prevProjectConfigTabOpenRef.current = mainPanelOpenTabs.projectConfig;
      return;
    }

    const checkConfig = async () => {
      try {
        const config = await fetchProjectConfig(selectedProject);
        setHasGitHubRepo(!!config?.githubRepo);
      } catch (error) {
        console.error('[useGitHubRepoConfig] Failed to fetch config:', error);
        setHasGitHubRepo(false);
      }
    };

    prevProjectConfigTabOpenRef.current = mainPanelOpenTabs.projectConfig;
    checkConfig();
  }, [selectedProject, mainPanelOpenTabs.projectConfig]);

  return hasGitHubRepo;
}
