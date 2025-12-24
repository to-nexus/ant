import { useEffect, useRef } from 'react';
import { switchToFeatureBranch, fetchFromGitHub } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';

interface GitStatus {
  hasGit: boolean;
  hasCodebase: boolean;
  hasFeatures: boolean;
  currentBranch?: string;
}

// ✅ GLOBAL lock per project to prevent concurrent Git operations
const projectLocks = new Map<string, Promise<void>>();

// ✅ Fetch timer constants
const FETCH_INTERVAL = 5 * 60 * 1000; // 5 minutes

function shouldSkipFetch(projectName: string): boolean {
  const lastFetchKey = `git-fetch-time:${projectName}`;
  const lastFetchTime = sessionStorage.getItem(lastFetchKey);
  
  if (!lastFetchTime) {
    return false;
  }
  
  const timeSinceLastFetch = Date.now() - parseInt(lastFetchTime, 10);
  return timeSinceLastFetch < FETCH_INTERVAL;
}

function recordFetchTime(projectName: string): void {
  const lastFetchKey = `git-fetch-time:${projectName}`;
  sessionStorage.setItem(lastFetchKey, Date.now().toString());
}

export function useFeatureBranchManager(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  baseBranch: string,
  gitStatus: GitStatus | null
) {
  const setGitStatusLoading = useStore((state) => state.setGitStatusLoading);
  const setGitStatusPhase = useStore((state) => state.setGitStatusPhase);
  const setCurrentGitBranch = useStore((state) => state.setCurrentGitBranch);
  
  // ✅ FIXED: Prevent concurrent Git operations
  const isProcessing = useRef(false);
  const lastProcessed = useRef<string>('');
  const currentOperation = useRef<string>('');  // ✅ Track what we're actually processing

  useEffect(() => {
    const checkoutBranch = async () => {
      if (!selectedProject) return;
      
      // Wait for Git status check to complete (one-time check)
      if (gitStatus === null) {
        return;
      }
      
      // Only proceed if Git is initialized
      if (!gitStatus.hasGit) {
        return;
      }
      
      // ✅ Capture gitStatus at start of operation (don't react to updates)
      const initialGitStatus = gitStatus;
      
      // ✅ FIXED: Prevent duplicate operations
      const operationKey = `${selectedProject}:${selectedFeature || baseBranch}`;
      
      // ✅ Check if this operation is already in progress
      if (isProcessing.current && currentOperation.current === operationKey) {
        return;
      }
      
      // ✅ Check if already on target branch (use actual Git branch, not store)
      const targetBranch = selectedFeature ? `feature/${selectedFeature}` : baseBranch;
      const actualGitBranch = initialGitStatus.currentBranch;
      
      if (lastProcessed.current === operationKey && actualGitBranch === targetBranch) {
        // Update store to match reality
        setCurrentGitBranch(actualGitBranch);
        return;
      }
      
      // ✅ CRITICAL: Wait for any existing lock on this project
      const existingLock = projectLocks.get(selectedProject);
      if (existingLock) {
        try {
          await existingLock;
        } catch (err) {
          console.warn(`[useFeatureBranchManager] Previous operation failed, continuing...`);
        }
        
        // After waiting, check if this operation is still needed
        if (lastProcessed.current === operationKey) {
          return;
        }
      }
      
      // Start Git status loading
      isProcessing.current = true;
      currentOperation.current = operationKey;
      setGitStatusLoading(true);
      
      // ✅ Create lock for this operation
      const executeLock = async () => {
        try {
          // Determine target branch
          const targetBranch = selectedFeature 
            ? `feature/${selectedFeature}` 
            : baseBranch;
          
          // ✅ CRITICAL: Fetch current Git status in real-time (don't use cached initialGitStatus)
          // initialGitStatus can be stale when switching features quickly
          let currentBranch = initialGitStatus.currentBranch;
          try {
            const { getGitStatus } = await import('@/infrastructure/http/api');
            const freshGitStatus = await getGitStatus(selectedProject);
            currentBranch = freshGitStatus.currentBranch;
          } catch (error) {
            console.warn(`[useFeatureBranchManager] Failed to fetch fresh Git status, using cached:`, error);
          }
          
          // ✅ Phase 1: Branch switch (if needed)
          if (currentBranch !== targetBranch) {
            setGitStatusPhase('switching');
            
            if (selectedFeature) {
              const result = await switchToFeatureBranch(selectedProject, selectedFeature);
              
              if (result.success) {
                if (result.branchName) {
                  setCurrentGitBranch(result.branchName);
                }
                lastProcessed.current = operationKey;
              } else {
                console.error('[useFeatureBranchManager] Branch switch failed:', result.error);
                return; // Don't fetch if switch failed
              }
            } else {
              const result = await switchToFeatureBranch(selectedProject, baseBranch);
              
              if (result.success) {
                if (result.branchName) {
                  setCurrentGitBranch(result.branchName);
                }
                lastProcessed.current = operationKey;
              } else {
                console.error(`[useFeatureBranchManager] Failed to switch to ${baseBranch}:`, result.error);
                return; // Don't fetch if switch failed
              }
            }
          } else {
            lastProcessed.current = operationKey;
          }
          
          // ✅ Phase 2: Fetch (if timer allows)
          if (!shouldSkipFetch(selectedProject)) {
            setGitStatusPhase('fetching');
            try {
              const fetchResult = await fetchFromGitHub(selectedProject);
              if (fetchResult.success) {
                recordFetchTime(selectedProject);
              } else {
                console.warn(`[useFeatureBranchManager] Fetch failed (non-critical):`, fetchResult.error);
              }
            } catch (fetchError) {
              console.warn('[useFeatureBranchManager] Fetch error (non-critical):', fetchError);
            }
          }
        } catch (error) {
          console.error('[useFeatureBranchManager] Branch switch error:', error);
          throw error;  // Re-throw to mark lock as failed
        } finally {
          // End Git status loading
          setGitStatusPhase(null);
          setGitStatusLoading(false);
          isProcessing.current = false;
          
          // ✅ Trigger Git status refresh
          useStore.setState((state) => ({ 
            gitStatusRefreshTrigger: state.gitStatusRefreshTrigger + 1 
          }));
          
          // ✅ Remove lock when done
          projectLocks.delete(selectedProject);
        }
      };
      
      // ✅ Store and execute lock
      const lockPromise = executeLock();
      projectLocks.set(selectedProject, lockPromise);
      
      // Wait for completion
      await lockPromise;
    };
    
    checkoutBranch();
  }, [selectedProject, selectedFeature, baseBranch, gitStatus, setGitStatusLoading, setGitStatusPhase, setCurrentGitBranch]);
  
  // ✅ FIXED: Reset when project changes
  useEffect(() => {
    console.log(`[useFeatureBranchManager] 🔄 Project changed, resetting state`);
    lastProcessed.current = '';
    currentOperation.current = '';
    isProcessing.current = false;
  }, [selectedProject]);
}
