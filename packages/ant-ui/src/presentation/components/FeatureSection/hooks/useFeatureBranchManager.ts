import { useEffect, useRef } from 'react';
import { switchToFeatureBranch, fetchFromGitHub } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';

interface GitStatus {
  hasGit: boolean;
  hasCodebase: boolean;
  hasFeatures: boolean;
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
      if (isProcessing.current) {
        return;
      }
      if (lastProcessed.current === operationKey) {
        return;
      }
      
      // Start Git status loading
      isProcessing.current = true;
      setGitStatusLoading(true);
      
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
      } finally {
        // End Git status loading
        setGitStatusPhase(null);
        setGitStatusLoading(false);
        isProcessing.current = false;
      }
    };
    
    checkoutBranch();
  }, [selectedProject, selectedFeature, baseBranch, gitStatus, setGitStatusLoading, setGitStatusPhase, setCurrentGitBranch]);
  
  // ✅ FIXED: Reset when project changes
  useEffect(() => {
    lastProcessed.current = '';
    isProcessing.current = false;
  }, [selectedProject]);
}
