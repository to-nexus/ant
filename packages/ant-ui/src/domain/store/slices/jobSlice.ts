import { StateCreator } from 'zustand';
import { JobState, QueuePosition } from '../types';
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
    const jobStartPending = isRunning && !jobId;  // Pending until jobId is assigned
    
    set({ 
      isRunning,
      currentJobId: isRunning ? jobId : undefined,
      taskStartTime: startTime,
      elapsedTime: isRunning ? 0 : get().elapsedTime,
      currentMode: isRunning ? mode : undefined,
      userStoppedJobId: isRunning ? null : get().userStoppedJobId,
      // ✅ Cloud multi-pod: jobStartPending protects isRunning from SSE overwrite
      jobStartPending,
      // Reset queue state when job stops
      ...(!isRunning ? { isQueued: false, queuePosition: null } : {}),
      ...(isRunning ? { lastJobFailed: false } : {})
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
});

