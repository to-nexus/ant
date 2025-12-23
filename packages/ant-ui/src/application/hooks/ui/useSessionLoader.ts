import { useEffect, useRef } from 'react';
import { useStore } from '@/domain/store';

/**
 * Restores user session from storage (project, feature)
 * Only runs ONCE after connection is established
 * ✅ Agent and work type are already restored during store initialization
 * ✅ Project/Feature use sessionStorage (tab-specific)
 */
export function useSessionLoader(connectionStatus: string) {
  const hasRestoredRef = useRef(false);
  
  useEffect(() => {
    // Only restore session after successful connection AND only once
    if (connectionStatus !== 'connected' || hasRestoredRef.current) return;
    
    hasRestoredRef.current = true;
    console.log('[useSessionLoader] 🚀 Starting session restoration (one-time)');

    // Restore selected project and feature
    (async () => {
      try {
        // ✅ Use sessionStorage for tab-specific state
        const savedProject = sessionStorage.getItem('ant-ui:selected-project');

        if (savedProject) {
          const projectId = JSON.parse(savedProject);
          
          // Verify project still exists
          const currentProjects = useStore.getState().projects;
          if (!currentProjects.includes(projectId)) {
            console.log('[useSessionLoader] Saved project no longer exists, clearing');
            sessionStorage.removeItem('ant-ui:selected-project');
            sessionStorage.removeItem('ant-ui:project-last-features');
            return;
          }
          
          console.log('[useSessionLoader] Restoring project:', projectId);
          
          // ✅ Step 1: Set project (will trigger fetchFeatures)
          useStore.getState().setSelectedProject(projectId);
          
          // ✅ Step 2: Check project-last-features mapping
          const projectFeatures = JSON.parse(sessionStorage.getItem('ant-ui:project-last-features') || '{}');
          const lastFeature = projectFeatures[projectId];
          
          if (lastFeature) {
            console.log('[useSessionLoader] Found last feature for project:', lastFeature);
            
            // Poll for features (max 5 seconds)
            const maxAttempts = 50;
            let attempts = 0;
            
            const checkFeatures = setInterval(() => {
              const currentFeatures = useStore.getState().features;
              
              if (currentFeatures.length > 0 || attempts >= maxAttempts) {
                clearInterval(checkFeatures);
                
                if (currentFeatures.some(f => f.name === lastFeature)) {
                  console.log('[useSessionLoader] ✅ Restoring feature:', lastFeature);
                  useStore.getState().setSelectedFeature(lastFeature);
                } else {
                  console.log('[useSessionLoader] ⚠️ Feature not found, setting to undefined');
                  useStore.getState().setSelectedFeature(undefined);
                }
              }
              
              attempts++;
            }, 100);
          } else {
            // ✅ No last feature → set to undefined (don't sync with Git)
            // Git branch sync is handled by useFeatureBranchManager
            console.log('[useSessionLoader] No last feature for project, setting to undefined');
            useStore.getState().setSelectedFeature(undefined);
          }
        }
      } catch (error) {
        console.error('[useSessionLoader] Failed to restore selected project/feature:', error);
      }
      
      // ✅ Verify agent and work type were restored correctly
      const currentAgent = useStore.getState().selectedAgent;
      const currentJobType = useStore.getState().selectedJobType;
      console.log('[useSessionLoader] Current agent:', currentAgent);
      console.log('[useSessionLoader] Current job type:', currentJobType);
    })();
  }, [connectionStatus]);
}

