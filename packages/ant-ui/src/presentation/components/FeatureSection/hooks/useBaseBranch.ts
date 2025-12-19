import { useState, useEffect } from 'react';
import { fetchProjectConfig } from '@/infrastructure/http/api';

export function useBaseBranch(selectedProject: string | undefined) {
  const [baseBranch, setBaseBranch] = useState<string>('main');

  useEffect(() => {
    const loadBaseBranch = async () => {
      if (!selectedProject) return;
      
      try {
        const config = await fetchProjectConfig(selectedProject);
        setBaseBranch(config?.branchBase || 'main');
      } catch (error) {
        console.warn('[useBaseBranch] Failed to load base branch, using default "main":', error);
        setBaseBranch('main');
      }
    };
    
    loadBaseBranch();
  }, [selectedProject]);

  return baseBranch;
}
