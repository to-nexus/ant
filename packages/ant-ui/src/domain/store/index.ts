import { create } from 'zustand';
import { Session } from '@/domain/models/session';
import { Feature, FileNode, FileContent, DevServerStatus, KanbanData } from '@/infrastructure/http/api';
import { JobExecution } from '@/infrastructure/http/cli';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import type { WorkflowRealtimeState } from '@/domain/models/workflow';
import type { ChatMessage } from '@/domain/models/chat';

interface StoreState {
  // ==================
  // Server State (SSE)
  // ==================
  kanban: KanbanData;
  workflow: WorkflowRealtimeState | null;
  chatMessages: ChatMessage[];
  
  // ==================
  // Application State
  // ==================
  projects: string[];
  selectedProject: string | undefined;
  selectedFeature: string | undefined;
  selectedFile: string | undefined;
  selectedAgent: string;  // GNB에서 선택된 Agent
  selectedJobType: 'design' | 'code' | 'learn';  // GNB에서 선택된 Job Type
  features: Feature[];
  fileTree: FileNode[];
  fileContent: FileContent | undefined;
  session: Session | undefined;
  isRunning: boolean;
  isStopping: boolean;  // ✅ Stopping state for Stop button
  userStoppedJobId: string | null;  // ✅ Track which job user explicitly stopped
  lastJobFailed: boolean;  // ✅ Track if last job failed (for retry)
  dismissedInterruptTimestamp: string | null;  // ✅ Track dismissed interruption (hide resume UI)
  
  // ✅ Job Identity
  // Single source of truth for current job ID (synced from server via Kanban SSE)
  currentJobId: string | undefined;
  
  // ✅ Job execution handle (optional, only for client-initiated jobs)
  // Used to call .kill() for client-side stop requests
  currentJob: JobExecution | null;
  connectionStatus: 'connected' | 'disconnected' | 'error';
  showConfigEditor: boolean;
  showFileEditor: boolean;
  taskStartTime: number | undefined;
  elapsedTime: number;
  currentMode: 'generate' | 'refactor' | 'explain' | undefined;
  devServerStatus: DevServerStatus | undefined;
  theme: 'light' | 'dark';
  splitLayout: 'horizontal' | 'vertical';
  viewMode: 'agents' | 'editor';  // ✅ View mode toggle (agents view / editor view)
  ideWorkspacePath: string | undefined;  // ✅ IDE workspace path (for folder parameter)
  
  // ==================
  // User Authentication (Cloud Mode)
  // ==================
  userEmail: string | undefined;
  userOrganization: string | undefined;
  
  // ==================
  // Server Configuration
  // ==================
  // Frontend Mode: Where the frontend is running (static from env)
  frontendMode: 'cloud' | 'local';
  // Backend Mode: Which backend to connect to (dynamic, user can toggle)
  backendMode: 'local' | 'cloud';
}

interface StoreActions {
  // ==================
  // SSE Update Actions
  // ==================
  updateKanban: (data: KanbanData) => void;
  updateWorkflow: (data: WorkflowRealtimeState) => void;
  addChatMessage: (message: ChatMessage) => void;
  updateChatMessage: (messageId: string, updates: Partial<ChatMessage>) => void;
  clearChatMessages: () => void;
  
  // ==================
  // SSE Lifecycle
  // ==================
  initializeSSE: () => void;
  cleanupSSE: () => void;
  reconnectSSE: (key: string) => void;
  
