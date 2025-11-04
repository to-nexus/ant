import { create } from 'zustand';
import { Session } from '@/types/session';
import { LogEntry } from '@/types/log';
import { Feature, FileNode, FileContent } from '@/lib/api';
import { subscribeToLogs } from '@/lib/api';

interface StoreState {
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
  selectProject: (projectId: string) => void;
  selectFeature: (featureName: string) => void;
  selectFile: (filePath: string) => void;
  setFeatures: (features: Feature[]) => void;
  setFileTree: (tree: FileNode[]) => void;
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

  selectProject: (projectId: string) => {
    set({ 
      selectedProject: projectId,
      selectedFeature: undefined,
      selectedFile: undefined,
      features: [],
      fileTree: [],
      fileContent: undefined,
    });
  },

  selectFeature: (featureName: string) => {
    set({ 
      selectedFeature: featureName,
      selectedFile: undefined,
      fileContent: undefined,
    });
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