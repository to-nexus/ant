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
  const [triggerFetch, setTriggerFetch] = useState(0);  // ✅ Trigger for manual refetch

  // Detect manual Git action completion and trigger refetch
  useEffect(() => {
    const actionJustCompleted = prevManualActionRef.current !== null && manualGitAction === null;
    prevManualActionRef.current = manualGitAction;
    
    if (actionJustCompleted) {
      setGitChanges(null);
      setTriggerFetch(prev => prev + 1);  // ✅ Trigger refetch
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
        setGitChanges(changes);
        setIsGitInitialized(true);
      } catch (error: any) {
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
      if (loadingJustStarted) {
        setGitChanges(null);
      }
      
      prevLoadingRef.current = isGitStatusLoading;
      return;
    }

    const loadingJustCompleted = prevLoadingRef.current === true && isGitStatusLoading === false;
    prevLoadingRef.current = isGitStatusLoading;
    
    // ✅ Priority 1: Loading just completed
    if (loadingJustCompleted) {
      fetchChanges();
      return;
    }
    
    // ✅ Priority 2: Manual action in progress (show loading state)
    if (manualGitAction !== null) {
      return;
    }
    
    // ✅ Priority 3: Trigger fetch was incremented (manual action completed)
    if (triggerFetch > 0) {
      fetchChanges();
      return;
    }
    
    // ✅ Priority 4: Periodic polling (normal case)
    const delayTimer = setTimeout(() => {
      fetchChanges();
    }, 500);
    
    return () => {
      clearTimeout(delayTimer);
    };
  }, [selectedProject, hasGitHubRepo, isGitStatusLoading, manualGitAction, triggerFetch]);

  return {
    gitChanges,
    isGitInitialized,
    isFetchingChanges
  };
}
