import { useEffect } from 'react';
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

  useEffect(() => {
    const checkoutBranch = async () => {
      if (!selectedProject) return;
      
      // Wait for Git status check to complete
      if (gitStatus === null) {
        console.log('[useFeatureBranchManager] Waiting for Git status check...');
        return;
      }
      
      // Only proceed if Git is initialized
      if (!gitStatus.hasGit) {
        console.log('[useFeatureBranchManager] ⏭️  Skipping branch operations - Git not initialized');
        return;
      }
      
      // Start Git status loading
      setGitStatusLoading(true);
      
      try {
        if (selectedFeature) {
          // Phase 1: Switch to feature branch
          setGitStatusPhase('switching');
          console.log(`[useFeatureBranchManager] Switching to branch for feature: ${selectedFeature}`);
          const result = await switchToFeatureBranch(selectedProject, selectedFeature);
          
          if (result.success) {
            console.log(`[useFeatureBranchManager] ✅ Branch switched for ${selectedFeature}`);
            if (result.branchName) {
              setCurrentGitBranch(result.branchName);
            }
            
            // Phase 2: Fetch from remote
            setGitStatusPhase('fetching');
            console.log(`[useFeatureBranchManager] 🔄 Auto-fetching for ${selectedFeature}...`);
            try {
              const fetchResult = await fetchFromGitHub(selectedProject);
              if (fetchResult.success) {
                console.log(`[useFeatureBranchManager] ✅ Fetch completed for ${selectedFeature}`);
              } else {
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
          console.log(`[useFeatureBranchManager] Switching to base branch (${baseBranch}) - no feature selected`);
          const result = await switchToFeatureBranch(selectedProject, baseBranch);
          
          if (result.success) {
            console.log(`[useFeatureBranchManager] ✅ Switched to base branch (${baseBranch})`);
            if (result.branchName) {
              setCurrentGitBranch(result.branchName);
            }
            
            // Phase 2: Fetch from remote
            setGitStatusPhase('fetching');
            console.log(`[useFeatureBranchManager] 🔄 Auto-fetching for ${baseBranch}...`);
            try {
              const fetchResult = await fetchFromGitHub(selectedProject);
              if (fetchResult.success) {
                console.log(`[useFeatureBranchManager] ✅ Fetch completed for ${baseBranch}`);
              } else {
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
      }
    };
    
    checkoutBranch();
  }, [selectedProject, selectedFeature, baseBranch, gitStatus, setGitStatusLoading, setGitStatusPhase, setCurrentGitBranch]);
}
