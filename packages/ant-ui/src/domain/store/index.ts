import { create } from 'zustand';
import { Session } from '@/domain/models/session';
import { LogEntry } from '@/domain/models/log';
import { Feature, FileNode, FileContent, DevServerStatus, KanbanData } from '@/infrastructure/http/api';
import { subscribeToLogs } from '@/infrastructure/http/api';
import { JobExecution } from '@/infrastructure/http/cli';
import { CircularLogBuffer } from '@/shared/utils/CircularLogBuffer';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import type { WorkflowRealtimeState } from '@/domain/models/workflow';
import type { ChatMessage } from '@/domain/models/chat';

// ✅ Circular buffer for efficient log storage
const logBuffer = new CircularLogBuffer(2000);  // 최대 2000개 로그

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4100/api';

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
  selectedWorkType: string;  // GNB에서 선택된 Work Type (code/design/etc)
  features: Feature[];
  fileTree: FileNode[];
  fileContent: FileContent | undefined;
  session: Session | undefined;
  logsVersion: number;  // ✅ 로그 변경 알림용 (증가만 함)
  isRunning: boolean;
  isStopping: boolean;  // ✅ Stopping state for Stop button
  userStoppedJobId: string | null;  // ✅ Track which job user explicitly stopped
  lastJobFailed: boolean;  // ✅ Track if last job failed (for retry)
  currentJobId: string | undefined;
  currentJob: JobExecution | null;
  activeTasks: Map<string, EventSource>;
  connectionStatus: 'connected' | 'disconnected' | 'error';
  showConfigEditor: boolean;
  showFileEditor: boolean;
  taskStartTime: number | undefined;
  elapsedTime: number;
  currentMode: 'generate' | 'refactor' | 'explain' | undefined;
  devServerStatus: DevServerStatus | undefined;
  theme: 'light' | 'dark';
  splitLayout: 'horizontal' | 'vertical';
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
  selectProject: (projectId: string) => void;
  setSelectedProject: (projectId: string | undefined) => void;
  selectFeature: (featureName: string) => void;
  setSelectedFeature: (featureName: string | undefined) => void;
  setSelectedAgent: (agent: string) => void;
  setSelectedWorkType: (workType: string) => void;
  fetchFeatures: () => Promise<void>;
  selectFile: (filePath: string) => void;
  setFeatures: (features: Feature[]) => void;
  setFileTree: (tree: FileNode[]) => void;
  refreshFileTree: () => Promise<void>;
  setFileContent: (content: FileContent | undefined) => void;
  setSession: (session: Session | undefined) => void;
  addLog: (log: LogEntry) => void;
  getLogs: () => LogEntry[];
  setRunning: (isRunning: boolean, taskId?: string, mode?: 'generate' | 'refactor' | 'explain') => void;
  setStopping: (isStopping: boolean) => void;
  setLastJobFailed: (failed: boolean) => void;
  setCurrentJob: (job: JobExecution | null) => void;
  clearLogs: () => void;
  reset: () => void;
  startLogStream: (taskId: string) => void;
  stopLogStream: (taskId: string) => void;
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'error') => void;
  setShowConfigEditor: (show: boolean) => void;
  setShowFileEditor: (show: boolean) => void;
  setDevServerStatus: (status: DevServerStatus | undefined) => void;
  refreshDevServerStatus: () => Promise<void>;
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleSplitLayout: (layout: 'horizontal' | 'vertical') => void;
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
  SELECTED_WORK_TYPE: 'ant-ui:selected-work-type',
  THEME: 'ant-ui:theme',
};

