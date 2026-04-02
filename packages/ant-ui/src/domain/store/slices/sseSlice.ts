import { StateCreator } from 'zustand';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import type { HandlerId } from '@/infrastructure/sse/SSEManager';
import type { ChatMessage, MessageContent } from '@/domain/models/chat';
import type { KanbanData, FileNode } from '@/infrastructure/http/api';
import { removeFromStorage, STORAGE_KEYS } from '../storage';

function findFigmaJsonNode(tree: FileNode[]): FileNode | undefined {
  const inputs = tree?.find(n => n.name === 'inputs');
  return inputs?.children?.find(n => n.name === 'figma.json');
}

let figmaRefreshTimer: ReturnType<typeof setTimeout> | null = null;
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
    
    // Preserve jobTiming from existing state if not in incoming data.
    // KanbanBroadcaster (live Redis Pub/Sub) sends task queue updates without job-level timing,
    // while KanbanService (HTTP/session) provides them. Merge to prevent ElapsedTimeBadge from disappearing.
    const existingKanban = state.kanban;
    if (!data.jobTiming && existingKanban?.jobTiming) {
      data = { ...data, jobTiming: existingKanban.jobTiming };
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
    
    // ✅ Cloud multi-pod: Clear SSE reconnect grace when live data arrives
    if (isJobRunning && state.sseReconnectGrace) {
      set({ sseReconnectGrace: false });
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
      // ✅ Cloud multi-pod: SSE reconnect grace — stale session data must not reset isRunning.
      // After ALB drops the SSE connection, EventSource auto-reconnects and the new Realtime
      // pod sends initial kanban (dataSource:'session') before the next live broadcast arrives.
      // Without this guard, that stale initial data would incorrectly set isRunning=false.
      if (state.sseReconnectGrace && data.dataSource === 'session') {
        console.log('[Store] SSE reconnect grace: protecting isRunning from stale session data');
        set({ kanban: data, runningJobsByFeature: updatedRunningJobs });
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
      
      // ✅ CRITICAL: Clear localStorage to prevent useJobRestoration from restoring completed job
      // This fixes the bug where switching to IDE tab and back would "restore" a completed job
      removeFromStorage(STORAGE_KEYS.RUNNING_TASK);
      removeFromStorage(STORAGE_KEYS.TASK_START_TIME);
      removeFromStorage(STORAGE_KEYS.TASK_MODE);
      console.log('[Store] 🧹 Cleared localStorage for completed job');
      
      // ✅ Sync final file tree on job completion (safety net for missed Pub/Sub events)
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
      
      // Ensure workflow SSE is connected when job is running.
      // After page refresh, useJobRestoration sets isRunning=true before live kanban arrives,
      // so the auto-restore branch (isJobRunning && !isRunning) is never reached.
      // This ensures workflow SSE is connected regardless of which branch was taken.
      if (isJobRunning && kanbanJobId && !sseManager.isWorkflowConnected(kanbanJobId)) {
        console.log(`[Store] 🔗 Connecting workflow SSE in else branch for ${kanbanJobId}`);
        sseManager.connectWorkflow(kanbanJobId);
      }
      
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
    
    console.log(`[Timing] initializeSSE start @${Math.round(performance.now())}ms (${state.selectedProject}/${state.selectedFeature})`);
    
    const jobType = state.selectedJobType;
    
    const connectedProject = state.selectedProject;
    const connectedFeature = state.selectedFeature;
    
    for (const id of sliceHandlerIds) {
      sseManager.unregisterHandlerById(id);
    }
    sliceHandlerIds = [];
    
    sliceHandlerIds.push(sseManager.registerHandlerWithId('kanban', (data: KanbanData) => {
      const currentState = get();
      if (currentState.selectedProject !== connectedProject ||
          currentState.selectedFeature !== connectedFeature) return;
      get().updateKanban(data);
    }));
    
    sliceHandlerIds.push(sseManager.registerHandlerWithId('chat', (event: any) => {
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
          if (event.content?.type === 'downloaded') {
            setTimeout(() => get().refreshFileTree(), 1000);
          }
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
          // Chat clearing may delete draft images from disk.
          // Refresh file tree to reflect the deletion (safety net in case
          // the server-side fileTree SSE broadcast arrives late or is missed).
          get().refreshFileTree();
          break;
          
        case 'cancelled_message': {
          // ✅ Layer 2a: Same message ID (SSE reconnection duplicate)
          if (get().chatMessages.some((m: ChatMessage) => m.id === event.message.id)) {
            console.log('[Store] 💬 Ignoring duplicate cancelled_message (same ID):', event.message.id);
            break;
          }
          // ✅ Layer 2b: Same jobId with unresolved cancelled already exists
          // Auto-resolve the old cancelled message and add the new one.
          // This handles the case where a job was resumed (via API, server restart, etc.)
          // without the old choice card being explicitly resolved, and then interrupted again.
          const incomingJobId = event.message.contents?.[0]?.metadata?.jobId;
          if (incomingJobId) {
            const unresolvedMsgs = get().chatMessages.filter((m: ChatMessage) =>
              m.contents.some((c: MessageContent) =>
                c.type === 'cancelled' &&
                c.metadata?.jobId === incomingJobId &&
                !c.metadata?.choiceSelected &&
                !c.metadata?.resolved
              )
            );
            for (const oldMsg of unresolvedMsgs) {
              const contentIndex = oldMsg.contents.findIndex((c: MessageContent) =>
                c.type === 'cancelled' && c.metadata?.jobId === incomingJobId
              );
              if (contentIndex !== -1) {
                const updatedContents = [...oldMsg.contents];
                updatedContents[contentIndex] = {
                  ...updatedContents[contentIndex],
                  metadata: {
                    ...updatedContents[contentIndex].metadata,
                    choiceSelected: 'resume',
                    resolvedLabel: 'Resumed',
                  },
                };
                get().updateChatMessage(oldMsg.id, { contents: updatedContents });
                console.log('[Store] 💬 Auto-resolved stale cancelled_message for jobId:', incomingJobId, 'msgId:', oldMsg.id);
              }
            }
          }
          get().addChatMessage(event.message);
          break;
        }
          
        // ✅ Cloud mode: Handle job status updates (from Redis Pub/Sub → SSE)
        case 'job_status': {
          console.log('[Store] 📡 Received job_status event:', event.status, event.jobId);
          if (event.status === 'completed' || event.status === 'failed') {
            const currentState = get();
            if (currentState.jobStartPending && currentState.isRunning) {
              console.log('[Store] 🛡️ Ignoring job_status completion - new job start pending');
              get().refreshFileTree();
              break;
            }
            // Ignore stale completion events from a different (previous) job.
            // Without this check, a delayed completion event from job A could
            // reset isRunning=false while job B is already running.
            if (event.jobId && currentState.currentJobId && event.jobId !== currentState.currentJobId) {
              console.log(`[Store] 🛡️ Ignoring job_status for stale job ${event.jobId} (current: ${currentState.currentJobId})`);
              get().refreshFileTree();
              break;
            }
            const setRunning = currentState.setRunning;
            if (setRunning) {
              console.log('[Store] ✅ Job completed/failed, setting isRunning=false');
              setRunning(false);
            }
            // ✅ Sync final file tree on job completion (safety net for missed Pub/Sub events)
            get().refreshFileTree();
          } else if (event.status === 'running' || event.status === 'started') {
            // ✅ Cloud multi-pod: Clear jobStartPending when job actually starts
            if (get().jobStartPending) {
              console.log('[Store] ✅ Job started on worker, clearing jobStartPending via job_status');
              set({ jobStartPending: false });
            }
          }
          break;
        }
        
        // ✅ Inline Ask: Handle completion with 3-way routing
        case 'inline_ask_complete': {
          const intent = event.intent as 'ask' | 'work';
          const action = event.action as 'continue' | 'newJob' | 'redirect' | undefined;
          const inlineAskContext = get().inlineAskContext;
          console.log(`[Store] 💬 Inline ask complete: intent=${intent}, action=${action}, jobId=${event.jobId}`);
          
          if (intent === 'work' && inlineAskContext) {
            const noSession = event.noSession === true;

            const dismissInterruption = () => {
              const kanbanData = get().kanban;
              if (kanbanData?.interruption?.timestamp) {
                get().setDismissedInterruptTimestamp(kanbanData.interruption.timestamp);
              }
            };

            const cleanupCancelledCard = () => {
              if (inlineAskContext.interruptedJobId) {
                get().removeCancelledMessage(inlineAskContext.interruptedJobId);
              }
            };

            const startFreshJob = (jobType?: string, agent?: string) => {
              dismissInterruption();
              cleanupCancelledCard();
              get().setInlineAskContext(null);
              
              const state = get() as any;
              const effectiveJobType = jobType || state.selectedJobType || 'design';
              const effectiveAgent = agent || state.selectedAgent || 'architect';
              
              import('@/infrastructure/http/api').then(({ clearSessionData, executeJob }) => {
                clearSessionData(
                  inlineAskContext.projectId,
                  inlineAskContext.featureName,
                  state.selectedJobType || 'code'
                ).then(() => {
                  console.log('[Store] ✅ Session cleared for fresh start');
                }).catch(() => {
                  console.warn('[Store] ⚠️ Session clear failed, proceeding anyway');
                }).finally(() => {
                  executeJob({
                    projectId: inlineAskContext.projectId,
                    featureName: inlineAskContext.featureName,
                    jobType: effectiveJobType,
                    agent: effectiveAgent,
                    overrideDirective: inlineAskContext.message,
                    chatSource: true,
                  }).then((result) => {
                    console.log('[Store] ✅ Fresh job started:', result.jobId);
                    get().setRunning(true, result.jobId);
                    get().setLastJobFailed(false);
                  }).catch((error) => {
                    console.error('[Store] ❌ Fresh job start failed:', error);
                    get().setRunning(false);
                  });
                });
              });
            };
            
            if (noSession) {
              console.log('[Store] ⚠️ Work intent + noSession → starting fresh job');
              startFreshJob();
            } else if (action === 'redirect') {
              // Scenario 3: Redirect — choice card already sent by backend
              // Only cleanup UI state; do NOT auto-start job (user interacts with choice card)
              console.log('[Store] 🔀 Work + redirect → dismissing interruption, awaiting choice card');
              dismissInterruption();
              cleanupCancelledCard();
              get().setRunning(false);
              get().setInlineAskContext(null);
            } else if (action === 'newJob') {
              // Scenario 2: New independent task → clear session, start fresh same mode
              console.log('[Store] 🆕 Work + newJob → clear session, start fresh');
              startFreshJob();
            } else {
              // Scenario 1 (default): Supplement existing task → continueJob (revise)
              console.log('[Store] 🔧 Work + continue → auto-continuing interrupted job:', inlineAskContext.interruptedJobId);
              
              dismissInterruption();
              cleanupCancelledCard();
              get().setRunning(true, inlineAskContext.interruptedJobId);
              get().setInlineAskContext(null);
              
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
            }
          } else {
            // ✅ Ask intent: Response already streamed to chat. Restore interrupted state.
            console.log('[Store] 💬 Ask intent → keeping interruption state, isRunning=false');
            get().setRunning(false);
            get().setInlineAskContext(null);
          }
          break;
        }
      }
    }));
    
    sliceHandlerIds.push(sseManager.registerHandlerWithId('fileTree', (data: any) => {
      if (data.type === 'initial' || data.type === 'update') {
        const tree = data.tree || data.fileTree;
        console.log(`[Timing] SSE fileTree received (type=${data.type}, nodes=${tree?.length ?? 0}) @${Math.round(performance.now())}ms`);

        const oldFigma = findFigmaJsonNode(get().fileTree);
        const newFigma = findFigmaJsonNode(tree);
        const figmaChanged =
          (oldFigma?.size !== newFigma?.size) ||
          (oldFigma?.modifiedTime !== newFigma?.modifiedTime) ||
          (!oldFigma && !!newFigma) ||
          (!!oldFigma && !newFigma);

        get().setFileTree(tree);

        if (figmaChanged) {
          if (figmaRefreshTimer) clearTimeout(figmaRefreshTimer);
          figmaRefreshTimer = setTimeout(() => {
            get().refreshFigmaPopulated?.();
            figmaRefreshTimer = null;
          }, 300);
        }
      }
    }));
    
    // Unseen artifacts SSE handler (badge notifications)
    sliceHandlerIds.push(sseManager.registerHandlerWithId('unseenArtifacts', (data: any) => {
      if (data.type === 'initial' || data.type === 'update') {
        const paths = data.paths || [];
        get().setUnseenArtifacts(paths);
      }
    }));
    
    // Bridge SSE handler (user-level: Ant Desktop connection status)
    sliceHandlerIds.push(sseManager.registerHandlerWithId('bridge', (data: any) => {
      get().setBridgeStatus(data);
    }));

    // Transfer SSE handler
    sliceHandlerIds.push(sseManager.registerHandlerWithId('transfer', (data: any) => {
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
    }));
    
    // Register status callback so connectionStatus reflects actual EventSource state
    // (not set optimistically before onopen fires)
    sseManager.setStatusCallback((status) => {
      const currentStatus = get().connectionStatus;
      if (currentStatus !== status) {
        set({ connectionStatus: status });
        console.log(`[Timing] SSE connectionStatus: ${currentStatus} -> ${status} @${Math.round(performance.now())}ms`);
      }

      // Re-fetch bridge status on every SSE connect (initial + reconnect).
      // Covers two cases:
      //  1) Initial: bridge SSE events published before SSE connected are lost
      //  2) Reconnect: status may have changed while SSE was down
      if (status === 'connected') {
        import('@/infrastructure/http/api/desktop').then(({ checkBridgeStatus }) => {
          checkBridgeStatus().then((bs) => get().setBridgeStatus(bs)).catch(() => {});
        }).catch(() => {});
      }
    });
    
    // Register reconnect callback to protect isRunning from stale initial data
    // after SSE reconnects (e.g., ALB idle-timeout, HTTP/2 GOAWAY, tab visibility)
    sseManager.setOnReconnectCallback(() => {
      console.log('[Store] SSE reconnected, enabling grace period');
      set({ sseReconnectGrace: true });

      // Bridge status re-fetch is handled by statusCallback('connected') — no duplication here
      get().refreshFigmaPopulated?.();

      setTimeout(() => {
        if (get().sseReconnectGrace) {
          console.log('[Store] SSE reconnect grace expired (timeout)');
          set({ sseReconnectGrace: false });

          const { kanban, isRunning } = get();
          if (kanban && isRunning) {
            const stillRunning = kanban.dataSource === 'live' || kanban.dataSource === 'estimating';
            if (!stillRunning) {
              console.log('[Store] SSE grace expired: no live data received — job completed during grace');
              set({
                isRunning: false,
                currentMode: undefined,
                jobStartPending: false,
              });
              removeFromStorage(STORAGE_KEYS.RUNNING_TASK);
              removeFromStorage(STORAGE_KEYS.TASK_START_TIME);
              removeFromStorage(STORAGE_KEYS.TASK_MODE);
            }
          }
        }
      // ✅ 15s grace: large session files on EFS can take several seconds to read.
      // safeReadSession now uses async I/O (no event loop blocking), but EFS
      // latency can still delay initial kanban delivery past the old 5s window.
      }, 15000);
    });

    sseManager.connect(state.selectedProject, state.selectedFeature, jobType);
    
    if (state.currentJobId) {
      sseManager.connectWorkflow(state.currentJobId);
    }
    
    // NOTE: connectionStatus is now set by SSEManager's onopen callback via statusCallback
    // (previously set optimistically here before EventSource was actually connected)
    console.log('[Store] ✅ Unified SSE connection initializing (waiting for onopen...)');
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

