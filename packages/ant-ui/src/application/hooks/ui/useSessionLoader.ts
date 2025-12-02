import { useEffect } from 'react';
import { useStore } from '@/domain/store';

/**
 * Restores user session from storage (project, feature)
 * Only runs after connection is established
 * ✅ Agent and work type are already restored during store initialization
 * ✅ Project/Feature use sessionStorage (tab-specific)
 */
export function useSessionLoader(connectionStatus: string) {
  useEffect(() => {
    // Only restore session after successful connection
    if (connectionStatus !== 'connected') return;

    // Restore selected project and feature
    (async () => {
      try {
        // ✅ Use sessionStorage for tab-specific state
        const savedProject = sessionStorage.getItem('ant-ui:selected-project');
        const savedFeature = sessionStorage.getItem('ant-ui:selected-feature');

        if (savedProject) {
          const projectId = JSON.parse(savedProject);
          
          // Verify project still exists
          const currentProjects = useStore.getState().projects;
          if (currentProjects.includes(projectId)) {
            // console.log('[useSessionLoader] Restoring selected project:', projectId); // ✅ Too verbose
            useStore.getState().setSelectedProject(projectId);
            
            // ✅ Wait for features to load instead of setTimeout
            if (savedFeature) {
              const featureName = JSON.parse(savedFeature);
              
              // Poll for features (max 5 seconds)
              const maxAttempts = 50;
              let attempts = 0;
              
              const checkFeatures = setInterval(() => {
                const currentFeatures = useStore.getState().features;
                
                if (currentFeatures.length > 0 || attempts >= maxAttempts) {
                  clearInterval(checkFeatures);
                  
                  // Verify feature exists
                  if (currentFeatures.some(f => f.name === featureName)) {
                    // console.log('[useSessionLoader] Restoring selected feature:', featureName); // ✅ Too verbose
                    useStore.getState().setSelectedFeature(featureName);
                  } else {
                    console.log('[useSessionLoader] Saved feature no longer exists, clearing');
                    localStorage.removeItem('ant-ui:selected-feature');
                  }
                }
                
                attempts++;
              }, 100);
            }
          } else {
            console.log('[useSessionLoader] Saved project no longer exists, clearing');
            localStorage.removeItem('ant-ui:selected-project');
            localStorage.removeItem('ant-ui:selected-feature');
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

