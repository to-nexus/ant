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
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { selectPausedNonTaskJob } from '@/domain/store/selectors';
import { resumeJob, stopJob as stopJobAPI, fetchFeatureSession, fetchQueuePosition, dismissInterruptedJob } from '@/infrastructure/http/api';
import { executeCodeJob } from '@/infrastructure/http/cli';
import { ApiError } from '@/infrastructure/http/api/client';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';

/** True when an error is a 402 credit block from a job start/resume. */
function isCreditBlock(error: unknown): boolean {
  return error instanceof ApiError && error.status === 402 && error.code === 'insufficient_credits';
}

export function useJobExecution() {
  const { showError } = useAlertModalContext();
  const { t } = useTranslation('chat');
  const setRunning = useStore((state) => state.setRunning);
  const setStopping = useStore((state) => state.setStopping);
  const setCurrentJob = useStore((state) => state.setCurrentJob);
  const setSession = useStore((state) => state.setSession);
  const refreshFileTree = useStore((state) => state.refreshFileTree);
  const setQueuePosition = useStore((state) => state.setQueuePosition);
  
  /**
   * Run Job - Start new job or resume interrupted job
   * @param agent - Agent type (e.g., 'architect')
   * @param jobType - Job type: 'design' | 'code' | 'learn' | 'plan'
   * @param directive - Optional override directive (for redirect from triage)
   * @param options - Optional job options:
   *   - skipTriage: bypass the triage LLM after a proceed/redirect choice
   *   - actionMetadata: explicit ActionMetadata (intent / refs / context /
   *     domain / explicit flag). Forwarded to `executeCodeJob` so the
   *     code/design job can run through the explicit pipeline instead of
   *     re-inferring slots from the directive string. Used by choice
   *     cards that already know the intent (e.g. spec_complete →
   *     gen-code-spec).
   */
  const runJob = useCallback(async (
    agent: string,
    jobType: string,
    directive?: string,
    options?: { skipTriage?: boolean; actionMetadata?: import('@ant/shared').ActionMetadata },
  ) => {
    const state = useStore.getState();
    const { 
      isRunning, 
      selectedProject, 
      selectedFeature, 
      kanban: kanbanData 
    } = state;
    
    // ✅ Allow redirect to bypass isRunning check (previous job completed but state not yet updated)
    // When directive is provided, it's a redirect from triage - force start new job
    const isRedirect = !!directive;
    
    if (!selectedProject) {
      console.log('[useJobExecution] ❌ No project selected');
      return;
    }
    
    if (isRunning && !isRedirect) {
      console.log('[useJobExecution] ❌ Job already running (isRunning=true, isRedirect=false)');
      return;
    }
    
    // ✅ If redirect, clear running state first
    if (isRedirect && isRunning) {
      console.log('[useJobExecution] 🔄 Redirect: clearing previous running state');
      setRunning(false);
    }

    // ✅ CRITICAL: Check if this is a Resume or New task
    const currentJobId = kanbanData?.jobId;
    const dismissedTimestamp = useStore.getState().dismissedInterruptTimestamp;
    const interruptionWasDismissed = kanbanData?.interruption?.timestamp === dismissedTimestamp;
    const hasInterruption = kanbanData?.interruption?.canResume === true && !interruptionWasDismissed;
    
    // ✅ Redirect bypasses resume: dismiss interrupted job and start fresh
    if (isRedirect && currentJobId && hasInterruption) {
      console.log(`[useJobExecution] 🔄 Redirect: auto-dismissing interrupted job ${currentJobId} to start new ${jobType} job`);
      if (kanbanData?.interruption?.timestamp) {
        useStore.getState().setDismissedInterruptTimestamp(kanbanData.interruption.timestamp);
      }
      try {
        await dismissInterruptedJob(selectedProject, selectedFeature!, currentJobId);
      } catch (err) {
        console.warn('[useJobExecution] Failed to dismiss interrupted job (proceeding anyway):', err);
      }
      // Fall through to "Start new job" below
    }
    // ✅ Resume existing job (jobId exists + interruption that wasn't dismissed + not a redirect)
    else if (currentJobId && hasInterruption) {
      try {
        // ✅ CRITICAL: Dismiss interruption FIRST before setting running state
        // This prevents SSE initial state from auto-stopping the job
        if (kanbanData?.interruption?.timestamp) {
          useStore.getState().setDismissedInterruptTimestamp(kanbanData.interruption.timestamp);
        }

        // Phase 10 chat-SSOT — the cancelled card's "Resumed" badge
        // arrives as a `choice_resolved` SSE line emitted by the BE
        // `/jobs/:id/resume` route (chatService.resolveAllCancelledForJob).
        // The FE projector folds it into the card automatically — no
        // direct chat-message mutation needed here.

        // ✅ Set running state immediately
        setRunning(true, currentJobId);

        const result = await resumeJob(currentJobId, selectedProject, selectedFeature!, true);
        
        // ✅ Restore correct jobType from server (interrupted job may differ from current UI mode)
        // Invariant I4 — but a clarify-paused non-task job (plan / visual)
        // takes priority. Without this guard, resuming an unrelated code
        // job would silently flip selectedJobType away from the paused
        // plan, hijacking the next clarify answer (zonal-dreaming-novel).
        const pausedNonTask = selectPausedNonTaskJob(useStore.getState());
        if (pausedNonTask && pausedNonTask.jobType !== result.jobType) {
          console.log(
            `[useJobExecution] 🛡️ Skipping setSelectedJobType('${result.jobType}') — paused ${pausedNonTask.jobType} job ${pausedNonTask.jobId} is the active conversation`,
          );
        } else if (result.jobType && result.jobType !== useStore.getState().selectedJobType) {
          useStore.setState({ jobStartPending: true });
          useStore.getState().setSelectedJobType(result.jobType);
        }
        
        // ✅ Update with new jobId from server
        setRunning(true, result.jobId);
      } catch (error) {
        console.error('[useJobExecution] Failed to resume job:', error);
        console.error('[useJobExecution] Error details:', error);
        setRunning(false);
        if (isCreditBlock(error)) {
          useStore.getState().setCreditBlockActive(true);
        } else {
          showError(t('card.resumeFailed', { message: error instanceof Error ? error.message : t('common:error.unknown') }));
        }
      }
      return;
    }

    // ✅ Start new job
    setRunning(true, undefined, 'generate'); // Default mode
    useStore.getState().setCreditBlockActive(false); // clear any prior block

    try {
      const jobExecution = executeCodeJob({
        projectId: selectedProject,
        featureName: selectedFeature!,
        jobType: jobType,
        agent: agent,
        chatSource: true,  // ✅ Enable Chat SSE for all jobs
        overrideDirective: directive,  // ✅ Pass directive for redirect
        skipTriage: options?.skipTriage,  // ✅ Skip triage after proceed choice
        actionMetadata: options?.actionMetadata,  // ✅ Explicit pipeline metadata (e.g. from spec_complete card)
      });
      
      // Store job execution object for stop functionality
      setCurrentJob(jobExecution);
      
      // Set jobId when it becomes available
      jobExecution.onJobIdReady(async (jobId) => {
        console.log('[useJobExecution] Job started with ID:', jobId);
        setRunning(true, jobId);
        
        // Fetch queue position once (SSE will clear it when job starts running)
        try {
          const position = await fetchQueuePosition(jobId);
          setQueuePosition(position);
          console.log('[useJobExecution] Queue position:', position);
        } catch (error) {
          console.error('[useJobExecution] Error fetching queue position:', error);
        }
      });
      
      // Handle job completion
      jobExecution.on('exit', async (code) => {
        console.log('[useJobExecution] Job finished:', { code });
        
        // Clear queue position
        setQueuePosition(null);
        
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
        
        // Git state refresh: SSE `gitState` events carry most mid-job updates,
        // but an explicit authoritative fetch on completion guarantees the
        // final snapshot (hasGit flip after init, ahead/behind counts, etc.)
        // is present in the UI.
        {
          const { selectedProject: pid, selectedFeature: ft, fetchGitWorldState } = useStore.getState() as any;
          if (pid && typeof fetchGitWorldState === 'function') {
            void fetchGitWorldState(pid, { feature: ft || undefined });
          }
        }
      });
      
      console.log('[useJobExecution] Job execution started successfully');
    } catch (error) {
      console.error('[useJobExecution] Failed to start job:', error);
      setRunning(false);
      setCurrentJob(null);
      if (isCreditBlock(error)) useStore.getState().setCreditBlockActive(true);
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
      
      // NOTE: Chat message finalization is now handled server-side by JobCleanupManager
      // The removed /chat/finalize-message endpoint was part of the LLMResponseService refactoring
      
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

