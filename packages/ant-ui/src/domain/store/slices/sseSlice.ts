import { StateCreator } from 'zustand';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import type { HandlerId } from '@/infrastructure/sse/SSEManager';
import type { ChatMessage } from '@/domain/models/chat';
import type { KanbanData } from '@/infrastructure/http/api';
import type { SSEMessageMap } from '@ant/shared';

import { handleKanbanUpdate } from './sse/kanbanReducer';
import { createChatSseHandler } from './sse/chatSseHandler';
import { createFileTreeSseHandler } from './sse/fileTreeSseHandler';
import { createUnseenArtifactsHandler, createBridgeHandler, createTransferHandler } from './sse/auxiliarySseHandlers';
import { setupConnectionPolicy } from './sse/sseConnectionPolicy';
import { handleInitialActiveJobs } from './sse/activeJobsBootstrap';

let sliceHandlerIds: HandlerId[] = [];

export interface SSEState {
  kanban: KanbanData;
  chatMessages: ChatMessage[];
  connectionStatus: 'connected' | 'disconnected' | 'error';
}

export interface SSEActions {
  updateKanban: (data: KanbanData) => void;
  updateKanbanRecursion: (recursionCount: number, recursionLimit?: number, recursionTaskName?: string) => void;
  addChatMessage: (message: ChatMessage) => void;
  updateChatMessage: (messageId: string, updates: Partial<ChatMessage>) => void;
  removeCancelledMessage: (jobId: string) => void;
  clearChatMessages: () => void;
  initializeSSE: () => void;
  reconnectSSE: (key: string) => void;
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'error') => void;
  handleInitialActiveJobs: (jobs: Array<{ jobType: string; jobId: string; status: string; agent?: string }>) => void;
}

export type SSESlice = SSEState & SSEActions;

