import { useState, useEffect } from 'react';
import { getGitStatus } from '@/infrastructure/http/api';

interface GitStatus {
  hasGit: boolean;
  hasCodebase: boolean;
  hasFeatures: boolean;
}

export function useGitStatus(selectedProject: string | undefined) {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);

  useEffect(() => {
    const checkGitStatus = async () => {
      if (!selectedProject) {
        setGitStatus({ hasGit: false, hasCodebase: false, hasFeatures: false });
        return;
      }
      
      try {
        const status = await getGitStatus(selectedProject);
        setGitStatus(status);
        console.log('[useGitStatus] Git status loaded:', status);
      } catch (error) {
        console.error('[useGitStatus] Failed to get Git status:', error);
        setGitStatus({ hasGit: false, hasCodebase: false, hasFeatures: false });
      }
    };
    
    checkGitStatus();
  }, [selectedProject]);

  return gitStatus;
}
