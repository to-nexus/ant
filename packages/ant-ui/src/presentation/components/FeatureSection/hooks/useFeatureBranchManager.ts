import { useEffect, useRef } from 'react';
import { fetchFromGitHub } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';
import { GIT_FETCH_INTERVAL } from '@/shared/utils/constants';

// ✅ Feature 단위로 타이머 관리
function shouldSkipFetch(projectName: string, featureName: string | undefined): { skip: boolean; remainingSeconds?: number; lastFetchTime?: string } {
  const featureKey = featureName || 'base';
  const lastFetchKey = `git-fetch-time:${projectName}:${featureKey}`;
  const lastFetchTime = sessionStorage.getItem(lastFetchKey);
  
  if (!lastFetchTime) {
    return { skip: false };
  }
  
  const lastFetchTimestamp = parseInt(lastFetchTime, 10);
  const timeSinceLastFetch = Date.now() - lastFetchTimestamp;
  const shouldSkip = timeSinceLastFetch < GIT_FETCH_INTERVAL;
  
  if (shouldSkip) {
    const remainingMs = GIT_FETCH_INTERVAL - timeSinceLastFetch;
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const lastFetchDate = new Date(lastFetchTimestamp).toLocaleTimeString('ko-KR');
    return { skip: true, remainingSeconds, lastFetchTime: lastFetchDate };
  }
  
  return { skip: false };
}

function recordFetchTime(projectName: string, featureName: string | undefined): void {
  const featureKey = featureName || 'base';
  const lastFetchKey = `git-fetch-time:${projectName}:${featureKey}`;
  sessionStorage.setItem(lastFetchKey, Date.now().toString());
}

/**
 * ✅ Feature Branch Manager (Worktree-based)
 * 
 * With Git worktrees, each feature has its own working directory with the correct
 * branch already checked out. Branch switching is no longer needed.
 * 
 * **핵심 원칙**:
 * 1. **Branch switching 불필요** - 각 worktree가 이미 올바른 브랜치를 가짐
 * 2. **Git fetch는 feature별 worktree에서 실행**
 * 3. **Git status는 store.gitStatus만 사용** (단일 상태)
 * 
 * **동작**:
 * 1. Session restore 진행 중이면 대기
 * 2. Session restore 완료 후, feature의 worktree에서 fetch (타이머 체크)
 * 3. Git status 갱신 (store.gitStatus)
 */
export function useFeatureBranchManager(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  baseBranch: string
) {
  const { 
    gitStatus,
    setGitStatusLoading,
    setGitStatusPhase,
    refreshGitStatus,
    setBypassFetchTimer,
    bypassFetchTimer,
    isSessionRestoring,
    sessionRestoreCompleted,
  } = useStore();
  
  // ✅ Track operations
  const isProcessing = useRef(false);
  const lastProcessed = useRef<string>('');

  useEffect(() => {
    const syncFeatureStatus = async () => {
      // ✅ Prerequisite checks
      if (!selectedProject) return;
      if (gitStatus === null) return;  // Wait for initial Git status check
      if (!gitStatus.hasGit) return;   // Git not initialized
      
      // ✅ CRITICAL: Wait for session restore to complete
      if (isSessionRestoring) {
        return;
      }
      
      const operationKey = `${selectedProject}:${selectedFeature || 'base'}:${bypassFetchTimer}`;
      
      // ✅ Already processed this operation
      if (lastProcessed.current === operationKey) {
        return;
      }
      
      // ✅ Check for concurrent operations
      if (isProcessing.current) {
        return;
      }
      
      // ✅ Check if we need to fetch
      const shouldBypass = bypassFetchTimer;
      const skipResult = shouldSkipFetch(selectedProject, selectedFeature);
      const shouldFetch = shouldBypass || !skipResult.skip;
      
      if (!shouldFetch) {
        // No fetch needed - just refresh status for this feature's worktree
        lastProcessed.current = operationKey;
        refreshGitStatus();
        return;
      }
      
      // ✅ Perform fetch
      isProcessing.current = true;
      setGitStatusLoading(true);
      
      try {
        setGitStatusPhase('fetching');
        
        if (shouldBypass) {
          setBypassFetchTimer(false);
        }
        
        try {
          const fetchResult = await fetchFromGitHub(selectedProject, selectedFeature);
          if (fetchResult.success) {
            recordFetchTime(selectedProject, selectedFeature);
          }
        } catch (fetchError) {
          console.warn('[useFeatureBranchManager] Fetch error:', fetchError);
        }
      } finally {
        setGitStatusPhase(null);
        setGitStatusLoading(false);
        isProcessing.current = false;
        lastProcessed.current = operationKey;
        
        // ✅ Refresh Git status in store
        refreshGitStatus();
      }
    };
    
    syncFeatureStatus();
  }, [
    selectedProject,
    selectedFeature,
    baseBranch,
    gitStatus,
    isSessionRestoring,
    sessionRestoreCompleted,
    bypassFetchTimer, // ← Fetch 버튼 클릭 시 재실행
  ]);

  // ✅ Reset on project change
  useEffect(() => {
    lastProcessed.current = '';
  }, [selectedProject]);
}
