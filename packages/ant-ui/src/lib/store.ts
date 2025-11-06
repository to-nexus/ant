import { create } from 'zustand';
import { Session } from '@/types/session';
import { LogEntry } from '@/types/log';
import { Feature, FileNode, FileContent, DevServerStatus } from '@/lib/api';
import { subscribeToLogs } from '@/lib/api';
import { TaskExecution } from '@/lib/cli';

interface StoreState {
  projects: string[];
  selectedProject: string | undefined;
  selectedFeature: string | undefined;
  selectedFile: string | undefined;
  features: Feature[];
  fileTree: FileNode[];
  fileContent: FileContent | undefined;
  session: Session | undefined;
  logs: LogEntry[];
  isRunning: boolean;
  currentTaskId: string | undefined;
  currentTask: TaskExecution | null;
  activeTasks: Map<string, EventSource>;
  connectionStatus: 'connected' | 'disconnected' | 'error';
  showConfigEditor: boolean;
  showFileEditor: boolean;
  taskStartTime: number | undefined;
  elapsedTime: number;
  currentMode: 'generate' | 'refactor' | 'explain' | undefined;
  devServerStatus: DevServerStatus | undefined;
  theme: 'light' | 'dark';
}

interface StoreActions {
  setProjects: (projects: string[]) => void;
  fetchProjects: () => Promise<void>;
  selectProject: (projectId: string) => void;
  setSelectedProject: (projectId: string | undefined) => void;
  selectFeature: (featureName: string) => void;
  setSelectedFeature: (featureName: string | undefined) => void;
  fetchFeatures: () => Promise<void>;
  selectFile: (filePath: string) => void;
  setFeatures: (features: Feature[]) => void;
  setFileTree: (tree: FileNode[]) => void;
  refreshFileTree: () => Promise<void>;
  setFileContent: (content: FileContent | undefined) => void;
  setSession: (session: Session | undefined) => void;
  addLog: (log: LogEntry) => void;
  setRunning: (isRunning: boolean, taskId?: string, mode?: 'generate' | 'refactor' | 'explain') => void;
  setCurrentTask: (task: TaskExecution | null) => void;
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
}

type Store = StoreState & StoreActions;

const MAX_LOGS = 500;

// LocalStorage keys
const STORAGE_KEYS = {
  RUNNING_TASK: 'ant-ui:running-task',
  TASK_START_TIME: 'ant-ui:task-start-time',
  TASK_MODE: 'ant-ui:task-mode',
  SELECTED_PROJECT: 'ant-ui:selected-project',
  SELECTED_FEATURE: 'ant-ui:selected-feature',
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
  projects: [],
  selectedProject: undefined,
  selectedFeature: undefined,
  selectedFile: undefined,
  features: [],
  fileTree: [],
  fileContent: undefined,
  session: undefined,
  logs: [],
  isRunning: false,
  currentTaskId: undefined,
  currentTask: null,
  activeTasks: new Map<string, EventSource>(),
  connectionStatus: 'disconnected',
  showConfigEditor: false,
  showFileEditor: false,
  taskStartTime: undefined,
  elapsedTime: 0,
  currentMode: undefined,
  devServerStatus: undefined,
  theme: getInitialTheme(),

  setProjects: (projects: string[]) => {
    set({ projects });
  },

  fetchProjects: async () => {
    try {
      const { listProjects } = await import('@/lib/projects');
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
    
    // Save to localStorage
    saveToStorage(STORAGE_KEYS.SELECTED_PROJECT, projectId);
    removeFromStorage(STORAGE_KEYS.SELECTED_FEATURE); // Clear feature when project changes
    
    // Auto-fetch features when project is selected
    get().fetchFeatures();
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
      // Auto-fetch features when project is selected
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
    
    // Save to localStorage
    saveToStorage(STORAGE_KEYS.SELECTED_FEATURE, featureName);
  },

  setSelectedFeature: (featureName: string | undefined) => {
    set({ 
      selectedFeature: featureName,
      selectedFile: undefined,
      fileTree: [],
      fileContent: undefined,
    });
    
    // Save to localStorage
    if (featureName) {
      saveToStorage(STORAGE_KEYS.SELECTED_FEATURE, featureName);
    } else {
      removeFromStorage(STORAGE_KEYS.SELECTED_FEATURE);
    }
    
    // Load session.json when feature is selected
    if (featureName) {
      const { selectedProject } = get();
      if (selectedProject) {
        // Load session asynchronously
        (async () => {
          try {
            const { fetchFeatureSession } = await import('@/lib/api');
            const session = await fetchFeatureSession(selectedProject, featureName);
            set({ session: session || undefined });
          } catch (error) {
            console.error('Failed to load session:', error);
            set({ session: undefined });
          }
        })();
      }
    } else {
      set({ session: undefined });
    }
  },

  fetchFeatures: async () => {
    const { selectedProject } = get();
    if (!selectedProject) return;
    
    try {
      const { fetchFeatures: apiFetchFeatures } = await import('@/lib/api');
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
      const { fetchFileTree } = await import('@/lib/api');
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
    console.log('[store] setSession called with:', {
      session,
      isUndefined: session === undefined,
      isNull: session === null,
    });
    set({ session });
  },

  addLog: (log: LogEntry) => {
    set((state) => {
      const newLogs = [...state.logs, log];
      if (newLogs.length > MAX_LOGS) {
        return { logs: newLogs.slice(newLogs.length - MAX_LOGS) };
      }
      return { logs: newLogs };
    });
  },

  setRunning: (isRunning: boolean, taskId?: string, mode?: 'generate' | 'refactor' | 'explain') => {
    const startTime = isRunning ? Date.now() : undefined;
    
    set({ 
      isRunning,
      currentTaskId: isRunning ? taskId : undefined,
      taskStartTime: startTime,
      elapsedTime: isRunning ? 0 : get().elapsedTime,
      currentMode: isRunning ? mode : undefined
    });

    // Persist to localStorage
    if (isRunning && taskId) {
      saveToStorage(STORAGE_KEYS.RUNNING_TASK, taskId);
      saveToStorage(STORAGE_KEYS.TASK_START_TIME, startTime);
      if (mode) {
        saveToStorage(STORAGE_KEYS.TASK_MODE, mode);
      }
    } else {
      removeFromStorage(STORAGE_KEYS.RUNNING_TASK);
      removeFromStorage(STORAGE_KEYS.TASK_START_TIME);
      removeFromStorage(STORAGE_KEYS.TASK_MODE);
    }
  },

  setCurrentTask: (task: TaskExecution | null) => {
    set({ currentTask: task });
  },

  clearLogs: () => {
    set({ logs: [] });
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
      const { getDevServerStatus } = await import('@/lib/api');
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

    set({
      selectedProject: undefined,
      session: undefined,
      logs: [],
      isRunning: false,
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
}));

// Apply initial theme on load
applyTheme(getInitialTheme());