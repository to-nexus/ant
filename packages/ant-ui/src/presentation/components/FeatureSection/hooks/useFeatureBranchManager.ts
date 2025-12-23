import { useEffect, useRef } from 'react';
import { switchToFeatureBranch, fetchFromGitHub } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';

interface GitStatus {
  hasGit: boolean;
  hasCodebase: boolean;
  hasFeatures: boolean;
}

// ✅ GLOBAL lock per project to prevent concurrent Git operations
const projectLocks = new Map<string, Promise<void>>();

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
      
      // Wait for Git status check to complete
      if (gitStatus === null) {
        return;
      }
      
      // Only proceed if Git is initialized
      if (!gitStatus.hasGit) {
        return;
      }
      
      // ✅ FIXED: Prevent duplicate operations
      const operationKey = `${selectedProject}:${selectedFeature || baseBranch}`;
      
      // ✅ Check if already processed
      if (lastProcessed.current === operationKey) {
        console.log(`[useFeatureBranchManager] ✅ Already processed: ${operationKey}`);
        return;
      }
      
      // ✅ CRITICAL: Wait for any existing lock on this project
      const existingLock = projectLocks.get(selectedProject);
      if (existingLock) {
        console.log(`[useFeatureBranchManager] ⏳ Waiting for existing Git operation on ${selectedProject}...`);
        try {
          await existingLock;
        } catch (err) {
          console.warn(`[useFeatureBranchManager] Previous operation failed, continuing...`);
        }
        
        // After waiting, check if this operation is still needed
        if (lastProcessed.current === operationKey) {
          console.log(`[useFeatureBranchManager] ✅ Already processed while waiting: ${operationKey}`);
          return;
        }
      }
      
      // Start Git status loading
      console.log(`[useFeatureBranchManager] 🚀 Starting operation: ${operationKey}`);
      isProcessing.current = true;
      currentOperation.current = operationKey;
      setGitStatusLoading(true);
      
      // ✅ Create lock for this operation
      const executeLock = async () => {
        try {
          if (selectedFeature) {
            // Phase 1: Switch to feature branch
            setGitStatusPhase('switching');
            const result = await switchToFeatureBranch(selectedProject, selectedFeature);
            
            if (result.success) {
              if (result.branchName) {
                setCurrentGitBranch(result.branchName);
              }
              lastProcessed.current = operationKey;
              
              // Phase 2: Fetch from remote
              setGitStatusPhase('fetching');
              try {
                const fetchResult = await fetchFromGitHub(selectedProject);
                if (!fetchResult.success) {
                  console.warn(`[useFeatureBranchManager] Fetch failed:`, fetchResult.error);
                }
              } catch (fetchError) {
                console.warn('[useFeatureBranchManager] Fetch error (non-critical):', fetchError);
              }
            } else {
              console.error('[useFeatureBranchManager] Branch switch failed:', result.error);
            }
          } else {
            // Phase 1: Switch to base branch
            setGitStatusPhase('switching');
            const result = await switchToFeatureBranch(selectedProject, baseBranch);
            
            if (result.success) {
              if (result.branchName) {
                setCurrentGitBranch(result.branchName);
              }
              lastProcessed.current = operationKey;
              
              // Phase 2: Fetch from remote
              setGitStatusPhase('fetching');
              try {
                const fetchResult = await fetchFromGitHub(selectedProject);
                if (!fetchResult.success) {
                  console.warn(`[useFeatureBranchManager] Fetch failed:`, fetchResult.error);
                }
              } catch (fetchError) {
                console.warn('[useFeatureBranchManager] Fetch error (non-critical):', fetchError);
              }
            } else {
              console.error(`[useFeatureBranchManager] Failed to switch to ${baseBranch}:`, result.error);
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
