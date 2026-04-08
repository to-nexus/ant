import { StateCreator } from 'zustand';
import { JobState, QueuePosition, InlineAskContext, ActiveJobEntry } from '../types';
import { Session } from '@/domain/models/session';
import { JobExecution } from '@/infrastructure/http/cli';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import { STORAGE_KEYS, saveToStorage, removeFromStorage } from '../storage';

export interface JobActions {
  setSession: (session: Session | undefined) => void;
  setRunning: (isRunning: boolean, jobId?: string, mode?: 'generate' | 'refactor' | 'explain') => void;
  setStopping: (isStopping: boolean) => void;
  setLastJobFailed: (failed: boolean) => void;
  setDismissedInterruptTimestamp: (timestamp: string | null) => void;
  setCurrentJob: (job: JobExecution | null) => void;
  setQueuePosition: (position: QueuePosition | null) => void;
  setInlineAskContext: (context: InlineAskContext | null) => void;
  setActiveJob: (jobType: string, entry: ActiveJobEntry) => void;
  clearActiveJob: (jobType: string) => void;
  syncViewToJobType: (jobType: string) => void;
}

export type JobSlice = JobState & JobActions;

export const createJobSlice: StateCreator<any, [], [], JobSlice> = (set, get) => ({
  // ==================
  // State
  // ==================
  session: undefined,
  isRunning: false,
  isStopping: false,
  isQueued: false,
  queuePosition: null,
  userStoppedJobId: null,
  lastJobFailed: false,
  dismissedInterruptTimestamp: null,
  runningJobsByFeature: {},
  currentJobId: undefined,
  currentJob: null,
  taskStartTime: undefined,
  elapsedTime: 0,
  currentMode: undefined,
  // ✅ Cloud multi-pod: Protects isRunning from SSE overwrite until actual job starts
  jobStartPending: false,
  // ✅ Cloud multi-pod: Protects isRunning from stale initial data after SSE reconnect
  sseReconnectGrace: false,
  // ✅ Inline Ask: Context for handling ask during interrupted jobs
  inlineAskContext: null,
  // N concurrent jobs: per-jobType tracking within current feature
  activeJobs: {},
  // Feature entry vs manual job-type switch: only auto-select on feature entry
  pendingAutoSelect: false,

  // ==================
  // Actions
  // ==================
  setSession: (session) => {
    set({ session });
  },

  setRunning: (isRunning, jobId, mode) => {
    const startTime = isRunning ? Date.now() : undefined;
    const prevJobId = get().currentJobId;
    
    // Disconnect previous workflow SSE if jobId is changing
    if (isRunning && jobId && prevJobId && prevJobId !== jobId) {
      console.log(`[Store] 🔄 JobId changing: ${prevJobId} → ${jobId}, reconnecting SSE...`);
      sseManager.disconnectWorkflow(prevJobId);
    }
    
    // ✅ Cloud multi-pod: Set jobStartPending when starting job (protects from SSE overwrite)
    // jobStartPending is true when local setRunning(true) is called but actual job hasn't started yet
    // This prevents SSE's updateKanban from overwriting isRunning to false before job actually starts
    // 
    // CRITICAL: Keep jobStartPending true even after jobId is received!
    // Receiving jobId only means the API responded, NOT that the job is actually running on the worker.
    // Only SSE should clear jobStartPending when dataSource becomes 'live' or 'estimating'.
    const currentJobStartPending = get().jobStartPending;
    const jobStartPending = isRunning 
      ? (currentJobStartPending || !jobId)  // Keep true if already pending, or set if no jobId yet
      : false;  // Clear when job stops
    
    // ✅ When job stops, clear current feature from runningJobsByFeature
    // This prevents stale "in progress" state that blocks feature deletion
    // (previously only cleared by updateKanban's final broadcast, which may not arrive reliably)
    let runningJobsUpdate: Record<string, any> = {};
    if (!isRunning) {
      const { selectedProject, selectedFeature, runningJobsByFeature } = get();
      const featureKey = selectedProject && selectedFeature ? `${selectedProject}/${selectedFeature}` : null;
      if (featureKey && runningJobsByFeature[featureKey]) {
        const updated = { ...runningJobsByFeature };
        delete updated[featureKey];
        runningJobsUpdate = { runningJobsByFeature: updated };
        console.log(`[Store] 📌 Cleared runningJobsByFeature for ${featureKey} (job stopped)`);
      }
    }
    
    // Debug log for tracking state transitions
    console.log(`[Store] setRunning: isRunning=${isRunning}, jobId=${jobId}, jobStartPending=${jobStartPending} (was ${currentJobStartPending})`);
    
    set({ 
      isRunning,
      currentJobId: isRunning ? (jobId ?? get().currentJobId) : get().currentJobId,
      taskStartTime: startTime,
      elapsedTime: isRunning ? 0 : get().elapsedTime,
      currentMode: isRunning ? mode : undefined,
      userStoppedJobId: isRunning ? null : get().userStoppedJobId,
      // ✅ Cloud multi-pod: jobStartPending protects isRunning from SSE overwrite
      jobStartPending,
      // Reset queue state when job stops
      ...(!isRunning ? { isQueued: false, queuePosition: null } : {}),
      ...(isRunning ? { lastJobFailed: false } : {}),
      // ✅ Clear runningJobsByFeature for current feature when job stops
      ...runningJobsUpdate,
    });

    if (isRunning && jobId) {
      saveToStorage(STORAGE_KEYS.RUNNING_TASK, jobId);
      saveToStorage(STORAGE_KEYS.TASK_START_TIME, startTime);
      if (mode) {
        saveToStorage(STORAGE_KEYS.TASK_MODE, mode);
      }
      
      console.log('[Store] 🔗 Connecting workflow SSE for jobId:', jobId);
      sseManager.connectWorkflow(jobId);
    } else {
      removeFromStorage(STORAGE_KEYS.RUNNING_TASK);
      removeFromStorage(STORAGE_KEYS.TASK_START_TIME);
      removeFromStorage(STORAGE_KEYS.TASK_MODE);
      
      // ✅ Defense: Force-clear kanban estimating state when job stops
      // Prevents stale estimating banner (e.g. "PRD 생성 중") when backend misses clearEstimatingActivity()
      const kanban = get().kanban;
      if (kanban?.isEstimating) {
        set({ kanban: { ...kanban, isEstimating: false, estimatingLabel: undefined, estimatingStartedAt: undefined, estimatingNodeId: undefined } });
      }
      
      if (prevJobId) {
        console.log('[Store] 🔌 Disconnecting workflow SSE for jobId:', prevJobId);
        sseManager.disconnectWorkflow(prevJobId);
      }
    }
  },

  setStopping: (isStopping) => {
    set({ isStopping });
  },

  setLastJobFailed: (failed) => {
    set({ lastJobFailed: failed });
  },

  setDismissedInterruptTimestamp: (timestamp) => {
    set({ dismissedInterruptTimestamp: timestamp });
    if (timestamp) {
      saveToStorage(STORAGE_KEYS.DISMISSED_INTERRUPT_TIMESTAMP, timestamp);
    } else {
      removeFromStorage(STORAGE_KEYS.DISMISSED_INTERRUPT_TIMESTAMP);
    }
  },

  setCurrentJob: (job) => {
    set({ currentJob: job });
  },

  setQueuePosition: (position) => {
    const isQueued = position?.status === 'queued' && position.position !== null;
    set({ 
      queuePosition: position,
      isQueued
    });
  },

  setInlineAskContext: (context) => {
    set({ inlineAskContext: context });
  },

  setActiveJob: (jobType, entry) => {
    const activeJobs = { ...get().activeJobs };
    activeJobs[jobType] = entry;
    set({ activeJobs });
  },

  clearActiveJob: (jobType) => {
    const activeJobs = { ...get().activeJobs };
    delete activeJobs[jobType];
    set({ activeJobs });
  },

  syncViewToJobType: (jobType) => {
    const { activeJobs, currentJobId: prevJobId } = get();
    const activeJob = activeJobs[jobType];

    if (prevJobId) {
      sseManager.disconnectWorkflow(prevJobId);
    }

    const isActiveJob = activeJob && (activeJob.status === 'running' || activeJob.status === 'queued');

    set({
      jobStartPending: false,
      // When switching TO a running job, protect isRunning from the stale
      // session kanban that arrives immediately after reconnectSSE.
      sseReconnectGrace: !!isActiveJob,
      isStopping: false,
      isQueued: false,
      queuePosition: null,
      isRunning: !!isActiveJob,
      currentJobId: isActiveJob ? activeJob.jobId : activeJob?.jobId,
    });

    if (isActiveJob) {
      sseManager.connectWorkflow(activeJob.jobId);
    }
  },
});

