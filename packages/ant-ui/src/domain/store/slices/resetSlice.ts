import { StateCreator } from 'zustand';
import { STORAGE_KEYS, removeFromStorage } from '../storage';

export interface ResetActions {
  reset: () => void;
}

export type ResetSlice = ResetActions;

export const createResetSlice: StateCreator<any, [], [], ResetSlice> = (set) => ({
  reset: () => {
    set({
      kanban: { jobId: undefined, todo: [], inProgress: [], completed: [] },
      selectedProject: undefined,
      selectedFeature: undefined,
      session: undefined,
      isRunning: false,
      isStopping: false,
      userStoppedJobId: null,
      lastJobFailed: false,
      runningJobsByFeature: {},
      currentJobId: undefined,
      currentJob: null,
      connectionStatus: 'disconnected',
      chatMessages: [],
      mainPanelActiveTab: 'job',
      mainPanelOpenTabs: { projectConfig: false, accountConfig: false, fileEdit: false, transfer: false, previewConfig: false },
      mainPanelTabOrder: [],
      isJobTabCleared: false,
      bridgeConnected: null,
      bridgeDetected: false,
      figmaDesktopReachable: false,
      bridgeStatusChecked: false,
      accountConfigScrollTarget: null,
    });
    
    // Clear job-related localStorage
    removeFromStorage(STORAGE_KEYS.RUNNING_TASK);
    removeFromStorage(STORAGE_KEYS.TASK_START_TIME);
    removeFromStorage(STORAGE_KEYS.TASK_MODE);
    removeFromStorage(STORAGE_KEYS.DISMISSED_INTERRUPT_TIMESTAMP);
  },
});

