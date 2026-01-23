import { useEffect, useRef } from 'react';
import { useStore } from '@/domain/store';
import { fetchQueuePosition } from '@/infrastructure/http/api';

interface UseJobRestorationOptions {
  connectionStatus: string;
  selectedProject: string | null;
  selectedFeature: string | null;
}

/**
 * Restores running job from localStorage after page refresh
 * Only runs after connection is established AND project/feature are selected
 */
export function useJobRestoration({ 
  connectionStatus,
  selectedProject,
  selectedFeature
}: UseJobRestorationOptions) {
  // ✅ Track if restoration already happened to prevent re-runs
  const restoredRef = useRef(false);

  useEffect(() => {
    // ✅ CRITICAL: Only restore once, regardless of dependency changes
    if (restoredRef.current) return;
    
    // Wait for connection
    if (connectionStatus !== 'connected') return;
    
    // ✅ Wait for project/feature (job belongs to feature)
    if (!selectedProject || !selectedFeature) {
      console.log('[useJobRestoration] ⏸️ Waiting for project/feature selection before restoring job');
      return;
    }
    
    // ✅ Mark as attempted to prevent re-runs when dependencies change
    restoredRef.current = true;

    const restore = async () => {
      try {
        console.log('[useJobRestoration] Checking localStorage for running job...');
        const savedTaskId = localStorage.getItem('ant-ui:running-task');
        const savedStartTime = localStorage.getItem('ant-ui:task-start-time');
        const savedMode = localStorage.getItem('ant-ui:task-mode');
        
        console.log('[useJobRestoration] localStorage values:', { savedTaskId, savedStartTime, savedMode });

        if (savedTaskId && savedStartTime) {
          const jobId = JSON.parse(savedTaskId);
          const startTime = JSON.parse(savedStartTime);
          const mode = savedMode ? JSON.parse(savedMode) : 'generate';
          
          // ✅ Check if user explicitly stopped this job (memory only - localStorage cleared on stop)
          const store = useStore.getState();
          if (store.userStoppedJobId === jobId) {
            console.log('[useJobRestoration] 🚫 Skipping restore - user explicitly stopped job:', jobId);
            return;
          }
          
          console.log('[useJobRestoration] ✅ Restoring running job:', { jobId, startTime, mode });
          
          // Calculate elapsed time
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          console.log('[useJobRestoration] Elapsed time:', elapsed, 'seconds');
          
          // Restore state using getState() to avoid dependency issues
          console.log('[useJobRestoration] Calling setRunning(true, jobId, mode)...');
          store.setRunning(true, jobId, mode as 'generate' | 'refactor' | 'explain');
          useStore.setState({ 
            taskStartTime: startTime,
            elapsedTime: elapsed 
          });
          
          console.log('[useJobRestoration] Store state after restoration:', {
            isRunning: store.isRunning,
            currentJobId: store.currentJobId
          });
          
          // Fetch queue position for restored job
          try {
            const position = await fetchQueuePosition(jobId);
            store.setQueuePosition(position);
            console.log('[useJobRestoration] Queue position restored:', position);
          } catch (error) {
            console.error('[useJobRestoration] Failed to fetch queue position:', error);
          }
          
          // Note: Kanban/Workflow/Chat SSE will auto-reconnect via unified SSE
          // when selectedProject/selectedFeature are restored
        } else {
          console.log('[useJobRestoration] ℹ️ No running job to restore');
        }
      } catch (error) {
        console.error('[useJobRestoration] ❌ Failed to restore running job:', error);
      }
    };

    restore();
  }, [connectionStatus, selectedProject, selectedFeature]);  // ✅ Wait for project/feature selection
}

