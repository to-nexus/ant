/**
 * useJobExecution - Job execution logic (Run/Stop/Resume)
 * 
 * Centralized business logic for:
 * - Starting new jobs
 * - Resuming interrupted jobs
 * - Stopping running jobs
 * 
 * Terminology:
 * - Job: Design job, Code job, Learn job (작업 유형)
 * - Task: Kanban board의 개별 작업 항목 (Job 내부의 세부 작업)
 */

import { useCallback } from 'react';
import { useStore } from '@/domain/store';
import { resumeJob, stopJob as stopJobAPI, fetchFeatureSession, getApiBase } from '@/infrastructure/http/api';
import { executeCodeJob } from '@/infrastructure/http/cli';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';

export function useJobExecution() {
  const { showError } = useAlertModalContext();
  const setRunning = useStore((state) => state.setRunning);
  const setStopping = useStore((state) => state.setStopping);
  const setCurrentJob = useStore((state) => state.setCurrentJob);
  const setSession = useStore((state) => state.setSession);
  const refreshFileTree = useStore((state) => state.refreshFileTree);
  
  /**
   * Run Job - Start new job or resume interrupted job
   * @param agent - Agent type (e.g., 'architect')
   * @param jobType - Job type: 'design' | 'code' | 'learn'
   */
  const runJob = useCallback(async (agent: string, jobType: string) => {
    const state = useStore.getState();
    const { 
      isRunning, 
      selectedProject, 
      selectedFeature, 
      kanban: kanbanData 
    } = state;
    
    if (isRunning || !selectedProject) {
      return;
    }

    // ✅ CRITICAL: Check if this is a Resume or New task
    const currentJobId = kanbanData?.jobId;
    const hasInterruption = kanbanData?.interruption?.canResume === true;
    
    // ✅ Resume existing job (jobId exists + interruption)
    if (currentJobId && hasInterruption) {
      try {
        // ✅ CRITICAL: Dismiss interruption FIRST before setting running state
        // This prevents SSE initial state from auto-stopping the job
        if (kanbanData?.interruption?.timestamp) {
          useStore.getState().setDismissedInterruptTimestamp(kanbanData.interruption.timestamp);
        }
        
        // ✅ Remove cancelled message from chat and add resume message
        useStore.getState().removeCancelledMessage(currentJobId);
        useStore.getState().addChatMessage({
          id: `msg-resume-${Date.now()}`,
          role: 'assistant',
          contents: [{
            type: 'text',
            content: '🔄 Continuing interrupted job...'
          }],
          timestamp: new Date().toISOString()
        });
        
        // ✅ Set running state immediately
        setRunning(true, currentJobId);
        
        const result = await resumeJob(currentJobId, selectedProject, selectedFeature!, true);
        
        // ✅ Update with new jobId from server
        setRunning(true, result.jobId);
      } catch (error) {
        console.error('[useJobExecution] Failed to resume job:', error);
        console.error('[useJobExecution] Error details:', error);
        setRunning(false);
        showError(`Resume 실패: ${error instanceof Error ? error.message : 'Unknown error'}`, { title: '오류' });
      }
      return;
    }

    // ✅ Start new job
    setRunning(true, undefined, 'generate'); // Default mode
    
    try {
      const jobExecution = executeCodeJob({
        projectId: selectedProject,
        featureName: selectedFeature!,
        jobType: jobType as 'design' | 'code' | 'learn',
        agent: agent as 'architect',
        chatSource: true  // ✅ Enable Chat SSE for all jobs
      });
      
      // Store job execution object for stop functionality
      setCurrentJob(jobExecution);
      
      // Set jobId when it becomes available
      jobExecution.onJobIdReady(async (jobId) => {
        console.log('[useJobExecution] Job started with ID:', jobId);
        setRunning(true, jobId);
      });
      
      // Handle job completion
      jobExecution.on('exit', async (code) => {
        console.log('[useJobExecution] Job finished:', { code });
        
        const jobFailed = code !== 0 && code !== null;
        
        // ✅ Update failed state FIRST, then running state
        useStore.getState().setLastJobFailed(jobFailed);
        setRunning(false);
        setCurrentJob(null);
        
        // Reload session after job completes
        if (selectedProject && selectedFeature) {
          try {
            const session = await fetchFeatureSession(selectedProject, selectedFeature);
            setSession(session ?? undefined);
          } catch (error) {
            console.error('[useJobExecution] Failed to reload session after job completion:', error);
          }
        }
        
        // Refresh file tree to show new/modified files
        refreshFileTree();
        
        // ✅ Refresh Git status to show uncommitted changes (non-blocking)
        // Trigger Git status refresh after job completion
        console.log('[useJobExecution] Triggering Git status refresh after job completion');
        const store = useStore.getState();
        store.setGitStatusPhase('fetching');  // Trigger refresh
        // Clear after completion
        setTimeout(() => store.setGitStatusPhase(null), 100);
      });
      
      console.log('[useJobExecution] Job execution started successfully');
    } catch (error) {
      console.error('[useJobExecution] Failed to start job:', error);
      setRunning(false);
      setCurrentJob(null);
    }
  }, [setRunning, setStopping, setCurrentJob, setSession, refreshFileTree]);

  /**
   * Stop Job - Stop running job
   */
  const stopJob = useCallback(async () => {
    const state = useStore.getState();
    const { 
      currentJob, 
      currentJobId, 
      selectedProject, 
      selectedFeature,
      selectedJobType 
    } = state;
    
    console.log('[useJobExecution] Stopping job...', { 
      hasCurrentTask: !!currentJob, 
      currentJobId,
      isRunning: state.isRunning,
      selectedProject, 
      selectedFeature 
    });
    
    // ✅ Set "Stopping..." state immediately
    console.log('[useJobExecution] 🛑 Setting stopping state...');
    setStopping(true);
    
    // ✅ CRITICAL: Mark this job as explicitly stopped by user and clear localStorage
    if (currentJobId) {
      console.log(`[useJobExecution] 🚫 Marking job ${currentJobId} as user-stopped`);
      useStore.setState({ userStoppedJobId: currentJobId });
      
      // ✅ Immediately clear localStorage to prevent auto-restore
      localStorage.removeItem('ant-ui:running-task');
      localStorage.removeItem('ant-ui:task-start-time');
      localStorage.removeItem('ant-ui:task-mode');
    }
    
    // ✅ Send stop request to server and wait for confirmation
    try {
      if (!currentJobId) {
        console.warn('[useJobExecution] ⚠️ No currentJobId to stop');
        return;
      }
      
      // ✅ Send stop request to server
      const jobType = selectedJobType;
      console.log(`[useJobExecution] Sending stop request to server... jobType: ${jobType}`);
      await stopJobAPI(currentJobId, selectedProject, selectedFeature, jobType);
      console.log('[useJobExecution] ✅ Server confirmed stop');
      
      // ✅ Now update UI after server confirmation
      console.log('[useJobExecution] 🎯 Server confirmed, updating UI...');
      setRunning(false);
      setCurrentJob(null);
      
      // ✅ Finalize chat message if exists (mark as complete)
      if (selectedProject && selectedFeature) {
        try {
          console.log('[useJobExecution] Finalizing chat message...');
          await fetch(
            `${getApiBase()}/projects/${selectedProject}/features/${selectedFeature}/chat/finalize-message`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            }
          );
          console.log('[useJobExecution] Chat message finalized');
        } catch (error) {
          console.error('[useJobExecution] Failed to finalize chat message:', error);
        }
      }
      
      // Reload session after server confirms stop
      if (selectedProject && selectedFeature) {
        console.log('[useJobExecution] Reloading session after stop...');
        try {
          const session = await fetchFeatureSession(selectedProject, selectedFeature);
          setSession(session ?? undefined);
          console.log('[useJobExecution] Session reloaded');
        } catch (error) {
          console.error('[useJobExecution] Failed to reload session:', error);
        }
      }
    } catch (error) {
      console.error('[useJobExecution] Failed to stop job on server:', error);
      // Still update UI even if server fails
      setRunning(false);
      setCurrentJob(null);
    } finally {
      // ✅ Clear stopping state after everything completes
      console.log('[useJobExecution] 🔓 Clearing stopping state...');
      setStopping(false);
    }
  }, [setRunning, setStopping, setCurrentJob, setSession, refreshFileTree]);

  return {
    runJob,
    stopJob
  };
}

