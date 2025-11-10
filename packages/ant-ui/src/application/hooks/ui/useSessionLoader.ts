import { useEffect } from 'react';
import { useStore } from '@/domain/store';

/**
 * Restores user session from localStorage (project, feature, agent, work type)
 * Only runs after connection is established
 */
export function useSessionLoader(connectionStatus: string) {
  useEffect(() => {
    // Only restore session after successful connection
    if (connectionStatus !== 'connected') return;

    // Restore selected project and feature
    try {
      const savedProject = localStorage.getItem('ant-ui:selected-project');
      const savedFeature = localStorage.getItem('ant-ui:selected-feature');

      if (savedProject) {
        const projectId = JSON.parse(savedProject);
        
        // Verify project still exists
        const currentProjects = useStore.getState().projects;
        if (currentProjects.includes(projectId)) {
          console.log('[useSessionLoader] Restoring selected project:', projectId);
          useStore.getState().setSelectedProject(projectId);
          
          // Restore feature after a short delay (wait for features to load)
          if (savedFeature) {
            setTimeout(() => {
              const featureName = JSON.parse(savedFeature);
              const currentFeatures = useStore.getState().features;
              
              // Verify feature still exists
              if (currentFeatures.some(f => f.name === featureName)) {
                console.log('[useSessionLoader] Restoring selected feature:', featureName);
                useStore.getState().setSelectedFeature(featureName);
              } else {
                console.log('[useSessionLoader] Saved feature no longer exists, clearing');
                localStorage.removeItem('ant-ui:selected-feature');
              }
            }, 500);
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

    // Restore selected agent and work type
    try {
      console.log('[useSessionLoader] Restoring agent and work type...');
      const savedAgent = localStorage.getItem('ant-ui:selected-agent');
      const savedWorkType = localStorage.getItem('ant-ui:selected-work-type');
      
      if (savedAgent) {
        const agent = JSON.parse(savedAgent);
        console.log('[useSessionLoader] Restoring selected agent:', agent);
        useStore.getState().setSelectedAgent(agent);
      }
      
      if (savedWorkType) {
        const workType = JSON.parse(savedWorkType);
        console.log('[useSessionLoader] Restoring selected work type:', workType);
        useStore.getState().setSelectedWorkType(workType);
      }
    } catch (error) {
      console.error('[useSessionLoader] Failed to restore agent/work type:', error);
    }
  }, [connectionStatus]);
}

