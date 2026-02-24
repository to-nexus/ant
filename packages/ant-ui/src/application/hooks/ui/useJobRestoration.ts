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
          
          // Verify job is actually running on server BEFORE restoring.
          // Also checks Redis status to detect jobs interrupted by a server crash
          // (BullMQ may say "unknown" while Redis says "paused").
          try {
            console.log('[useJobRestoration] 🔍 Verifying job status on server before restore...');
            const position = await fetchQueuePosition(jobId);
            console.log('[useJobRestoration] Server response:', position);

            const bullmqActive = position.status === 'running' || position.status === 'queued';
            const crashInterrupted = position.redisStatus === 'paused' || position.redisStatus === 'failed';

            if (!bullmqActive) {
              if (crashInterrupted) {
                // Job was interrupted by a crash — clear running state so the
                // session-based interruption UI (resume button) takes over.
                console.log(`[useJobRestoration] 🔄 Job was interrupted (redis=${position.redisStatus}), clearing running state`);
              } else {
                console.log(`[useJobRestoration] 🚫 Job not active (bullmq=${position.status}, redis=${position.redisStatus ?? 'n/a'}), clearing localStorage`);
              }
              localStorage.removeItem('ant-ui:running-task');
              localStorage.removeItem('ant-ui:task-start-time');
              localStorage.removeItem('ant-ui:task-mode');
              return;
            }
          } catch (error) {
            console.warn('[useJobRestoration] ⚠️ Failed to verify job status, clearing localStorage for safety');
            localStorage.removeItem('ant-ui:running-task');
            localStorage.removeItem('ant-ui:task-start-time');
            localStorage.removeItem('ant-ui:task-mode');
            return;
          }
          
          console.log('[useJobRestoration] ✅ Job verified running, restoring:', { jobId, startTime, mode });
          
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
          
          // Queue position was already fetched during verification above
          // Set it in store (position variable is still in scope from verification)
          // Note: We need to re-fetch since position variable is out of scope
          try {
            const position = await fetchQueuePosition(jobId);
            store.setQueuePosition(position);
            console.log('[useJobRestoration] Queue position set:', position);
          } catch (error) {
            // Non-critical - SSE will update this
            console.warn('[useJobRestoration] Failed to set queue position:', error);
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

