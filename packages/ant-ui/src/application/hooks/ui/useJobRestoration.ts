import { useEffect, useRef } from 'react';
import { useStore } from '@/domain/store';

interface UseJobRestorationOptions {
  connectionStatus: string;
}

/**
 * Restores running job from localStorage after page refresh
 * Only runs after connection is established
 */
export function useJobRestoration({ 
  connectionStatus
}: UseJobRestorationOptions) {
  // ✅ Track if restoration already happened to prevent re-runs
  const restoredRef = useRef(false);

  useEffect(() => {
    // Only restore job after successful connection and if not already restored
    if (connectionStatus !== 'connected' || restoredRef.current) return;

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
        
        // ✅ CRITICAL: Check if user explicitly stopped this job
        const store = useStore.getState();
        if (store.userStoppedJobId === jobId) {
          console.log('[useJobRestoration] 🚫 Skipping restore - user explicitly stopped job:', jobId);
          // Clean up localStorage
          localStorage.removeItem('ant-ui:running-task');
          localStorage.removeItem('ant-ui:task-start-time');
          localStorage.removeItem('ant-ui:task-mode');
          restoredRef.current = true;
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
        
        // 🔥 CRITICAL: Restore Log SSE connection
        // Without this, UI won't receive real-time updates!
        console.log('[useJobRestoration] Reconnecting Log SSE for job:', jobId);
        store.startLogStream(jobId);
        
        // Mark as restored
        restoredRef.current = true;
        
        // Note: Kanban/Workflow SSE will auto-reconnect via their useEffects
        // when selectedProject/selectedFeature are restored
      } else {
        console.log('[useJobRestoration] ℹ️ No running job to restore');
        restoredRef.current = true;
      }
    } catch (error) {
      console.error('[useJobRestoration] ❌ Failed to restore running job:', error);
      restoredRef.current = true;
    }
  }, [connectionStatus]);  // ✅ Only connectionStatus as dependency
}

