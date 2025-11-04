import { create } from 'zustand';
import { Session } from '@/types/session';
import { LogEntry } from '@/types/log';
import { Feature, FileNode, FileContent } from '@/lib/api';
import { subscribeToLogs } from '@/lib/api';

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
  activeTasks: Map<string, EventSource>;
  connectionStatus: 'connected' | 'disconnected' | 'error';
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
  setRunning: (isRunning: boolean) => void;
  clearLogs: () => void;
  reset: () => void;
  startLogStream: (taskId: string) => void;
  stopLogStream: (taskId: string) => void;
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'error') => void;
}

type Store = StoreState & StoreActions;

const MAX_LOGS = 500;

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
  activeTasks: new Map<string, EventSource>(),
  connectionStatus: 'disconnected',

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
    } else {
      set({ 
        selectedProject: projectId,
        selectedFeature: undefined,
        selectedFile: undefined,
        features: [],
        fileTree: [],
        fileContent: undefined,
      });
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
  },

  setSelectedFeature: (featureName: string | undefined) => {
    set({ 
      selectedFeature: featureName,
      selectedFile: undefined,
      fileTree: [],
      fileContent: undefined,
    });
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

  setRunning: (isRunning: boolean) => {
    set({ isRunning });
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
}));