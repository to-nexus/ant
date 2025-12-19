import { useState, useEffect, useRef } from 'react';
import { fetchProjectConfig } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';

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
        const hasRepo = !!config?.githubRepo;
        console.log('[useGitHubRepoConfig] Config checked - hasGitHubRepo:', hasRepo);
        
        const prevHasRepo = hasGitHubRepo;
        setHasGitHubRepo(hasRepo);
        
        if (!prevHasRepo && hasRepo) {
          console.log('[useGitHubRepoConfig] 🎉 GitHub repo just configured!');
        }
      } catch (error) {
        console.log('[useGitHubRepoConfig] Failed to fetch config:', error);
        setHasGitHubRepo(false);
      }
    };

    // Check config when project changes or project config tab closes
    const projectConfigTabJustClosed = 
      prevProjectConfigTabOpenRef.current === true && 
      mainPanelOpenTabs.projectConfig === false;
    
    prevProjectConfigTabOpenRef.current = mainPanelOpenTabs.projectConfig;
    
    if (projectConfigTabJustClosed) {
      console.log('[useGitHubRepoConfig] Project Config tab closed - rechecking config');
    }

    checkConfig();
  }, [selectedProject, mainPanelOpenTabs.projectConfig]);

  return hasGitHubRepo;
}
