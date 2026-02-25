import { StateCreator } from 'zustand';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import type { ChatMessage, MessageContent } from '@/domain/models/chat';
import type { KanbanData } from '@/infrastructure/http/api';
import { removeFromStorage, STORAGE_KEYS } from '../storage';

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
  cleanupSSE: () => void;
  reconnectSSE: (key: string) => void;
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'error') => void;
}

export type SSESlice = SSEState & SSEActions;

export const createSSESlice: StateCreator<any, [], [], SSESlice> = (set, get) => ({
  // State
  kanban: { jobId: undefined, todo: [], inProgress: [], completed: [], isEstimating: false, dataSource: 'session' as const },
  chatMessages: [],
  connectionStatus: 'disconnected',

  // Actions
  // ✅ Lightweight recursion count update from workflow SSE (no complex Kanban logic)
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

  updateKanban: (data) => {
    const state = get();
    
    // ✅ Preserve jobTiming & totalElapsedTime from existing state if not in incoming data.
    // KanbanBroadcaster (live Redis Pub/Sub) sends task queue updates without job-level timing,
    // while KanbanService (HTTP/session) provides them. Merge to prevent ElapsedTimeBadge from disappearing.
    const existingKanban = state.kanban;
    if (!data.jobTiming && existingKanban?.jobTiming) {
      data = { ...data, jobTiming: existingKanban.jobTiming };
    }
    if (data.totalElapsedTime === undefined && existingKanban?.totalElapsedTime !== undefined) {
      data = { ...data, totalElapsedTime: existingKanban.totalElapsedTime };
    }
    
    // ✅ Preserve recursion tracking from existing state if not in incoming data.
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
    
    // ✅ Preserve tokenUsage from existing state if not in incoming data.
    // KanbanBroadcaster may omit tokenUsage in task queue updates (e.g., checkTaskStatus);
    // preserve to prevent TokenUsageBadge from resetting to 0.
    if (data.tokenUsage === undefined && existingKanban?.tokenUsage !== undefined) {
      data = { ...data, tokenUsage: existingKanban.tokenUsage };
    }
    if (data.estimatingTokenUsage === undefined && existingKanban?.estimatingTokenUsage !== undefined) {
      data = { ...data, estimatingTokenUsage: existingKanban.estimatingTokenUsage };
    }
    
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
        // ✅ Defense: Force-clear estimating state on job completion
        // Prevents stale "PRD 생성 중" banner when backend misses clearEstimatingActivity()
        kanban: { ...data, isEstimating: false, estimatingLabel: undefined, estimatingStartedAt: undefined, estimatingNodeId: undefined },
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
      // Connect workflow SSE so this tab receives workflow updates
      // (connectWorkflow is a no-op if already connected for this jobId)
      if (kanbanJobId) {
        sseManager.connectWorkflow(kanbanJobId);
      }
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
  
  // ✅ Remove cancelled message(s) for a specific jobId
  // Used when resuming a job to clean up the "Task cancelled" choice card
  removeCancelledMessage: (jobId: string) => {
    set((state: any) => ({
      chatMessages: state.chatMessages.filter((msg: ChatMessage) => {
        // Keep message unless it's a cancelled message for this job
        const isCancelledForJob = msg.contents.some(
          (c: MessageContent) => c.type === 'cancelled' && c.metadata?.jobId === jobId
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
    
    const jobType = state.selectedJobType;
    
    sseManager.clearHandlers('kanban');
    sseManager.clearHandlers('chat');
    sseManager.clearHandlers('fileTree');
    sseManager.clearHandlers('unseenArtifacts');
    
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
          // ✅ Cloud multi-pod: Check for duplicate message to prevent double-add
          if (!get().chatMessages.some((m: ChatMessage) => m.id === event.message.id)) {
            get().addChatMessage(event.message);
          } else {
            console.log('[Store] 💬 Ignoring duplicate user_message event:', event.message.id);
          }
          break;
          
        case 'message_start':
          // ✅ Cloud multi-pod: Check for duplicate message to prevent double-add
          if (!get().chatMessages.some((m: ChatMessage) => m.id === event.message.id)) {
            get().addChatMessage(event.message);
          } else {
            console.log('[Store] 💬 Ignoring duplicate message_start event:', event.message.id);
          }
          break;
          
        case 'content_add':
          // ✅ Cloud multi-pod: Check for duplicate content to prevent double-add
          // This can happen when SSE reconnects or handlers are re-registered
          const existingMessage = get().chatMessages.find((m: ChatMessage) => m.id === event.messageId);
          if (existingMessage) {
            const isDuplicate = existingMessage.contents.some((c: MessageContent) => 
              c.type === event.content.type && 
              c.content === event.content.content &&
              c.metadata?.filePath === event.content.metadata?.filePath &&
              c.metadata?.timestamp === event.content.metadata?.timestamp
            );
            if (isDuplicate) {
              console.log('[Store] 💬 Ignoring duplicate content_add event');
              break;
            }
          }
          get().updateChatMessage(event.messageId, {
            contents: [...(existingMessage?.contents || []), event.content]
          });
          break;
          
        case 'content_update':
          const message = get().chatMessages.find((m: ChatMessage) => m.id === event.messageId);
          if (message) {
            const updatedContents = [...message.contents];
            const existing = updatedContents[event.contentIndex];
            // Merge metadata instead of replacing — preserves locally-set fields
            // like choiceSelected that the server event doesn't carry.
            updatedContents[event.contentIndex] = {
              ...existing,
              ...event.content,
              metadata: {
                ...existing?.metadata,
                ...event.content?.metadata,
              },
            };
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
          
        case 'content_remove':
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
          
        case 'cancelled_message': {
          // ✅ Layer 2a: Same message ID (SSE reconnection duplicate)
          if (get().chatMessages.some((m: ChatMessage) => m.id === event.message.id)) {
            console.log('[Store] 💬 Ignoring duplicate cancelled_message (same ID):', event.message.id);
            break;
          }
          // ✅ Layer 2b: Same jobId with unresolved cancelled already exists
          // Even if server SETNX fails and creates multiple cancelled messages with different IDs,
          // the client blocks duplicates for the same jobId (defense-in-depth)
          const incomingJobId = event.message.contents?.[0]?.metadata?.jobId;
          if (incomingJobId) {
            const hasUnresolved = get().chatMessages.some((m: ChatMessage) =>
              m.contents.some((c: MessageContent) =>
                c.type === 'cancelled' &&
                c.metadata?.jobId === incomingJobId &&
                !c.metadata?.choiceSelected &&
                !c.metadata?.resolved
              )
            );
            if (hasUnresolved) {
              console.log('[Store] 💬 Ignoring duplicate cancelled_message for same jobId:', incomingJobId);
              break;
            }
          }
          get().addChatMessage(event.message);
          break;
        }
          
        // ✅ Cloud mode: Handle job status updates (from Redis Pub/Sub → SSE)
        case 'job_status':
          console.log('[Store] 📡 Received job_status event:', event.status, event.jobId);
          if (event.status === 'completed' || event.status === 'failed') {
            const setRunning = get().setRunning;
            if (setRunning) {
              console.log('[Store] ✅ Job completed/failed, setting isRunning=false');
              // setRunning(false) now also clears runningJobsByFeature for current feature
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
        
        // ✅ Inline Ask: Handle completion of inline-ask during interrupted jobs
        case 'inline_ask_complete': {
          const intent = event.intent as 'ask' | 'work';
          const inlineAskContext = get().inlineAskContext;
          console.log(`[Store] 💬 Inline ask complete: intent=${intent}, jobId=${event.jobId}`);
          
          if (intent === 'work' && inlineAskContext) {
            // ✅ Work intent: Auto-continue the interrupted job
            console.log('[Store] 🔧 Work intent → auto-continuing interrupted job:', inlineAskContext.interruptedJobId);
            
            // Dismiss interruption before continuing
            const kanbanData = get().kanban;
            if (kanbanData?.interruption?.timestamp) {
              get().setDismissedInterruptTimestamp(kanbanData.interruption.timestamp);
            }
            
            // Keep isRunning true, update jobId to the interrupted one
            get().setRunning(true, inlineAskContext.interruptedJobId);
            
            // Clear inline ask context
            get().setInlineAskContext(null);
            
            // Trigger continueJob
            import('@/infrastructure/http/api').then(({ continueJob }) => {
              continueJob(
                inlineAskContext.interruptedJobId,
                inlineAskContext.projectId,
                inlineAskContext.featureName,
                inlineAskContext.message,
                true
              ).then((result) => {
                console.log('[Store] ✅ Auto-continue succeeded:', result.jobId);
                get().setRunning(true, result.jobId);
                get().setLastJobFailed(false);
              }).catch((error) => {
                console.error('[Store] ❌ Auto-continue failed:', error);
                get().setRunning(false);
              });
            });
          } else {
            // ✅ Ask intent: Response already streamed to chat. Restore interrupted state.
            console.log('[Store] 💬 Ask intent → keeping interruption state, isRunning=false');
            get().setRunning(false);
            get().setInlineAskContext(null);
          }
          break;
        }
      }
    });
    
    sseManager.registerHandler('fileTree', (data: any) => {
      if (data.type === 'initial' || data.type === 'update') {
        const tree = data.tree || data.fileTree;
        get().setFileTree(tree);
      }
    });
    
    // Unseen artifacts SSE handler (badge notifications)
    sseManager.registerHandler('unseenArtifacts', (data: any) => {
      if (data.type === 'initial' || data.type === 'update') {
        const paths = data.paths || [];
        get().setUnseenArtifacts(paths);
      }
    });
    
    // Transfer SSE handler
    sseManager.registerHandler('transfer', (data: any) => {
      if (data.type === 'transfer-request-new') {
        get().incrementPendingTransferCount();
      } else if (data.type === 'transfer-request-cancelled') {
        get().decrementPendingTransferCount();
      } else if (data.type === 'transfer-request-resolved') {
        // Refresh sent requests to update status
        import('@/infrastructure/http/api').then(({ fetchTransferRequests }) => {
          fetchTransferRequests('sent').then(({ requests }) => {
            get().setSentRequests(requests);
          }).catch(() => {});
        });
      }
    });
    
    // Register status callback so connectionStatus reflects actual EventSource state
    // (not set optimistically before onopen fires)
    sseManager.setStatusCallback((status) => {
      const currentStatus = get().connectionStatus;
      if (currentStatus !== status) {
        set({ connectionStatus: status });
        console.log(`[Store] 📡 SSE connection status: ${status}`);
      }
    });
    
    sseManager.connect(state.selectedProject, state.selectedFeature, jobType);
    
    if (state.currentJobId) {
      sseManager.connectWorkflow(state.currentJobId);
    }
    
    // NOTE: connectionStatus is now set by SSEManager's onopen callback via statusCallback
    // (previously set optimistically here before EventSource was actually connected)
    console.log('[Store] ✅ Unified SSE connection initializing (waiting for onopen...)');
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