export const createSSESlice: StateCreator<any, [], [], SSESlice> = (set, get) => ({
  // State
  kanban: { jobId: undefined, todo: [], inProgress: [], completed: [], isEstimating: false, dataSource: 'session' as const },
  chatMessages: [],
  connectionStatus: 'disconnected',

  // Actions
  updateKanbanRecursion: (recursionCount: number, recursionLimit?: number, recursionTaskName?: string) => {
    set((state: any) => ({
      kanban: {
        ...state.kanban,
        recursionCount,
        ...(recursionLimit !== undefined && { recursionLimit }),
        ...(recursionTaskName !== undefined && { recursionTaskName }),
      }
    }));
  },

  updateKanban: (data) => handleKanbanUpdate(data, set, get),

  addChatMessage: (message) => {
    set((state: any) => ({
      chatMessages: [...state.chatMessages, message]
    }));
  },

  removeCancelledMessage: (jobId: string) => {
    set((state: any) => ({
      chatMessages: state.chatMessages.filter((msg: ChatMessage) => {
        const isCancelledForJob = msg.contents.some(
          (c: any) => c && c.type === 'cancelled' && c.metadata?.jobId === jobId
        );
        return !isCancelledForJob;
      })
    }));
  },

  updateChatMessage: (messageId, updates) => {
    set((state: any) => ({
      chatMessages: state.chatMessages.map((msg: ChatMessage) =>
        msg.id === messageId ? { ...msg, ...updates } : msg
      )
    }));
  },

  clearChatMessages: () => {
    set({ chatMessages: [] });
  },

  initializeSSE: () => {
    const state = get();

    if (!state.selectedProject || !state.selectedFeature) {
      console.warn('[Store] Cannot initialize SSE: missing project/feature');
      return;
    }

    if (state.backendMode === 'cloud' && !state.userEmail) {
      console.log('[Store] Cannot initialize SSE: Cloud mode requires authentication');
      return;
    }

    console.log(`[Timing] initializeSSE start @${Math.round(performance.now())}ms (${state.selectedProject}/${state.selectedFeature})`);

    const jobType = state.selectedJobType;
    const connectedProject = state.selectedProject;
    const connectedFeature = state.selectedFeature;

    for (const id of sliceHandlerIds) {
      sseManager.unregisterHandlerById(id);
    }
    sliceHandlerIds = [];

    // Kanban handler: 3-stage pipeline (activeJobs bootstrap → per-jobType tracking → jobType filter)
    sliceHandlerIds.push(sseManager.registerHandlerWithId('kanban', (data: KanbanData) => {
      const currentState = get();
      if (currentState.selectedProject !== connectedProject ||
          currentState.selectedFeature !== connectedFeature) return;

      if (data.activeJobs) {
        get().handleInitialActiveJobs(data.activeJobs);
      }

      if (data.jobType && data.jobId && !data.activeJobs) {
        const isActive = data.dataSource === 'live' || data.dataSource === 'estimating';
        if (isActive) {
          get().setActiveJob(data.jobType, { jobId: data.jobId, status: 'running' });
        } else {
          get().clearActiveJob(data.jobType);
        }
      }

      if (!data.jobType || data.jobType === currentState.selectedJobType) {
        get().updateKanban(data);
      }
    }));

    sliceHandlerIds.push(sseManager.registerHandlerWithId('chat', createChatSseHandler(set, get)));
    sliceHandlerIds.push(sseManager.registerHandlerWithId('fileTree', createFileTreeSseHandler(get)));
    sliceHandlerIds.push(sseManager.registerHandlerWithId('unseenArtifacts', createUnseenArtifactsHandler(get)));
    sliceHandlerIds.push(sseManager.registerHandlerWithId('bridge', createBridgeHandler(get)));
    sliceHandlerIds.push(sseManager.registerHandlerWithId('transfer', createTransferHandler(get)));

    // gitChange handler — single registration point for the whole app.
    // The previous architecture registered this inside useGitChanges, which
    // (a) created a stale closure over selectedProject/selectedFeature and
    // (b) re-registered on every hook remount. Reading via get() ensures
    // feature switches immediately take effect without teardown.
    sliceHandlerIds.push(
      sseManager.registerHandlerWithId('gitChange', (data: SSEMessageMap['gitChange']) => {
        const s = get();
        const activeProject = s.selectedProject;
        const activeFeature = s.selectedFeature;
        if (!activeProject) return;
        // featureName arrives from BE as string; local-no-feature case stores
        // undefined on the FE. Normalize both sides before comparing.
        const eventFeature = data?.feature || undefined;
        if (
          data?.project !== activeProject ||
          eventFeature !== activeFeature
        ) {
          return;
        }
        s.fetchGitChanges?.(activeProject, activeFeature);
      })
    );

    setupConnectionPolicy(sseManager, set, get);

    sseManager.connect(state.selectedProject, state.selectedFeature, jobType);

    if (state.currentJobId) {
      sseManager.connectWorkflow(state.currentJobId);
    }

    console.log('[Store] ✅ Unified SSE connection initializing (waiting for onopen...)');
  },

  // Currently unused: job switching uses REST fetchKanbanData instead of SSE reconnect.
  // Kept for potential future use (e.g. chat/fileTree full resync).
  reconnectSSE: (key) => {
    const state = get();
    console.log(`[Store] 🔄 Reconnecting unified SSE (key: ${key})`);

    if (!state.selectedProject || !state.selectedFeature) {
      console.warn('[Store] ⚠️  Cannot reconnect: missing project/feature');
      return;
    }

    if (state.backendMode === 'cloud' && !state.userEmail) {
      console.log('[Store] ⚠️  Cannot reconnect SSE: Cloud mode requires authentication');
      return;
    }

    if (key === 'kanban' || key === 'chat' || key === 'fileTree') {
      sseManager.disconnect();
      get().initializeSSE();
    }
    else if (key === 'workflow' && state.currentJobId) {
      sseManager.disconnectWorkflow(state.currentJobId);
      sseManager.connectWorkflow(state.currentJobId);
    }
  },

  setConnectionStatus: (status) => {
    set({ connectionStatus: status });
  },

  handleInitialActiveJobs: (jobs) => handleInitialActiveJobs(jobs, set, get),
});
