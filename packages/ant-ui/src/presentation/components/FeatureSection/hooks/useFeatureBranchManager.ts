import { useEffect, useRef } from 'react';
import { switchToFeatureBranch, fetchFromGitHub } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';
import { GIT_FETCH_INTERVAL } from '@/shared/utils/constants';

// ✅ GLOBAL lock per project to prevent concurrent Git operations
const projectLocks = new Map<string, Promise<void>>();

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
 * ✅ 완전히 리팩토링된 Feature Branch Manager
 * 
 * **핵심 원칙**:
 * 1. **SSOT는 project-feature 조합**
 * 2. **Git branch는 project-feature를 추종**
 * 3. **Git status는 store.gitStatus만 사용** (단일 상태)
 * 
 * **동작**:
 * 1. Session restore 진행 중이면 대기
 * 2. Session restore 완료 후, project-feature에 맞는 branch로 전환
 * 3. Branch switch 후 fetch (타이머 체크)
 * 4. Git status 갱신 (store.gitStatus)
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
    fetchGitStatus,
    setBypassFetchTimer,
    bypassFetchTimer,
    isSessionRestoring,
    sessionRestoreCompleted,
  } = useStore();
  
  // ✅ Track operations
  const isProcessing = useRef(false);
  const lastProcessed = useRef<string>('');

  useEffect(() => {
    const syncBranchWithFeature = async () => {
      // ✅ Prerequisite checks
      if (!selectedProject) return;
      if (gitStatus === null) return;  // Wait for initial Git status check
      if (!gitStatus.hasGit) return;   // Git not initialized
      
      // ✅ CRITICAL: Wait for session restore to complete
      if (isSessionRestoring) {
        return;
      }
      
      // ✅ Determine target branch based on SSOT (project-feature)
      const targetBranch = selectedFeature ? `feature/${selectedFeature}` : baseBranch;
      const currentBranch = gitStatus.currentBranch;
      const operationKey = `${selectedProject}:${selectedFeature || 'base'}:${bypassFetchTimer}`;
      
      // ✅ Already processed this operation
      if (lastProcessed.current === operationKey) {
        return;
      }
      
      // ✅ Already on target branch
      if (currentBranch === targetBranch) {
        // ✅ CRITICAL: Even if on target branch, check if we need to fetch
        const shouldBypass = bypassFetchTimer;
        const skipResult = shouldSkipFetch(selectedProject, selectedFeature);
        
        // Only skip if we've already processed this operation AND timer not expired
        if (lastProcessed.current === operationKey && skipResult.skip && !shouldBypass) {
          return;
        }
        
        // Need to fetch (timer expired or bypass flag set)
        if (shouldBypass || !skipResult.skip) {
          // Perform fetch without branch switch
          isProcessing.current = true;
          setGitStatusLoading(true);
          
          const executeFetch = async () => {
            try {
              const shouldFetch = shouldBypass || !skipResult.skip;
              
              if (shouldFetch) {
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
              }
            } finally {
              setGitStatusPhase(null);
              setGitStatusLoading(false);
              isProcessing.current = false;
              
              // ✅ Refresh Git status in store
              refreshGitStatus();
            }
          };
          
          await executeFetch();
        }
        
        lastProcessed.current = operationKey;
        return;
      }
      
      // ✅ Check for concurrent operations
      if (isProcessing.current) {
        return;
      }
      
      // ✅ Wait for any existing lock on this project
      const existingLock = projectLocks.get(selectedProject);
      if (existingLock) {
        try {
          await existingLock;
        } catch {
          // Previous operation failed, continuing...
        }
        
        // After waiting, check if still needed
        if (lastProcessed.current === operationKey) {
          return;
        }
      }
      
      // ✅ Start Git operation
      isProcessing.current = true;
      setGitStatusLoading(true);
      
      const executeLock = async () => {
        try {
          // ✅ Phase 1: Branch switch
          setGitStatusPhase('switching');
          
          const result = await switchToFeatureBranch(
            selectedProject,
            selectedFeature || baseBranch
          );
          
          if (!result.success) {
            console.error('[useFeatureBranchManager] Branch switch failed:', result.error);
            return;
          }
          
          // ✅ Immediately fetch and update Git status in store
          await fetchGitStatus(selectedProject);
          
          // ✅ End switching phase immediately to update UI
          setGitStatusPhase(null);
          
          lastProcessed.current = operationKey;
          
          // ✅ Phase 2: Fetch (check bypass flag or timer)
          const shouldBypass = bypassFetchTimer;
          const skipResult = shouldSkipFetch(selectedProject, selectedFeature);
          const shouldFetch = shouldBypass || !skipResult.skip;
          
          if (shouldFetch) {
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
          }
          
        } catch (error) {
          console.error('[useFeatureBranchManager] Branch operation error:', error);
          throw error;
        } finally {
          setGitStatusPhase(null);
          setGitStatusLoading(false);
          isProcessing.current = false;
          
          // ✅ Refresh Git status in store (final)
          refreshGitStatus();
          
          projectLocks.delete(selectedProject);
        }
      };
      
      const lockPromise = executeLock();
      projectLocks.set(selectedProject, lockPromise);
      await lockPromise;
    };
    
    syncBranchWithFeature();
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