  // ==================
  // Application Actions
  // ==================
  setProjects: (projects: string[]) => void;
  fetchProjects: () => Promise<void>;
  setSelectedProject: (projectId: string | undefined) => void;
  setSelectedFeature: (featureName: string | undefined) => void;
  setSelectedAgent: (agent: string) => void;
  setSelectedJobType: (jobType: 'design' | 'code' | 'learn') => void;
  fetchFeatures: () => Promise<void>;
  selectFile: (filePath: string | undefined) => void;
  setFeatures: (features: Feature[]) => void;
  setFileTree: (tree: FileNode[]) => void;
  refreshFileTree: () => Promise<void>;
  setFileContent: (content: FileContent | undefined) => void;
  setSession: (session: Session | undefined) => void;
  setRunning: (isRunning: boolean, taskId?: string, mode?: 'generate' | 'refactor' | 'explain') => void;
  setStopping: (isStopping: boolean) => void;
  setLastJobFailed: (failed: boolean) => void;
  setDismissedInterruptTimestamp: (timestamp: string | null) => void;
  setCurrentJob: (job: JobExecution | null) => void;
  reset: () => void;
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'error') => void;
  setShowConfigEditor: (show: boolean) => void;
  setShowFileEditor: (show: boolean) => void;
  setDevServerStatus: (status: DevServerStatus | undefined) => void;
  refreshDevServerStatus: () => Promise<void>;
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleSplitLayout: (layout: 'horizontal' | 'vertical') => void;
  setViewMode: (mode: 'agents' | 'editor') => void;  // ✅ Set view mode
  setIdeWorkspacePath: (path: string | undefined) => void;  // ✅ Set IDE workspace path
  switchToEditorView: (workspacePath: string) => void;  // ✅ Switch to editor view with workspace path (batch update)
  
  // ==================
  // User Authentication
  // ==================
  setUser: (email: string, organization: string) => void;
  clearUser: () => void;
  
  // ==================
  // Server Configuration
  // ==================
  setBackendMode: (mode: 'local' | 'cloud') => void;
}

type Store = StoreState & StoreActions;

// LocalStorage keys
const STORAGE_KEYS = {
  RUNNING_TASK: 'ant-ui:running-task',
  TASK_START_TIME: 'ant-ui:task-start-time',
  TASK_MODE: 'ant-ui:task-mode',
  SELECTED_PROJECT: 'ant-ui:selected-project',
  SELECTED_FEATURE: 'ant-ui:selected-feature',
  SELECTED_AGENT: 'ant-ui:selected-agent',
  SELECTED_JOB_TYPE: 'ant-ui:selected-job-type',
  THEME: 'ant-ui:theme',
  VIEW_MODE: 'ant-ui:view-mode',
  USER_EMAIL: 'ant-ui:user-email',
  USER_ORGANIZATION: 'ant-ui:user-organization',
  BACKEND_MODE: 'ant-ui:backend-mode',
  DISMISSED_INTERRUPT_TIMESTAMP: 'ant-ui:dismissed-interrupt-timestamp',
};

// Helper functions for localStorage
const saveToStorage = (key: string, value: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error('Failed to save to localStorage:', error);
  }
};

const loadFromStorage = (key: string): any => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : undefined;
  } catch (error) {
    console.error('Failed to load from localStorage:', error);
    return undefined;
  }
};

const removeFromStorage = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error('Failed to remove from localStorage:', error);
  }
};

// Helper to get initial theme from localStorage or system preference
const getInitialTheme = (): 'light' | 'dark' => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.THEME);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch (error) {
    console.error('Failed to read theme from localStorage:', error);
  }
  
  // Fallback to system preference
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  
  return 'light';
};

// Apply theme to document
const applyTheme = (theme: 'light' | 'dark') => {
  if (typeof document !== 'undefined') {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }
};

