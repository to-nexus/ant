import { useState, useEffect, useRef } from 'react';
import { fetchProjectConfig } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';

export function useGitHubRepoConfig(selectedProject: string | undefined) {
  const mainPanelOpenTabs = useStore((state) => state.mainPanelOpenTabs);
  const gitStatusRefreshTrigger = useStore((state) => state.gitStatusRefreshTrigger); // ✅ NEW: Listen to config changes
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
        const hasRepo = !!config?.githubRepo;
        
        // const prevHasRepo = hasGitHubRepo; // Reserved for future use
        setHasGitHubRepo(hasRepo);
      } catch (error) {
        console.error('[useGitHubRepoConfig] Failed to fetch config:', error);
        setHasGitHubRepo(false);
      }
    };

    prevProjectConfigTabOpenRef.current = mainPanelOpenTabs.projectConfig;

    checkConfig();
  }, [selectedProject, mainPanelOpenTabs.projectConfig, gitStatusRefreshTrigger]); // ✅ Added gitStatusRefreshTrigger

  return hasGitHubRepo;
}
