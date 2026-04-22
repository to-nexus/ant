import type { KanbanData } from '@/infrastructure/http/api';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import { removeFromStorage, STORAGE_KEYS } from '../../storage';

/**
 * Core kanban state reducer. Handles field preservation (jobTiming, recursion,
 * tokenUsage), isRunning determination with 4-branch logic (jobStartPending
 * guard, SSE reconnect grace, completion, auto-restore), runningJobsByFeature
 * tracking, and localStorage cleanup.
 */
export function handleKanbanUpdate(data: KanbanData, set: any, get: any): void {
  const state = get();
  console.log(`[Kanban:recv] ds=${data.dataSource} todo=${data.todo?.length ?? '?'} ip=${data.inProgress?.length ?? '?'} done=${data.completed?.length ?? '?'} jobId=${data.jobId ?? 'none'} grace=${state.sseReconnectGrace} existing_ip=${state.kanban?.inProgress?.length ?? 0} isRunning=${state.isRunning}`);

  // Preserve jobTiming from existing state if not in incoming data.
  // KanbanBroadcaster (live Redis Pub/Sub) sends task queue updates without job-level timing,
  // while KanbanService (HTTP/session) provides them. Merge to prevent ElapsedTimeBadge from disappearing.
  const existingKanban = state.kanban;
  if (!data.jobTiming && existingKanban?.jobTiming) {
    data = { ...data, jobTiming: existingKanban.jobTiming };
  }

  // Preserve recursion tracking from existing state if not in incoming data.
  // Workflow SSE (WorkflowBroadcaster) is the source of truth for recursion state via updateKanbanRecursion().
  // KanbanBroadcaster may not include these fields; preserve to prevent gauge from resetting.
  if (data.recursionCount === undefined && existingKanban?.recursionCount !== undefined) {
    data = { ...data, recursionCount: existingKanban.recursionCount };
  }
  if (data.recursionLimit === undefined && existingKanban?.recursionLimit !== undefined) {
    data = { ...data, recursionLimit: existingKanban.recursionLimit };
  }
  if (data.recursionTaskName === undefined && existingKanban?.recursionTaskName !== undefined) {
    data = { ...data, recursionTaskName: existingKanban.recursionTaskName };
  }

  // Preserve tokenUsage from existing state if not in incoming data.
  // KanbanBroadcaster may omit tokenUsage in task queue updates (e.g., checkTaskStatus);
  // preserve to prevent TokenUsageBadge from resetting to 0.
  if (data.tokenUsage === undefined && existingKanban?.tokenUsage !== undefined) {
    data = { ...data, tokenUsage: existingKanban.tokenUsage };
  }
  if (data.estimatingTokenUsage === undefined && existingKanban?.estimatingTokenUsage !== undefined) {
    data = { ...data, estimatingTokenUsage: existingKanban.estimatingTokenUsage };
  }
  if (data.phaseTokenUsages === undefined && existingKanban?.phaseTokenUsages !== undefined) {
    data = { ...data, phaseTokenUsages: existingKanban.phaseTokenUsages };
  }
  // Preserve currentPhaseTokenUsages when incoming update omits it, so the
  // chat input context gauge retains the last known value during idle periods
  // (between turns, when the kanban broadcaster has no LLM call to snapshot).
  if (data.currentPhaseTokenUsages === undefined && existingKanban?.currentPhaseTokenUsages !== undefined) {
    data = { ...data, currentPhaseTokenUsages: existingKanban.currentPhaseTokenUsages };
  }

  const kanbanJobId = data.jobId;
  const { selectedProject, selectedFeature } = state;
  const currentFeatureKey = selectedProject && selectedFeature ? `${selectedProject}/${selectedFeature}` : null;

  const isJobRunning = data.dataSource === 'live' || data.dataSource === 'estimating';

  // Cloud multi-pod: Clear jobStartPending when actual job starts running
  if (isJobRunning && state.jobStartPending) {
    console.log('[Store] ✅ Job actually started on worker, clearing jobStartPending');
    set({ jobStartPending: false });
  }

  // Cloud multi-pod: SSE reconnect grace — protect kanban from stale initial data.
  // Live data (dataSource='live') is always fresh from Redis and safe to apply.
  // Estimating/session data may contain stale sessionTaskQueue, so block them
  // unless the existing kanban is completely empty (page-refresh scenario).
  if (isJobRunning && state.sseReconnectGrace) {
    if (data.dataSource === 'live') {
      // Live data is the most recent state from the worker — always accept it.
      set({ sseReconnectGrace: false });
      console.log(`[Store] SSE reconnect grace: accepting live data (ip=${data.inProgress?.length ?? 0})`);
      // Fall through to normal processing below.
    } else {
      const existingHasData = (state.kanban?.inProgress?.length ?? 0) > 0 ||
                              (state.kanban?.todo?.length ?? 0) > 0 ||
                              (state.kanban?.completed?.length ?? 0) > 0;
      if (existingHasData) {
        // Tab switch / screen lock: existing kanban has correct state — preserve it.
        console.log(
          `[Store] SSE reconnect grace: keeping existing kanban over ${data.dataSource} ` +
          `(existing_ip=${state.kanban.inProgress?.length ?? 0}, ` +
          `incoming_ip=${data.inProgress?.length ?? 0})`
        );
        set({ sseReconnectGrace: false });
        return;
      }
      // Page refresh: existing kanban is empty, estimating/session data is better than nothing.
      console.log(
        `[Store] SSE reconnect grace: accepting ${data.dataSource} (empty existing kanban)`
      );
      set({ sseReconnectGrace: false });
      // Fall through to normal processing below.
    }
  }

  // Clear queue position when job actually starts running (has inProgress tasks)
  if (isJobRunning && data.inProgress?.length > 0 && state.isQueued) {
    console.log('[Store] 🚀 Job started running, clearing queue position');
    set({ isQueued: false, queuePosition: null });
  }

  const updatedRunningJobs = { ...state.runningJobsByFeature };

  if (currentFeatureKey) {
    if (isJobRunning && kanbanJobId) {
      updatedRunningJobs[currentFeatureKey] = kanbanJobId;
      console.log(`[Store] 📌 Registered running job for ${currentFeatureKey}: ${kanbanJobId}`);
    } else if (!isJobRunning) {
      if (updatedRunningJobs[currentFeatureKey]) {
        console.log(`[Store] 📌 Unregistered job for ${currentFeatureKey}`);
        delete updatedRunningJobs[currentFeatureKey];
      }
    }
  }

  const currentFeatureIsRunning = currentFeatureKey ? !!updatedRunningJobs[currentFeatureKey] : false;

  // Cloud multi-pod: Protect isRunning when jobStartPending is true
  // Prevents SSE from overwriting isRunning=true before actual job starts on worker pod
  const shouldProtectRunningState = state.jobStartPending && state.isRunning && !isJobRunning;

  if (shouldProtectRunningState) {
    console.log(`[Store] 🛡️ Protecting isRunning state - job start pending, waiting for worker pod (ds=${data.dataSource})`);
    set({
      kanban: data,
      runningJobsByFeature: updatedRunningJobs
    });
    return;
  }

  if (!isJobRunning && state.isRunning && currentFeatureKey) {
    // Cloud multi-pod: SSE reconnect grace — stale session data must not reset isRunning.
    if (state.sseReconnectGrace && data.dataSource === 'session') {
      const existingHasData = (state.kanban?.inProgress?.length ?? 0) > 0 ||
                              (state.kanban?.todo?.length ?? 0) > 0 ||
                              (state.kanban?.completed?.length ?? 0) > 0;
      if (existingHasData) {
        // Tab switch: preserve existing kanban entirely (don't overwrite with session data)
        console.log(`[Store] SSE reconnect grace: keeping existing kanban over session data (existing_ip=${state.kanban.inProgress?.length ?? 0})`);
        set({ runningJobsByFeature: updatedRunningJobs, sseReconnectGrace: false });
        return;
      }
      // Page refresh: existing kanban is empty — apply session data but protect isRunning
      console.log(`[Store] SSE reconnect grace: accepting session data (empty existing kanban, protecting isRunning)`);
      set({ kanban: data, runningJobsByFeature: updatedRunningJobs, sseReconnectGrace: false });
      return;
    }

    const interruptionWasDismissed =
      data.interruption?.timestamp &&
      data.interruption.timestamp === state.dismissedInterruptTimestamp;

    if (interruptionWasDismissed) {
      console.log('[Store] ⏸️ Ignoring session data - interruption was dismissed (Resume in progress)');
      set({ kanban: data, runningJobsByFeature: updatedRunningJobs });
      return;
    }

    set({
      kanban: { ...data, isEstimating: false, estimatingLabel: undefined, estimatingStartedAt: undefined, estimatingNodeId: undefined },
      runningJobsByFeature: updatedRunningJobs,
      currentJobId: kanbanJobId,
      isRunning: false,
      currentMode: undefined,
      jobStartPending: false
    });

    removeFromStorage(STORAGE_KEYS.RUNNING_TASK);
    removeFromStorage(STORAGE_KEYS.TASK_START_TIME);
    removeFromStorage(STORAGE_KEYS.TASK_MODE);
    console.log('[Store] 🧹 Cleared localStorage for completed job');

    get().refreshFileTree();
  }
  else if (isJobRunning && !state.isRunning && currentFeatureKey) {
    if (state.userStoppedJobId === kanbanJobId) {
      console.log('[Store] 🚫 Skipping auto-restore - user explicitly stopped job:', kanbanJobId);
      set({
        kanban: data,
        runningJobsByFeature: updatedRunningJobs,
        currentJobId: kanbanJobId
      });
      return;
    }

    console.log(`[Store] 🔄 Active job detected for ${currentFeatureKey}: ${kanbanJobId}`);
    set({
      kanban: data,
      runningJobsByFeature: updatedRunningJobs,
      currentJobId: kanbanJobId,
      isRunning: true,
      jobStartPending: false
    });
    if (kanbanJobId) {
      sseManager.connectWorkflow(kanbanJobId);
    }
  }
  else {
    console.log(`[Store] Kanban else branch: ds=${data.dataSource} isRunning=${state.isRunning} featureRunning=${currentFeatureIsRunning} ip=${data.inProgress?.length ?? 0}`);
    const newState: any = {
      kanban: data,
      runningJobsByFeature: updatedRunningJobs,
      isRunning: currentFeatureIsRunning,
      ...(isJobRunning ? { jobStartPending: false } : {})
    };

    if (kanbanJobId && state.isJobTabCleared) {
      newState.isJobTabCleared = false;
    }

    if (kanbanJobId !== state.currentJobId) {
      if (state.currentJobId === undefined && !kanbanJobId) {
        // Skip update
      } else {
        console.log('[Store] 🔄 Job ID changed via Kanban update');
        newState.currentJobId = kanbanJobId;
      }
    }

    set(newState);

    // Ensure workflow SSE is connected when job is running.
    if (isJobRunning && kanbanJobId && !sseManager.isWorkflowConnected(kanbanJobId)) {
      console.log(`[Store] 🔗 Connecting workflow SSE in else branch for ${kanbanJobId}`);
      sseManager.connectWorkflow(kanbanJobId);
    }

    // Clear localStorage when SSE says no job is running
    if (!currentFeatureIsRunning && !state.isRunning) {
      removeFromStorage(STORAGE_KEYS.RUNNING_TASK);
      removeFromStorage(STORAGE_KEYS.TASK_START_TIME);
      removeFromStorage(STORAGE_KEYS.TASK_MODE);
    }
  }
}