// ✅ Centralized initialization for all localStorage-persisted state
function initializePersistentState() {
  const theme = getInitialTheme();
  const viewMode = (loadFromStorage(STORAGE_KEYS.VIEW_MODE) as 'agents' | 'editor') || 'agents';
  const userEmail = loadFromStorage(STORAGE_KEYS.USER_EMAIL);
  const userOrganization = loadFromStorage(STORAGE_KEYS.USER_ORGANIZATION);
  const selectedAgent = loadFromStorage(STORAGE_KEYS.SELECTED_AGENT) || 'architect';
  const selectedJobType = (loadFromStorage(STORAGE_KEYS.SELECTED_JOB_TYPE) as 'design' | 'code' | 'learn') || 'code';
  const dismissedInterruptTimestamp = loadFromStorage(STORAGE_KEYS.DISMISSED_INTERRUPT_TIMESTAMP);
  
  const storedBackendMode = loadFromStorage(STORAGE_KEYS.BACKEND_MODE);
  const frontendMode = (import.meta.env.VITE_FRONTEND_MODE || 'local') as 'local' | 'cloud';
  const backendMode = storedBackendMode || (import.meta.env.VITE_TARGET_BACKEND_MODE || frontendMode) as 'local' | 'cloud';
  
  return {
    theme,
    viewMode,
    userEmail,
    userOrganization,
    selectedAgent,
    selectedJobType,
    dismissedInterruptTimestamp,
    backendMode,
    frontendMode,
  };
}

