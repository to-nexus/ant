import { useState, useEffect, useRef } from 'react';
import { getGitChanges } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';
import { GIT_FETCH_INTERVAL } from '@/shared/utils/constants';

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
  selectedFeature: string | undefined,
  hasGitHubRepo: boolean | null
) {
  const { isGitStatusLoading, gitStatusPhase, gitStatusRefreshTrigger, gitStatus } = useStore();
  const prevLoadingRef = useRef(isGitStatusLoading);
  const prevPhaseRef = useRef(gitStatusPhase);
  const prevTriggerRef = useRef(gitStatusRefreshTrigger);
  const prevInternalTriggerRef = useRef(0); // For internal triggerFetch state
  
  const [gitChanges, setGitChanges] = useState<GitChanges | null>(() => {
    // Initialize with cached data on mount
    if (!selectedProject) return null;
    const featureKey = selectedFeature || 'base';
    try {
      const cached = sessionStorage.getItem(`git-cache:${selectedProject}:${featureKey}`);
      const parsed = cached ? JSON.parse(cached) : null;
      // ✅ Inject currentBranch from store if available
      if (parsed && gitStatus?.currentBranch) {
        parsed.currentBranch = gitStatus.currentBranch;
      }
      return parsed;
    } catch {
      return null;
    }
  });
  const [isGitInitialized, setIsGitInitialized] = useState<boolean | null>(() => {
    if (!selectedProject) return null;
    const featureKey = selectedFeature || 'base';
    try {
      const cached = sessionStorage.getItem(`git-cache:${selectedProject}:${featureKey}`);
      const parsed = cached ? JSON.parse(cached) : null;
      return parsed?.isGitInitialized ?? null;
    } catch {
      return null;
    }
  });
  const [isFetchingChanges, setIsFetchingChanges] = useState(false);
  const [triggerFetch, setTriggerFetch] = useState(0);

  // Storage helpers - ✅ Feature 단위로 타이머 관리
  const getStorageKey = (key: string) => {
    const featureKey = selectedFeature || 'base';
    return `${key}:${selectedProject || 'none'}:${featureKey}`;
  };
  
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
      const timeString = new Date(time).toLocaleTimeString('ko-KR');
      const featureKey = selectedFeature || 'base';
      sessionStorage.setItem(getStorageKey('git-fetch-time'), time.toString());
      console.log(`[Timer] ⏰ Fetch timer set for ${selectedProject}/${featureKey} at ${timeString}`);
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

  // Load cache when project or feature changes
  useEffect(() => {
    console.log('[useGitChanges] Context changed, project:', selectedProject, 'feature:', selectedFeature);
    if (selectedProject) {
      const cached = getCachedChanges();
      console.log('[useGitChanges] Cached data:', cached);
      if (cached) {
        console.log('[useGitChanges] Loading cached data for project/feature:', selectedProject, selectedFeature);
        // ✅ Inject currentBranch from store
        if (gitStatus?.currentBranch) {
          cached.currentBranch = gitStatus.currentBranch;
        }
        setGitChanges(cached);
        setIsGitInitialized(cached.isGitInitialized ?? null);
      } else {
        console.log('[useGitChanges] No cached data found for project/feature:', selectedProject, selectedFeature);
      }
    }
  }, [selectedProject, selectedFeature]);

  // ✅ NEW: Sync currentBranch from store.gitStatus to gitChanges
  useEffect(() => {
    if (gitStatus?.currentBranch && gitChanges) {
      if (gitChanges.currentBranch !== gitStatus.currentBranch) {
        console.log(`[useGitChanges] 🔄 Syncing currentBranch from store: ${gitChanges.currentBranch} → ${gitStatus.currentBranch}`);
        setGitChanges(prev => prev ? { ...prev, currentBranch: gitStatus.currentBranch } : prev);
      }
    }
  }, [gitStatus?.currentBranch, gitChanges]);

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
    if (!selectedProject || hasGitHubRepo === null) {
      // DON'T reset gitChanges here - keep cached data visible
      return;
    }

    if (hasGitHubRepo === false) {
      setGitChanges(null);
      setIsGitInitialized(false);
      return;
    }

    const fetchChanges = async () => {
      setIsFetchingChanges(true);
      console.log(`[useGitChanges] 🔄 Starting fetch for ${selectedProject}/${selectedFeature || 'base'}...`);
      try {
        const changes = await getGitChanges(selectedProject);
        setGitChanges(changes);
        setIsGitInitialized(changes.isGitInitialized ?? true);
        setCachedChanges(changes);
        
        // ✅ CRITICAL: Only record fetch time AFTER successful completion
        const now = Date.now();
        console.log(`[useGitChanges] ✅ Fetch succeeded, recording time: ${now}`);
        setLastFetchTime(now);
      } catch (error: any) {
        console.warn(`[useGitChanges] ⚠️ Fetch failed:`, error);
        if (error.message?.includes('not initialized')) {
          setGitChanges(null);
          setIsGitInitialized(false);
        }
        // ❌ DO NOT record time on failure - allow retry without waiting
      } finally {
        setIsFetchingChanges(false);
      }
    };

    // Skip if Git operation in progress
    if (isGitStatusLoading) {
      prevLoadingRef.current = isGitStatusLoading;
      return;
    }

    const loadingJustCompleted = prevLoadingRef.current === true && isGitStatusLoading === false;
    prevLoadingRef.current = isGitStatusLoading;
    
    // Priority 1: Git operation phase in progress (switching/fetching)
    if (gitStatusPhase !== null) {
      return;
    }
    
    // Priority 2: Explicit user action (Fetch/Clone/Init button) - bypass timer
    const internalTriggerChanged = prevInternalTriggerRef.current !== triggerFetch && triggerFetch > 0;
    
    if (internalTriggerChanged) {
      console.log(`[useGitChanges] 🎯 Priority 2: Explicit user action (trigger: ${prevInternalTriggerRef.current} → ${triggerFetch}) → bypassing timer`);
      prevInternalTriggerRef.current = triggerFetch;
      fetchChanges();
      return;
    }
    
    // Update ref even if not changed (for next comparison)
    prevInternalTriggerRef.current = triggerFetch;
    
    // Priority 3: Initial load (gitChanges is null) - bypass timer
    if (gitChanges === null && !isFetchingChanges) {
      console.log(`[useGitChanges] 🎯 Priority 3: Initial load (no data) → bypassing timer`);
      fetchChanges();
      return;
    }
    
    // Priority 4: Auto-refresh with timer check
    const lastFetchTime = getLastFetchTime();
    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchTime;
    const timeRemainingMs = GIT_FETCH_INTERVAL - timeSinceLastFetch;
    
    if (timeSinceLastFetch < GIT_FETCH_INTERVAL) {
      const remainingSeconds = Math.ceil(timeRemainingMs / 1000);
      const lastFetchTimeString = lastFetchTime ? new Date(lastFetchTime).toLocaleTimeString('ko-KR') : 'never';
      console.log(`[useGitChanges] ⏸️ Priority 4: Timer not expired - ${remainingSeconds}s remaining (last fetch: ${lastFetchTimeString}) → skipping`);
      return;
    }
    
    // Timer passed - now check if we should fetch
    if (loadingJustCompleted) {
      console.log(`[useGitChanges] 🎯 Priority 4: Timer expired + loading completed → fetching`);
      fetchChanges();
      return;
    }
    
    // Delayed polling (debounce rapid re-renders)
    console.log(`[useGitChanges] 🎯 Priority 4: Timer expired + polling → fetching after 500ms`);
    const delayTimer = setTimeout(() => {
      fetchChanges();
    }, 500);
    
    return () => {
      clearTimeout(delayTimer);
    };
  }, [selectedProject, selectedFeature, hasGitHubRepo, isGitStatusLoading, gitStatusPhase, triggerFetch]);

  return {
    gitChanges,
    isGitInitialized,
    isFetchingChanges
  };
}