// Helper functions for localStorage
const saveToStorage = (key: string, value: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error('Failed to save to localStorage:', error);
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

export const useStore = create<Store>((set, get) => ({
  // ==================
  // Initial State
  // ==================
  kanban: { todo: [], inProgress: null, completed: [] },
  workflow: null,
  chatMessages: [],
  
  projects: [],
  selectedProject: undefined,
  selectedFeature: undefined,
  selectedFile: undefined,
  selectedAgent: 'architect',
  selectedWorkType: 'code',
  features: [],
  fileTree: [],
  fileContent: undefined,
  session: undefined,
  logsVersion: 0,
  isRunning: false,
  isStopping: false,
  userStoppedJobId: null,
  lastJobFailed: false,
  currentJobId: undefined,
  currentJob: null,
  activeTasks: new Map<string, EventSource>(),
  connectionStatus: 'disconnected',
  showConfigEditor: false,
  showFileEditor: false,
  taskStartTime: undefined,
  elapsedTime: 0,
  currentMode: undefined,
  devServerStatus: undefined,
  theme: getInitialTheme(),
  splitLayout: 'vertical',

  // ==================
  // SSE Update Actions
  // ==================
  updateKanban: (data) => {
    const state = get();
    
    // ✅ Job 완료 감지: activeJobId가 undefined로 변경되고 현재 실행 중이면
    if (!data.activeJobId && state.isRunning && state.currentJobId) {
      console.log('[Store] 🏁 Job completed detected via Kanban update');
      console.log('   Previous jobId:', state.currentJobId);
      console.log('   Setting isRunning: false');
      
      set({ 
        kanban: data,
        isRunning: false,
        currentMode: undefined
      });
    } else {
      set({ kanban: data });
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
    console.log('[Store] 🚀 Initializing SSE connections...');
    
    // Kanban SSE
    if (state.selectedProject && state.selectedFeature) {
      const kanbanUrl = `${API_BASE}/projects/${state.selectedProject}/features/${state.selectedFeature}/kanban/stream`;
      sseManager.connect('kanban', kanbanUrl, (data) => {
        get().updateKanban(data);
      });
    }
    
    // Workflow SSE
    if (state.currentJobId) {
      const workflowUrl = `${API_BASE}/jobs/${state.currentJobId}/workflow/stream`;
      sseManager.connect('workflow', workflowUrl, (data) => {
        get().updateWorkflow(data);
      });
    }
    
    // Chat SSE
    if (state.selectedProject && state.selectedFeature) {
      const chatUrl = `${API_BASE}/projects/${state.selectedProject}/features/${state.selectedFeature}/chat/stream`;
      sseManager.connect('chat', chatUrl, (event) => {
        console.log('[Store] 💬 Chat SSE event:', event.type);
        
        switch (event.type) {
          case 'initial_state':
            // 초기 상태 로드 (기존 메시지들)
            console.log('[Store] 💬 Loading initial chat messages:', event.messages.length);
            set({ chatMessages: event.messages });
            break;
            
          case 'user_message':
            // 사용자 메시지 추가
            console.log('[Store] 💬 Adding user message');
            get().addChatMessage(event.message);
            break;
            
          case 'message_start':
            // 어시스턴트 메시지 시작
            console.log('[Store] 💬 Starting assistant message');
            get().addChatMessage(event.message);
            break;
            
          case 'content_add':
            // 새 content 추가
            console.log('[Store] 💬 Adding content to message:', event.messageId);
            get().updateChatMessage(event.messageId, {
              contents: [...(get().chatMessages.find(m => m.id === event.messageId)?.contents || []), event.content]
            });
            break;
            
          case 'content_update':
            // 기존 content 업데이트
            console.log('[Store] 💬 Updating content in message:', event.messageId, 'index:', event.contentIndex);
            const message = get().chatMessages.find(m => m.id === event.messageId);
            if (message) {
              const updatedContents = [...message.contents];
              updatedContents[event.contentIndex] = event.content;
              get().updateChatMessage(event.messageId, { contents: updatedContents });
            }
            break;
            
          case 'message_complete':
            // 메시지 완료
            console.log('[Store] 💬 Completing message:', event.messageId);
            get().updateChatMessage(event.messageId, { isComplete: true });
            break;
            
          default:
            console.warn('[Store] 💬 Unknown chat event type:', event.type);
        }
      });
    }
    
    // FileTree SSE
    if (state.selectedProject && state.selectedFeature) {
      const fileTreeUrl = `${API_BASE}/projects/${state.selectedProject}/features/${state.selectedFeature}/files/stream`;
      sseManager.connect('fileTree', fileTreeUrl, (data) => {
        if (data.type === 'initial' || data.type === 'update') {
          get().setFileTree(data.fileTree);
        }
      });
    }
    
    set({ connectionStatus: 'connected' });
    console.log('[Store] ✅ SSE connections initialized');
  },
  
  cleanupSSE: () => {
    console.log('[Store] 🧹 Cleaning up SSE connections...');
    sseManager.disconnectAll();
    set({ connectionStatus: 'disconnected' });
    console.log('[Store] ✅ SSE connections cleaned up');
  },
  
  reconnectSSE: (key) => {
    const state = get();
    console.log(`[Store] 🔄 Reconnecting SSE: ${key}`);
    
    // 기존 연결 종료
    sseManager.disconnect(key);
    
    // 새 연결 생성
    if (key === 'kanban' && state.selectedProject && state.selectedFeature) {
      const url = `${API_BASE}/projects/${state.selectedProject}/features/${state.selectedFeature}/kanban/stream`;
      sseManager.connect('kanban', url, (data) => {
        get().updateKanban(data);
      });
    } else if (key === 'workflow' && state.currentJobId) {
      const url = `${API_BASE}/jobs/${state.currentJobId}/workflow/stream`;
      sseManager.connect('workflow', url, (data) => {
        get().updateWorkflow(data);
      });
    } else if (key === 'chat' && state.selectedProject && state.selectedFeature) {
      const url = `${API_BASE}/projects/${state.selectedProject}/features/${state.selectedFeature}/chat/stream`;
      sseManager.connect('chat', url, (event) => {
        console.log('[Store] 💬 Chat SSE event (reconnect):', event.type);
        
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
              get().updateChatMessage(event.messageId, { contents: updatedContents });
            }
            break;
          case 'message_complete':
            console.log('[Store] 💬 Completing message:', event.messageId);
            get().updateChatMessage(event.messageId, { isComplete: true });
            break;
          default:
            console.warn('[Store] 💬 Unknown chat event type:', event.type);
        }
      });
    } else if (key === 'fileTree' && state.selectedProject && state.selectedFeature) {
      const url = `${API_BASE}/projects/${state.selectedProject}/features/${state.selectedFeature}/files/stream`;
      sseManager.connect('fileTree', url, (data) => {
        if (data.type === 'initial' || data.type === 'update') {
          get().setFileTree(data.fileTree);
        }
      });
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

  selectProject: (projectId: string) => {
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
    
    // SSE 재연결
    if (get().selectedFeature) {
      get().reconnectSSE('kanban');
      get().reconnectSSE('chat');
      get().reconnectSSE('fileTree');
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

  selectFeature: (featureName: string) => {
    set({ 
      selectedFeature: featureName,
      selectedFile: undefined,
      fileTree: [],
      fileContent: undefined,
    });
    
    saveToStorage(STORAGE_KEYS.SELECTED_FEATURE, featureName);
    
    // SSE 재연결
    get().reconnectSSE('kanban');
    get().reconnectSSE('chat');
    get().reconnectSSE('fileTree');
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
      const { selectedProject, selectedWorkType } = get();
      if (selectedProject) {
        (async () => {
          try {
            const { fetchFeatureSession } = await import('@/infrastructure/http/api');
            const job = (selectedWorkType as 'design' | 'code' | 'learn') || 'code';
            const session = await fetchFeatureSession(selectedProject, featureName, job);
            set({ session: session || undefined });
          } catch (error) {
            console.error('Failed to load session:', error);
            set({ session: undefined });
          }
        })();
      }
      
      // SSE 재연결
      get().reconnectSSE('kanban');
      get().reconnectSSE('chat');
      get().reconnectSSE('fileTree');
    } else {
      removeFromStorage(STORAGE_KEYS.SELECTED_FEATURE);
      set({ session: undefined });
    }
  },

  setSelectedAgent: (agent: string) => {
    set({ selectedAgent: agent });
    saveToStorage(STORAGE_KEYS.SELECTED_AGENT, agent);
  },

  setSelectedWorkType: (workType: string) => {
    set({ selectedWorkType: workType });
    saveToStorage(STORAGE_KEYS.SELECTED_WORK_TYPE, workType);
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

  selectFile: (filePath: string) => {
    set({ selectedFile: filePath });
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

  addLog: (log: LogEntry) => {
    logBuffer.add(log);
    set((state) => ({ logsVersion: state.logsVersion + 1 }));
  },

  getLogs: () => {
    return logBuffer.getAll();
  },

  setRunning: (isRunning: boolean, jobId?: string, mode?: 'generate' | 'refactor' | 'explain') => {
    const startTime = isRunning ? Date.now() : undefined;
    
    set({ 
      isRunning,
      currentJobId: isRunning ? jobId : undefined,
      taskStartTime: startTime,
      elapsedTime: isRunning ? 0 : get().elapsedTime,
      currentMode: isRunning ? mode : undefined,
      userStoppedJobId: isRunning ? null : get().userStoppedJobId,
      lastJobFailed: false
    });

    if (isRunning && jobId) {
      saveToStorage(STORAGE_KEYS.RUNNING_TASK, jobId);
      saveToStorage(STORAGE_KEYS.TASK_START_TIME, startTime);
      if (mode) {
        saveToStorage(STORAGE_KEYS.TASK_MODE, mode);
      }
      
      // ✅ 기존 연결이 있으면 먼저 종료
      sseManager.disconnect('workflow');
      
      // ✅ Workflow SSE 연결 - jobId를 직접 사용
      console.log('[Store] 🔗 Connecting workflow SSE for jobId:', jobId);
      const workflowUrl = `${API_BASE}/jobs/${jobId}/workflow/stream`;
      sseManager.connect('workflow', workflowUrl, (data) => {
        get().updateWorkflow(data);
      });
    } else {
      removeFromStorage(STORAGE_KEYS.RUNNING_TASK);
      removeFromStorage(STORAGE_KEYS.TASK_START_TIME);
      removeFromStorage(STORAGE_KEYS.TASK_MODE);
      
      // Workflow SSE 종료
      console.log('[Store] 🔌 Disconnecting workflow SSE');
      sseManager.disconnect('workflow');
    }
  },

  setStopping: (isStopping: boolean) => {
    set({ isStopping });
  },

  setLastJobFailed: (failed: boolean) => {
    set({ lastJobFailed: failed });
  },

  setCurrentJob: (job: JobExecution | null) => {
    set({ currentJob: job });
  },

  clearLogs: () => {
    logBuffer.clear();
    set({ logsVersion: 0 });
  },

  startLogStream: (taskId: string) => {
    const state = get();
    
    if (state.activeTasks.has(taskId)) {
      console.warn(`Log stream for task ${taskId} is already active`);
      return;
    }

    try {
      const eventSource = subscribeToLogs(taskId, (log: LogEntry) => {
        get().addLog(log);
      });

      eventSource.onopen = () => {
        set({ connectionStatus: 'connected' });
      };

      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        set({ connectionStatus: 'error' });
        get().stopLogStream(taskId);
      };

      set((state) => {
        const newActiveTasks = new Map(state.activeTasks);
        newActiveTasks.set(taskId, eventSource);
        return { activeTasks: newActiveTasks };
      });
    } catch (error) {
      console.error('Failed to start log stream:', error);
      set({ connectionStatus: 'error' });
    }
  },

  stopLogStream: (taskId: string) => {
    const state = get();
    const eventSource = state.activeTasks.get(taskId);

    if (eventSource) {
      eventSource.close();
      
      set((state) => {
        const newActiveTasks = new Map(state.activeTasks);
        newActiveTasks.delete(taskId);
        return { 
          activeTasks: newActiveTasks,
          connectionStatus: newActiveTasks.size > 0 ? 'connected' : 'disconnected'
        };
      });
    }
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
    const state = get();
    
    state.activeTasks.forEach((eventSource) => {
      eventSource.close();
    });

    logBuffer.clear();

    set({
      selectedProject: undefined,
      session: undefined,
      logsVersion: 0,
      isRunning: false,
      isStopping: false,
      userStoppedJobId: null,
      activeTasks: new Map<string, EventSource>(),
      connectionStatus: 'disconnected',
    });
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
}));

// Apply initial theme on load
applyTheme(getInitialTheme());