export const useStore = create<Store>((set, get) => {
  const persistent = initializePersistentState();
  
  return {
  // ==================
  // Initial State
  // ==================
  kanban: { jobId: undefined, todo: [], inProgress: null, completed: [] },
  workflow: null,
  chatMessages: [],
  
  projects: [],
  selectedProject: undefined,
  selectedFeature: undefined,
  selectedFile: undefined,
  selectedAgent: persistent.selectedAgent,
  selectedJobType: persistent.selectedJobType,
  features: [],
  fileTree: [],
  fileContent: undefined,
  session: undefined,
  isRunning: false,
  isStopping: false,
  userStoppedJobId: null,
  lastJobFailed: false,
  dismissedInterruptTimestamp: persistent.dismissedInterruptTimestamp,
  currentJobId: undefined,
  currentJob: null,
  connectionStatus: 'disconnected',
  showConfigEditor: false,
  showFileEditor: false,
  taskStartTime: undefined,
  elapsedTime: 0,
  currentMode: undefined,
  devServerStatus: undefined,
  theme: persistent.theme,
  splitLayout: 'vertical',
  viewMode: persistent.viewMode,
  ideWorkspacePath: undefined,
  
  // User Authentication (Cloud Mode)
  userEmail: persistent.userEmail,
  userOrganization: persistent.userOrganization,
  
  // Server Configuration
  frontendMode: persistent.frontendMode,
  backendMode: persistent.backendMode,

  // ==================
  // SSE Update Actions
  // ==================
  updateKanban: (data) => {
    const state = get();
    
    // ✅ CRITICAL: Always sync jobId from KanbanData
    // This ensures job type changes (design → code) update the displayed jobId
    const kanbanJobId = data.jobId;
    
    // ✅ Determine if job is running based on dataSource
    // - 'live' or 'estimating' = job is running
    // - 'session' = job is completed/paused/stopped
    const isJobRunning = data.dataSource === 'live' || data.dataSource === 'estimating';
    
    // ✅ Job completion detected
    if (!isJobRunning && state.isRunning) {
      // ✅ CRITICAL: Don't auto-stop if interruption was dismissed (user clicked Resume)
      // Resume flow: user dismisses interruption → resumeJob API → live data arrives
      // During this transition, session data with interruption may arrive
      const interruptionWasDismissed = 
        data.interruption?.timestamp && 
        data.interruption.timestamp === state.dismissedInterruptTimestamp;
      
      if (interruptionWasDismissed) {
        console.log('[Store] ⏸️ Ignoring session data - interruption was dismissed (Resume in progress)');
        console.log(`   Interruption timestamp: ${data.interruption?.timestamp}`);
        console.log(`   Dismissed timestamp: ${state.dismissedInterruptTimestamp}`);
        // ✅ Update kanban data but keep isRunning: true
        set({ kanban: data });
        return;
      }
      
      console.log('[Store] 🏁 Job completed detected via Kanban update');
      console.log(`   DataSource: ${data.dataSource}`);
      console.log(`   Job ID from Kanban: ${kanbanJobId}`);
      console.log(`   Current Job ID in store: ${state.currentJobId}`);
      console.log(`   Has interruption: ${!!data.interruption}`);
      console.log(`   Interruption reason: ${data.interruption?.reason || 'none'}`);
      console.log('   Setting isRunning: false');
      
      set({ 
        kanban: data,
        // ✅ SSOT: Always sync jobId from server (single source of truth)
        currentJobId: kanbanJobId,
        isRunning: false,
        currentMode: undefined
      });
    }
    // ✅ Job running detected (e.g. after refresh)
    else if (isJobRunning && !state.isRunning) {
      // ✅ CRITICAL: Don't auto-restore if user explicitly stopped this job
      if (state.userStoppedJobId === kanbanJobId) {
        console.log('[Store] 🚫 Skipping auto-restore - user explicitly stopped job:', kanbanJobId);
        set({ 
          kanban: data,
          currentJobId: kanbanJobId
        });
        return;
      }
      
      console.log('[Store] 🔄 Active job detected via Kanban update');
      console.log(`   DataSource: ${data.dataSource}`);
      console.log(`   Job ID: ${kanbanJobId}`);
      console.log('   Setting isRunning: true');
      
      set({ 
        kanban: data,
        currentJobId: kanbanJobId,  // ✅ Sync jobId
        isRunning: true
      });
    }
    // ✅ Normal update (including job type change)
    else {
      // ✅ CRITICAL: Always sync jobId (including undefined)
      // This handles job type changes (design → code)
      if (kanbanJobId !== state.currentJobId) {
        console.log('[Store] 🔄 Job ID changed via Kanban update');
        console.log(`   Previous: ${state.currentJobId}`);
        console.log(`   New: ${kanbanJobId || 'undefined'}`);
        
        set({ 
          kanban: data,
          currentJobId: kanbanJobId
        });
      } else {
        set({ kanban: data });
      }
    }
  },
  
  updateWorkflow: (data) => {
    console.log('[Store] 🔄 updateWorkflow:', {
      currentNode: data.currentNode,
      previousNode: data.previousNode
    });
    set({ workflow: data });
  },
  
  addChatMessage: (message) => {
    set((state) => ({
      chatMessages: [...state.chatMessages, message]
    }));
  },
  
  updateChatMessage: (messageId, updates) => {
    set((state) => ({
      chatMessages: state.chatMessages.map(msg =>
        msg.id === messageId ? { ...msg, ...updates } : msg
      )
    }));
  },
  
  clearChatMessages: () => {
    set({ chatMessages: [] });
  },

  // ==================
  // SSE Lifecycle
  // ==================
  initializeSSE: () => {
    const state = get();
    console.log('[Store] 🚀 Initializing unified SSE connection...');
    console.log('[Store] Current state:', {
      selectedProject: state.selectedProject,
      selectedFeature: state.selectedFeature,
      selectedJobType: state.selectedJobType
    });
    
    if (!state.selectedProject || !state.selectedFeature) {
      console.warn('[Store] ⚠️  Cannot initialize SSE: missing project/feature');
      return;
    }
    
    // ✅ Job type is now guaranteed to be valid (typed as 'design' | 'code' | 'learn')
    const jobType = state.selectedJobType;
    console.log('[Store] 🎯 Using job type:', jobType);
    
    // ✅ Clear existing handlers to prevent duplicates
    sseManager.clearHandlers();
    
    // ✅ Register message handlers
    sseManager.registerHandler('kanban', (data) => {
      console.log('[Store] 📊 Kanban update received:', data);
      get().updateKanban(data);
    });
    
    sseManager.registerHandler('chat', (event) => {
      console.log('[Store] 💬 Chat SSE event:', event.type);
      
      switch (event.type) {
        case 'initial_state':
          console.log('[Store] 💬 Loading initial chat messages:', event.messages.length);
          set({ chatMessages: event.messages });
          break;
          
        case 'user_message':
          console.log('[Store] 💬 Adding user message');
          get().addChatMessage(event.message);
          break;
          
        case 'message_start':
          console.log('[Store] 💬 Starting assistant message');
          get().addChatMessage(event.message);
          break;
          
        case 'content_add':
          console.log('[Store] 💬 Adding content to message:', event.messageId);
          get().updateChatMessage(event.messageId, {
            contents: [...(get().chatMessages.find(m => m.id === event.messageId)?.contents || []), event.content]
          });
          break;
          
        case 'content_update':
          console.log('[Store] 💬 Updating content in message:', event.messageId, 'index:', event.contentIndex);
          const message = get().chatMessages.find(m => m.id === event.messageId);
          if (message) {
            const updatedContents = [...message.contents];
            updatedContents[event.contentIndex] = event.content;
            // ✅ Set isStreaming=true when receiving content updates (for refresh/reconnect)
            get().updateChatMessage(event.messageId, { 
              contents: updatedContents,
              isStreaming: true 
            });
          }
          break;
          
        case 'content_delete':
          console.log('[Store] 🗑️  Deleting content from message:', event.messageId, 'index:', event.contentIndex);
          const deleteMessage = get().chatMessages.find(m => m.id === event.messageId);
          if (deleteMessage) {
            const deletedContents = [...deleteMessage.contents];
            deletedContents.splice(event.contentIndex, 1);
            get().updateChatMessage(event.messageId, { 
              contents: deletedContents,
              isStreaming: true 
            });
          }
          break;
          
        case 'message_complete':
          console.log('[Store] 💬 Completing message:', event.messageId);
          get().updateChatMessage(event.messageId, { isStreaming: false });
          break;
          
        default:
          console.warn('[Store] 💬 Unknown chat event type:', event.type);
      }
    });
    
    sseManager.registerHandler('fileTree', (data) => {
      console.log('[Store] 📂 FileTree SSE event received:', data.type);
      if (data.type === 'initial' || data.type === 'update') {
        const tree = data.tree || data.fileTree;
        console.log(`[Store] 📂 Setting file tree: ${tree?.length || 0} items`);
        get().setFileTree(tree);
      }
    });
    
    sseManager.registerHandler('workflow', (data) => {
      get().updateWorkflow(data);
    });
    
    // ✅ Connect to unified SSE endpoint
    sseManager.connect(state.selectedProject, state.selectedFeature, jobType);
    
    // ✅ Connect workflow SSE if job is running
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
    
    // ✅ For unified SSE, reinitialize to ensure handlers are registered
    if (key === 'kanban' || key === 'chat' || key === 'fileTree') {
      // Disconnect and reinitialize (which will register handlers + reconnect)
      sseManager.disconnect();
      get().initializeSSE();
    } 
    // ✅ For workflow SSE, reconnect per-job connection
    else if (key === 'workflow' && state.currentJobId) {
      sseManager.disconnectWorkflow(state.currentJobId);
      sseManager.connectWorkflow(state.currentJobId);
    }
  },

  // ==================
  // Application Actions (기존 로직 유지)
  // ==================
  setProjects: (projects: string[]) => {
    set({ projects });
  },

  fetchProjects: async () => {
    try {
      const { listProjects } = await import('@/infrastructure/http/projects');
      const projectList = await listProjects();
      set({ projects: projectList });
    } catch (error) {
      console.error('Failed to fetch projects:', error);
      set({ projects: [] });
    }
  },

  setSelectedProject: (projectId: string | undefined) => {
    if (!projectId) {
      set({ 
        selectedProject: undefined,
        selectedFeature: undefined,
        selectedFile: undefined,
        features: [],
        fileTree: [],
        fileContent: undefined,
      });
      removeFromStorage(STORAGE_KEYS.SELECTED_PROJECT);
      removeFromStorage(STORAGE_KEYS.SELECTED_FEATURE);
    } else {
      set({ 
        selectedProject: projectId,
        selectedFeature: undefined,
        selectedFile: undefined,
        features: [],
        fileTree: [],
        fileContent: undefined,
      });
      saveToStorage(STORAGE_KEYS.SELECTED_PROJECT, projectId);
      removeFromStorage(STORAGE_KEYS.SELECTED_FEATURE);
      get().fetchFeatures();
    }
  },

  setSelectedFeature: (featureName: string | undefined) => {
    set({ 
      selectedFeature: featureName,
      selectedFile: undefined,
      fileTree: [],
      fileContent: undefined,
    });
    
    if (featureName) {
      saveToStorage(STORAGE_KEYS.SELECTED_FEATURE, featureName);
      
      // Load session.json when feature is selected
      const { selectedProject, selectedJobType } = get();
      if (selectedProject) {
        (async () => {
          try {
            const { fetchFeatureSession } = await import('@/infrastructure/http/api');
            
            // ✅ Simply load session for the currently selected job type
            // User's current selection is the source of truth
            console.log(`[Store] 📂 Loading session for job type: ${selectedJobType}`);
            const session = await fetchFeatureSession(selectedProject, featureName, selectedJobType);
            
            if (session) {
              console.log(`[Store] ✅ Session loaded for ${selectedJobType}:`, {
                hasJobId: !!session?.state?.jobId,
                taskCount: session?.state?.taskQueue?.length || 0,
                completedCount: session?.state?.completedTasks?.length || 0
              });
            } else {
              console.log(`[Store] ℹ️ No session found for ${selectedJobType}`);
            }
            
            set({ session: session || undefined });
          } catch (error) {
            console.error('[Store] Failed to load session:', error);
            set({ session: undefined });
          }
        })();
      }
      
      // SSE 초기화
      get().initializeSSE();
    } else {
      removeFromStorage(STORAGE_KEYS.SELECTED_FEATURE);
      set({ session: undefined });
    }
  },

  setSelectedAgent: (agent: string) => {
    set({ selectedAgent: agent });
    saveToStorage(STORAGE_KEYS.SELECTED_AGENT, agent);
  },

  setSelectedJobType: (jobType: 'design' | 'code' | 'learn') => {
    const state = get();
    set({ selectedJobType: jobType });
    saveToStorage(STORAGE_KEYS.SELECTED_JOB_TYPE, jobType);
    
    // ✅ CRITICAL: Reload session for new job type
    if (state.selectedProject && state.selectedFeature) {
      console.log(`[Store] 🔄 Job type changed to '${jobType}', reloading session...`);
      
      (async () => {
        try {
          const { fetchFeatureSession } = await import('@/infrastructure/http/api');
          const session = await fetchFeatureSession(state.selectedProject!, state.selectedFeature!, jobType);
          set({ session: session || undefined });
          console.log(`[Store] ✅ Session loaded for ${jobType}`);
        } catch (error) {
          console.error('[Store] Failed to reload session:', error);
          set({ session: undefined });
        }
      })();
      
      // ✅ Reconnect SSE to fetch new job type's kanban/workflow data
      get().reconnectSSE('kanban');
    }
  },

  fetchFeatures: async () => {
    const { selectedProject } = get();
    if (!selectedProject) return;
    
    try {
      const { fetchFeatures: apiFetchFeatures } = await import('@/infrastructure/http/api');
      const featureList = await apiFetchFeatures(selectedProject);
      set({ features: featureList });
    } catch (error) {
      console.error('Failed to fetch features:', error);
      set({ features: [] });
    }
  },

  selectFile: (filePath: string | undefined) => {
    if (filePath === undefined) {
      // 명시적으로 선택 해제
      set({ selectedFile: undefined });
    } else {
      const { selectedFile } = get();
      // Toggle: 같은 파일을 다시 클릭하면 선택 해제
      if (selectedFile === filePath) {
        set({ selectedFile: undefined });
      } else {
        set({ selectedFile: filePath });
      }
    }
  },

  setFeatures: (features: Feature[]) => {
    set({ features });
  },

  setFileTree: (tree: FileNode[]) => {
    set({ fileTree: tree });
  },

  refreshFileTree: async () => {
    const state = get();
    const { selectedProject, selectedFeature } = state;
    
    if (!selectedProject || !selectedFeature) return;
    
    try {
      const { fetchFileTree } = await import('@/infrastructure/http/api');
      const tree = await fetchFileTree(selectedProject, selectedFeature);
      set({ fileTree: tree });
    } catch (error) {
      console.error('Failed to refresh file tree:', error);
    }
  },

  setFileContent: (content: FileContent | undefined) => {
    set({ fileContent: content });
  },

  setSession: (session: Session | undefined) => {
    set({ session });
  },

  setRunning: (isRunning: boolean, jobId?: string, mode?: 'generate' | 'refactor' | 'explain') => {
    const startTime = isRunning ? Date.now() : undefined;
    const prevJobId = get().currentJobId;
    
    // ✅ CRITICAL: Disconnect previous workflow SSE if jobId is changing
    if (isRunning && jobId && prevJobId && prevJobId !== jobId) {
      console.log(`[Store] 🔄 JobId changing: ${prevJobId} → ${jobId}, reconnecting SSE...`);
      sseManager.disconnectWorkflow(prevJobId);
    }
    
    set({ 
      isRunning,
      currentJobId: isRunning ? jobId : undefined,
      taskStartTime: startTime,
      elapsedTime: isRunning ? 0 : get().elapsedTime,
      currentMode: isRunning ? mode : undefined,
      userStoppedJobId: isRunning ? null : get().userStoppedJobId,
      // ✅ Only reset lastJobFailed when starting a new job, not when stopping
      ...(isRunning ? { lastJobFailed: false } : {})
    });

    if (isRunning && jobId) {
      saveToStorage(STORAGE_KEYS.RUNNING_TASK, jobId);
      saveToStorage(STORAGE_KEYS.TASK_START_TIME, startTime);
      if (mode) {
        saveToStorage(STORAGE_KEYS.TASK_MODE, mode);
      }
      
      // ✅ Connect Workflow SSE using new unified manager
      console.log('[Store] 🔗 Connecting workflow SSE for jobId:', jobId);
      sseManager.connectWorkflow(jobId);
    } else {
      removeFromStorage(STORAGE_KEYS.RUNNING_TASK);
      removeFromStorage(STORAGE_KEYS.TASK_START_TIME);
      removeFromStorage(STORAGE_KEYS.TASK_MODE);
      
      // ✅ Disconnect Workflow SSE when stopping
      if (prevJobId) {
        console.log('[Store] 🔌 Disconnecting workflow SSE for jobId:', prevJobId);
        sseManager.disconnectWorkflow(prevJobId);
      }
    }
  },

  setStopping: (isStopping: boolean) => {
    set({ isStopping });
  },

  setLastJobFailed: (failed: boolean) => {
    set({ lastJobFailed: failed });
  },

  setDismissedInterruptTimestamp: (timestamp: string | null) => {
    set({ dismissedInterruptTimestamp: timestamp });
  },

  setCurrentJob: (job: JobExecution | null) => {
    set({ currentJob: job });
  },

  setConnectionStatus: (status: 'connected' | 'disconnected' | 'error') => {
    set({ connectionStatus: status });
  },

  setShowConfigEditor: (show: boolean) => {
    set({ showConfigEditor: show });
  },

  setShowFileEditor: (show: boolean) => {
    set({ showFileEditor: show });
  },

  setDevServerStatus: (status: DevServerStatus | undefined) => {
    set({ devServerStatus: status });
  },

  refreshDevServerStatus: async () => {
    const { selectedProject } = get();
    if (!selectedProject) return;
    
    try {
      const { getDevServerStatus } = await import('@/infrastructure/http/api');
      const status = await getDevServerStatus(selectedProject);
      set({ devServerStatus: status });
    } catch (error) {
      console.error('Failed to refresh dev server status:', error);
      set({ devServerStatus: undefined });
    }
  },

  reset: () => {
    set({
      kanban: { jobId: undefined, todo: [], inProgress: null, completed: [] },
      workflow: null,
      selectedProject: undefined,
      selectedFeature: undefined,
      // ✅ Keep UI preferences (agent, jobType) - user settings persist across logout
      // selectedAgent: user's last choice
      // selectedJobType: user's last choice
      session: undefined,
      isRunning: false,
      isStopping: false,
      userStoppedJobId: null,
      lastJobFailed: false,
      currentJobId: undefined,
      currentJob: null,
      connectionStatus: 'disconnected',
    });
    
    // ✅ Clear job-related localStorage (transient data)
    removeFromStorage(STORAGE_KEYS.RUNNING_TASK);
    removeFromStorage(STORAGE_KEYS.TASK_START_TIME);
    removeFromStorage(STORAGE_KEYS.TASK_MODE);
    removeFromStorage(STORAGE_KEYS.DISMISSED_INTERRUPT_TIMESTAMP);
    
    // ✅ Keep UI preferences in localStorage (agent, jobType)
    // User's last selection should persist across logout/login
  },

  toggleTheme: () => {
    const current = get().theme;
    const newTheme = current === 'light' ? 'dark' : 'light';
    set({ theme: newTheme });
    saveToStorage(STORAGE_KEYS.THEME, newTheme);
    applyTheme(newTheme);
  },

  setTheme: (theme: 'light' | 'dark') => {
    set({ theme });
    saveToStorage(STORAGE_KEYS.THEME, theme);
    applyTheme(theme);
  },

  toggleSplitLayout: (layout: 'horizontal' | 'vertical') => {
    set({ splitLayout: layout });
  },
  
  // ==================
  // View Mode
  // ==================
  setViewMode: (mode: 'agents' | 'editor') => {
    set({ viewMode: mode });
    saveToStorage(STORAGE_KEYS.VIEW_MODE, mode);
  },
  
  // ==================
  // IDE Workspace Path
  // ==================
  setIdeWorkspacePath: (path: string | undefined) => {
    set({ ideWorkspacePath: path });
  },
  
  // ✅ Switch to editor view with workspace path (batch update to prevent double render)
  switchToEditorView: (workspacePath: string) => {
    set({ 
      ideWorkspacePath: workspacePath,
      viewMode: 'editor'
    });
    saveToStorage(STORAGE_KEYS.VIEW_MODE, 'editor');
  },
  
  // ==================
  // User Authentication
  // ==================
  setUser: (email: string, organization: string) => {
    set({ userEmail: email, userOrganization: organization });
    saveToStorage(STORAGE_KEYS.USER_EMAIL, email);
    saveToStorage(STORAGE_KEYS.USER_ORGANIZATION, organization);
  },
  
  clearUser: () => {
    set({ userEmail: undefined, userOrganization: undefined });
    removeFromStorage(STORAGE_KEYS.USER_EMAIL);
    removeFromStorage(STORAGE_KEYS.USER_ORGANIZATION);
  },
  
  // ==================
  // Server Configuration
  // ==================
  setBackendMode: (mode: 'local' | 'cloud') => {
    set({ backendMode: mode });
    saveToStorage(STORAGE_KEYS.BACKEND_MODE, mode);
    console.log('[Store] Backend mode changed to:', mode);
    
    // Clear user session when switching modes
    const store = useStore.getState();
    if (store.userEmail) {
      store.clearUser();
    }
    // Clear projects when switching modes
    set({ projects: [], selectedProject: undefined, selectedFeature: undefined });
  },
}});

// Apply initial theme on load
applyTheme(getInitialTheme());
