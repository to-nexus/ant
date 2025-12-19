import { useState, useEffect, useRef } from 'react';
import { getGitChanges } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';

export interface GitChanges {
  hasChanges: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
  currentBranch?: string;
}

export function useGitChanges(
  selectedProject: string | undefined,
  hasGitHubRepo: boolean | null
) {
  const { isGitStatusLoading, manualGitAction } = useStore();
  const prevLoadingRef = useRef(isGitStatusLoading);
  const prevManualActionRef = useRef(manualGitAction);
  
  const [gitChanges, setGitChanges] = useState<GitChanges | null>(null);
  const [isGitInitialized, setIsGitInitialized] = useState<boolean | null>(null);
  const [isFetchingChanges, setIsFetchingChanges] = useState(false);

  // Detect manual Git action completion and clear stale data
  useEffect(() => {
    const actionJustCompleted = prevManualActionRef.current !== null && manualGitAction === null;
    prevManualActionRef.current = manualGitAction;
    
    if (actionJustCompleted) {
      console.log('[useGitChanges] Manual Git action completed - clearing stale data');
      setGitChanges(null);
    }
  }, [manualGitAction]);

  // Fetch Git changes periodically
  useEffect(() => {
    if (!selectedProject || hasGitHubRepo === null || hasGitHubRepo === false) {
      setGitChanges(null);
      setIsGitInitialized(hasGitHubRepo === false ? false : null);
      return;
    }

    const fetchChanges = async () => {
      setIsFetchingChanges(true);
      try {
        const changes = await getGitChanges(selectedProject);
        console.log('[useGitChanges] Git changes fetched:', changes);
        setGitChanges(changes);
        setIsGitInitialized(true);
      } catch (error: any) {
        console.log('[useGitChanges] Failed to fetch Git changes:', error.message);
        if (error.message?.includes('not initialized')) {
          setGitChanges(null);
          setIsGitInitialized(false);
        }
      } finally {
        setIsFetchingChanges(false);
      }
    };

    const loadingJustStarted = prevLoadingRef.current === false && isGitStatusLoading === true;
    
    // Skip fetching while Git status is loading
    if (isGitStatusLoading) {
      console.log('[useGitChanges] Skipping fetch - Git status loading in progress');
      
      if (loadingJustStarted) {
        console.log('[useGitChanges] Loading started - clearing stale git changes');
        setGitChanges(null);
      }
      
      prevLoadingRef.current = isGitStatusLoading;
      return;
    }

    const loadingJustCompleted = prevLoadingRef.current === true && isGitStatusLoading === false;
    prevLoadingRef.current = isGitStatusLoading;
    
    if (loadingJustCompleted) {
      console.log('[useGitChanges] Loading completed - fetching immediately');
      fetchChanges();
    } else if (manualGitAction !== null) {
      console.log('[useGitChanges] Manual Git action triggered - fetching immediately');
      fetchChanges();
    } else {
      const delayTimer = setTimeout(() => {
        fetchChanges();
      }, 500);
      
      return () => {
        clearTimeout(delayTimer);
      };
    }
  }, [selectedProject, hasGitHubRepo, isGitStatusLoading, manualGitAction]);

  return {
    gitChanges,
    isGitInitialized,
    isFetchingChanges
  };
}
