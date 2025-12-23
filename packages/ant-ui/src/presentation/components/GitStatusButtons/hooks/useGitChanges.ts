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
  isGitInitialized?: boolean;
}

export function useGitChanges(
  selectedProject: string | undefined,
  hasGitHubRepo: boolean | null
) {
  const { isGitStatusLoading, gitStatusPhase, gitStatusRefreshTrigger } = useStore();
  const prevLoadingRef = useRef(isGitStatusLoading);
  const prevPhaseRef = useRef(gitStatusPhase);
  const prevTriggerRef = useRef(gitStatusRefreshTrigger);
  const prevInternalTriggerRef = useRef(0); // For internal triggerFetch state
  
  const [gitChanges, setGitChanges] = useState<GitChanges | null>(() => {
    // Initialize with cached data on mount
    if (!selectedProject) return null;
    try {
      const cached = sessionStorage.getItem(`git-cache:${selectedProject}`);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [isGitInitialized, setIsGitInitialized] = useState<boolean | null>(() => {
    if (!selectedProject) return null;
    try {
      const cached = sessionStorage.getItem(`git-cache:${selectedProject}`);
      const parsed = cached ? JSON.parse(cached) : null;
      return parsed?.isGitInitialized ?? null;
    } catch {
      return null;
    }
  });
  const [isFetchingChanges, setIsFetchingChanges] = useState(false);
  const [triggerFetch, setTriggerFetch] = useState(0);

  const FETCH_INTERVAL = 5 * 60 * 1000; // 5 minutes

  // Storage helpers
  const getStorageKey = (key: string) => `${key}:${selectedProject || 'none'}`;
  
  const getLastFetchTime = (): number => {
    try {
      const stored = sessionStorage.getItem(getStorageKey('git-fetch-time'));
      return stored ? parseInt(stored, 10) : 0;
    } catch {
      return 0;
    }
  };
  
  const setLastFetchTime = (time: number) => {
    try {
      sessionStorage.setItem(getStorageKey('git-fetch-time'), time.toString());
    } catch {}
  };
  
  const getCachedChanges = (): GitChanges | null => {
    try {
      const cached = sessionStorage.getItem(getStorageKey('git-cache'));
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  };
  
  const setCachedChanges = (changes: GitChanges) => {
    try {
      sessionStorage.setItem(getStorageKey('git-cache'), JSON.stringify(changes));
    } catch {}
  };

  // Load cache when project changes
  useEffect(() => {
    console.log('[useGitChanges] Project changed, selectedProject:', selectedProject);
    if (selectedProject) {
      const cached = getCachedChanges();
      console.log('[useGitChanges] Cached data:', cached);
      if (cached) {
        console.log('[useGitChanges] Loading cached data for project:', selectedProject);
        setGitChanges(cached);
        setIsGitInitialized(cached.isGitInitialized ?? null);
      } else {
        console.log('[useGitChanges] No cached data found for project:', selectedProject);
      }
    }
  }, [selectedProject]);

  // Detect Git operation completion and trigger refetch
  useEffect(() => {
    const operationJustCompleted = prevPhaseRef.current !== null && gitStatusPhase === null;
    prevPhaseRef.current = gitStatusPhase;
    
    if (operationJustCompleted) {
      setTriggerFetch(prev => prev + 1);
    }
  }, [gitStatusPhase]);
  
  // Detect explicit refresh trigger (e.g. Fetch button click)
  useEffect(() => {
    const triggerChanged = prevTriggerRef.current !== gitStatusRefreshTrigger && gitStatusRefreshTrigger > 0;
    prevTriggerRef.current = gitStatusRefreshTrigger;
    
    if (triggerChanged) {
      console.log(`[useGitChanges] 🔄 Explicit refresh trigger: ${gitStatusRefreshTrigger}`);
      setTriggerFetch(prev => prev + 1);
    }
  }, [gitStatusRefreshTrigger]);

  // Main fetch logic
  useEffect(() => {
    console.log('[useGitChanges] Main effect triggered, selectedProject:', selectedProject, 'hasGitHubRepo:', hasGitHubRepo, 'gitChanges:', gitChanges, 'isGitInitialized:', isGitInitialized);
    
    if (!selectedProject || hasGitHubRepo === null) {
      console.log('[useGitChanges] Early return: no project or hasGitHubRepo is null');
      // DON'T reset gitChanges here - keep cached data visible
      return;
    }

    if (hasGitHubRepo === false) {
      console.log('[useGitChanges] GitHub repo not configured');
      setGitChanges(null);
      setIsGitInitialized(false);
      return;
    }

    const fetchChanges = async () => {
      setIsFetchingChanges(true);
      try {
        const changes = await getGitChanges(selectedProject);
        setGitChanges(changes);
        setIsGitInitialized(changes.isGitInitialized ?? true);
        setLastFetchTime(Date.now());
        setCachedChanges(changes);
      } catch (error: any) {
        if (error.message?.includes('not initialized')) {
          setGitChanges(null);
          setIsGitInitialized(false);
        }
      } finally {
        setIsFetchingChanges(false);
      }
    };

    if (isGitStatusLoading) {
      prevLoadingRef.current = isGitStatusLoading;
      return;
    }

    const loadingJustCompleted = prevLoadingRef.current === true && isGitStatusLoading === false;
    prevLoadingRef.current = isGitStatusLoading;
    
    // Priority 1: Git operation in progress
    if (gitStatusPhase !== null) {
      return;
    }
    
    // Priority 2: Explicit user action (Fetch/Clone/Init button) - bypass timer
    const internalTriggerChanged = prevInternalTriggerRef.current !== triggerFetch && triggerFetch > 0;
    prevInternalTriggerRef.current = triggerFetch;
    
    if (internalTriggerChanged) {
      console.log(`[useGitChanges] 🔄 Explicit user action detected (triggerFetch: ${triggerFetch}) → fetching immediately`);
      fetchChanges();
      return;
    }
    
    // Priority 3: Initial load (gitChanges is null) - bypass timer
    // This happens on first load or when cache failed to load
    if (gitChanges === null && !isFetchingChanges) {
      console.log(`[useGitChanges] 🔄 Initial load (no data) → fetching immediately`);
      fetchChanges();
      return;
    }
    
    // Priority 4: Auto-refresh with timer check (including loadingJustCompleted)
    const timeSinceLastFetch = Date.now() - getLastFetchTime();
    if (timeSinceLastFetch < FETCH_INTERVAL) {
      console.log(`[useGitChanges] ⏸️ Skipping fetch - within interval (${Math.floor(timeSinceLastFetch / 1000)}s / ${FETCH_INTERVAL / 1000}s)`);
      return;
    }
    
    // Timer passed - now check if we should fetch
    if (loadingJustCompleted) {
      console.log(`[useGitChanges] ⏰ Timer passed + loadingJustCompleted → fetching`);
      fetchChanges();
      return;
    }
    
    const delayTimer = setTimeout(() => {
      console.log(`[useGitChanges] ⏰ Timer passed + delayed polling → fetching`);
      fetchChanges();
    }, 500);
    
    return () => {
      clearTimeout(delayTimer);
    };
  }, [selectedProject, hasGitHubRepo, isGitStatusLoading, gitStatusPhase, triggerFetch]);

  return {
    gitChanges,
    isGitInitialized,
    isFetchingChanges
  };
}
