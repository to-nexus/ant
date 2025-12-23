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
          if (!currentProjects.includes(projectId)) {
            console.log('[useSessionLoader] Saved project no longer exists, clearing');
            sessionStorage.removeItem('ant-ui:selected-project');
            sessionStorage.removeItem('ant-ui:selected-feature');
            return;
          }
          
          console.log('[useSessionLoader] Restoring project:', projectId);
          
          // ✅ Step 1: Set project (will trigger fetchFeatures)
          useStore.getState().setSelectedProject(projectId);
          
          // ✅ Step 2: Wait for features to load, then set feature
          if (savedFeature) {
            const featureName = JSON.parse(savedFeature);
            console.log('[useSessionLoader] Waiting for features to restore:', featureName);
            
            // Poll for features (max 5 seconds)
            const maxAttempts = 50;
            let attempts = 0;
            
            const checkFeatures = setInterval(() => {
              const currentFeatures = useStore.getState().features;
              
              if (currentFeatures.length > 0 || attempts >= maxAttempts) {
                clearInterval(checkFeatures);
                
                if (currentFeatures.some(f => f.name === featureName)) {
                  console.log('[useSessionLoader] ✅ Restoring feature:', featureName);
                  useStore.getState().setSelectedFeature(featureName);
                } else if (currentFeatures.length > 0) {
                  console.log('[useSessionLoader] ⚠️ Feature not found, trying localStorage');
                  
                  // Fallback: Try localStorage last feature
                  const lastFeatures = JSON.parse(localStorage.getItem('ant-ui:project-last-features') || '{}');
                  const lastFeature = lastFeatures[projectId];
                  
                  if (lastFeature && currentFeatures.some(f => f.name === lastFeature)) {
                    console.log('[useSessionLoader] ✅ Restoring last feature:', lastFeature);
                    useStore.getState().setSelectedFeature(lastFeature);
                  }
                }
              }
              
              attempts++;
            }, 100);
          } else {
            // No sessionStorage feature - try localStorage
            console.log('[useSessionLoader] No session feature, checking localStorage');
            
            setTimeout(() => {
              const lastFeatures = JSON.parse(localStorage.getItem('ant-ui:project-last-features') || '{}');
              const lastFeature = lastFeatures[projectId];
              
              if (lastFeature) {
                const currentFeatures = useStore.getState().features;
                if (currentFeatures.some(f => f.name === lastFeature)) {
                  console.log('[useSessionLoader] ✅ Restoring last feature from localStorage:', lastFeature);
                  useStore.getState().setSelectedFeature(lastFeature);
                }
              }
            }, 500);
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

