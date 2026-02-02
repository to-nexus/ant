import { StateCreator } from 'zustand';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import type { ChatMessage } from '@/domain/models/chat';
import type { KanbanData } from '@/infrastructure/http/api';
import { removeFromStorage, STORAGE_KEYS } from '../storage';

export interface SSEState {
  kanban: KanbanData;
  chatMessages: ChatMessage[];
  connectionStatus: 'connected' | 'disconnected' | 'error';
}

export interface SSEActions {
  updateKanban: (data: KanbanData) => void;
  addChatMessage: (message: ChatMessage) => void;
  updateChatMessage: (messageId: string, updates: Partial<ChatMessage>) => void;
  clearChatMessages: () => void;
  removeCancelledMessage: (jobId: string) => void;
  initializeSSE: () => void;
  cleanupSSE: () => void;
  reconnectSSE: (key: string) => void;
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'error') => void;
}

export type SSESlice = SSEState & SSEActions;

export const createSSESlice: StateCreator<any, [], [], SSESlice> = (set, get) => ({
  // State
  kanban: { jobId: undefined, todo: [], inProgress: null, completed: [] },
  chatMessages: [],
  connectionStatus: 'disconnected',

  // Actions
  updateKanban: (data) => {
    const state = get();
    
    const kanbanJobId = data.jobId;
    const { selectedProject, selectedFeature } = state;
    const currentFeatureKey = selectedProject && selectedFeature ? `${selectedProject}/${selectedFeature}` : null;
    
    const isJobRunning = data.dataSource === 'live' || data.dataSource === 'estimating';
    
    // ✅ Cloud multi-pod: Clear jobStartPending when actual job starts running
    // This signals that the job has actually started on the worker pod
    if (isJobRunning && state.jobStartPending) {
      console.log('[Store] ✅ Job actually started on worker, clearing jobStartPending');
      set({ jobStartPending: false });
    }
    
    // Clear queue position when job actually starts running (has inProgress task)
    if (isJobRunning && data.inProgress && state.isQueued) {
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
    
    // ✅ Cloud multi-pod: Protect isRunning when jobStartPending is true
    // This prevents SSE from overwriting isRunning=true before actual job starts on worker pod
    // Scenarios: Triage redirect, new job start, resume - all set isRunning=true locally
    // but actual job starts on worker pod with delay in cloud multi-pod environment
    const shouldProtectRunningState = state.jobStartPending && state.isRunning && !isJobRunning;
    
    if (shouldProtectRunningState) {
      console.log('[Store] 🛡️ Protecting isRunning state - job start pending, waiting for worker pod');
      set({ 
        kanban: data,
        runningJobsByFeature: updatedRunningJobs
      });
      return;
    }
    
    if (!isJobRunning && state.isRunning && currentFeatureKey) {
      const interruptionWasDismissed = 
        data.interruption?.timestamp && 
        data.interruption.timestamp === state.dismissedInterruptTimestamp;
      
      if (interruptionWasDismissed) {
        console.log('[Store] ⏸️ Ignoring session data - interruption was dismissed (Resume in progress)');
        set({ kanban: data, runningJobsByFeature: updatedRunningJobs });
        return;
      }
      
      // Debug logging (disabled for production)
      // console.log(`[Store] ✅ Job completed for ${currentFeatureKey}`);
      set({ 
        kanban: data,
        runningJobsByFeature: updatedRunningJobs,
        currentJobId: kanbanJobId,
        isRunning: false,
        currentMode: undefined,
        jobStartPending: false  // ✅ Clear pending flag on job completion
      });
      
      // ✅ CRITICAL: Clear localStorage to prevent useJobRestoration from restoring completed job
      // This fixes the bug where switching to IDE tab and back would "restore" a completed job
      removeFromStorage(STORAGE_KEYS.RUNNING_TASK);
      removeFromStorage(STORAGE_KEYS.TASK_START_TIME);
      removeFromStorage(STORAGE_KEYS.TASK_MODE);
      console.log('[Store] 🧹 Cleared localStorage for completed job');
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
        jobStartPending: false  // ✅ Clear pending flag when job is actually running
      });
    }
    else {
      const newState: any = { 
        kanban: data,
        runningJobsByFeature: updatedRunningJobs,
        isRunning: currentFeatureIsRunning,
        // ✅ Clear pending flag when job state is determined from SSE
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
      
      // ✅ CRITICAL: Also clear localStorage when SSE says no job is running
      // This handles edge cases where previous branches didn't trigger
      if (!currentFeatureIsRunning && !state.isRunning) {
        // Both SSE and local state agree: no job running
        // Ensure localStorage is clean to prevent useJobRestoration issues
        removeFromStorage(STORAGE_KEYS.RUNNING_TASK);
        removeFromStorage(STORAGE_KEYS.TASK_START_TIME);
        removeFromStorage(STORAGE_KEYS.TASK_MODE);
      }
    }
  },
  
  addChatMessage: (message) => {
    set((state: any) => ({
      chatMessages: [...state.chatMessages, message]
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
  
  removeCancelledMessage: (jobId: string) => {
    set((state: any) => ({
      chatMessages: state.chatMessages.filter((msg: ChatMessage) => 
        !(msg.contents.some(c => c.type === 'cancelled' && c.metadata?.jobId === jobId))
      )
    }));
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
    
    const jobType = state.selectedJobType;
    
    sseManager.clearHandlers('kanban');
    sseManager.clearHandlers('chat');
    sseManager.clearHandlers('fileTree');
    
    sseManager.registerHandler('kanban', (data: KanbanData) => {
      get().updateKanban(data);
    });
    
    sseManager.registerHandler('chat', (event: any) => {
      const currentState = get();
      const isCorrectContext = 
        event.projectId === currentState.selectedProject &&
        event.featureName === currentState.selectedFeature;
      
      if (!isCorrectContext) {
        console.log(`[Store] 💬 Ignoring chat event from different context: ${event.projectId}/${event.featureName}`);
        return;
      }
      
      switch (event.type) {
        case 'initial_state':
          console.log('[Store] 💬 Loading initial chat messages:', event.messages.length);
          set({ chatMessages: event.messages });
          break;
          
        case 'user_message':
          get().addChatMessage(event.message);
          break;
          
        case 'message_start':
          get().addChatMessage(event.message);
          break;
          
        case 'content_add':
          get().updateChatMessage(event.messageId, {
            contents: [...(get().chatMessages.find((m: ChatMessage) => m.id === event.messageId)?.contents || []), event.content]
          });
          break;
          
        case 'content_update':
          const message = get().chatMessages.find((m: ChatMessage) => m.id === event.messageId);
          if (message) {
            const updatedContents = [...message.contents];
            updatedContents[event.contentIndex] = event.content;
            get().updateChatMessage(event.messageId, { 
              contents: updatedContents,
              isStreaming: true 
            });
          }
          break;
          
        case 'content_append':
          const appendMessage = get().chatMessages.find((m: ChatMessage) => m.id === event.messageId);
          if (appendMessage) {
            const appendContents = [...appendMessage.contents];
            if (appendContents[event.contentIndex]) {
              const oldContent = appendContents[event.contentIndex].content;
              const newContent = oldContent + event.delta;
              
              appendContents[event.contentIndex] = {
                ...appendContents[event.contentIndex],
                content: newContent
              };
              get().updateChatMessage(event.messageId, { 
                contents: appendContents,
                isStreaming: true 
              });
            }
          }
          break;
          
        case 'content_delete':
          const deleteMessage = get().chatMessages.find((m: ChatMessage) => m.id === event.messageId);
          if (deleteMessage) {
            const deletedContents = [...deleteMessage.contents];
            deletedContents.splice(event.contentIndex, 1);
            get().updateChatMessage(event.messageId, { 
              contents: deletedContents,
              isStreaming: true 
            });
          }
          break;
          
        case 'thinking_collapse':
          const collapseMessage = get().chatMessages.find((m: ChatMessage) => m.id === event.messageId);
          if (collapseMessage) {
            const collapseContents = [...collapseMessage.contents];
            if (collapseContents[event.contentIndex] && collapseContents[event.contentIndex].type === 'thinking') {
              collapseContents[event.contentIndex] = {
                ...collapseContents[event.contentIndex],
                metadata: {
                  ...collapseContents[event.contentIndex].metadata,
                  collapsed: true,
                  durationMs: event.durationMs
                }
              };
              get().updateChatMessage(event.messageId, { 
                contents: collapseContents,
                isStreaming: true 
              });
            }
          }
          break;
          
        case 'message_complete':
          get().updateChatMessage(event.messageId, { isStreaming: false });
          break;
          
        case 'messages_cleared':
          set({ chatMessages: [] });
          break;
          
        case 'cancelled_message':
          get().addChatMessage(event.message);
          break;
          
        // ✅ Cloud mode: Handle job status updates (from Redis Pub/Sub → SSE)
        case 'job_status':
          console.log('[Store] 📡 Received job_status event:', event.status, event.jobId);
          if (event.status === 'completed' || event.status === 'failed') {
            const setRunning = get().setRunning;
            if (setRunning) {
              console.log('[Store] ✅ Job completed/failed, setting isRunning=false');
              setRunning(false);
            }
          } else if (event.status === 'running' || event.status === 'started') {
            // ✅ Cloud multi-pod: Clear jobStartPending when job actually starts
            if (get().jobStartPending) {
              console.log('[Store] ✅ Job started on worker, clearing jobStartPending via job_status');
              set({ jobStartPending: false });
            }
          }
          break;
      }
    });
    
    sseManager.registerHandler('fileTree', (data: any) => {
      if (data.type === 'initial' || data.type === 'update') {
        const tree = data.tree || data.fileTree;
        get().setFileTree(tree);
      }
    });
    
    sseManager.connect(state.selectedProject, state.selectedFeature, jobType);
    
    if (state.currentJobId) {
      sseManager.connectWorkflow(state.currentJobId);
    }
    
    set({ connectionStatus: 'connected' });
    console.log('[Store] ✅ Unified SSE connection initialized');
  },
  
  cleanupSSE: () => {
    console.log('[Store] 🧹 Cleaning up SSE connections...');
    sseManager.cleanup();
    sseManager.clearHandlers();
    set({ connectionStatus: 'disconnected' });
    console.log('[Store] ✅ SSE connections cleaned up');
  },
  
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
});

