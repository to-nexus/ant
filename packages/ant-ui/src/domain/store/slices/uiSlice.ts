import { StateCreator } from 'zustand';
import { UIState } from '../types';
import { STORAGE_KEYS, saveToStorage } from '../storage';
import { sseManager } from '@/infrastructure/sse/SSEManager';

export interface UIActions {
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleSplitLayout: (layout: 'horizontal' | 'vertical') => void;
  setMainView: (mode: 'agents' | 'codeIde') => void;
  setIdeBaseUrl: (url: string | undefined) => void;
  setIdeWorkspacePath: (path: string | undefined) => void;
  switchToCodeIdeView: (workspacePath: string) => void;
  setIdeConnecting: (connecting: boolean, error?: string) => void;
  setIdeFrameLoaded: (loaded: boolean) => void;
  reloadIdeFrame: () => void;
  selectMainPanelTab: (tab: 'job' | 'projectConfig' | 'accountConfig' | 'fileEdit') => void;
  openMainPanelTab: (tab: 'projectConfig' | 'accountConfig' | 'fileEdit') => void;
  closeMainPanelTab: (tab: 'projectConfig' | 'accountConfig' | 'fileEdit') => void;
  clearJobTab: () => Promise<void>;
  restoreJobTab: () => void;
}

export type UISlice = UIState & UIActions;

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

export const createUISlice: StateCreator<any, [], [], UISlice> = (set, get) => ({
  // ==================
  // State
  // ==================
  theme: getInitialTheme(),
  splitLayout: 'vertical',
  mainView: 'agents',
  ideBaseUrl: undefined,
  ideWorkspacePath: undefined,
  ideReloadTimestamp: 0,
  ideConnecting: false,
  ideConnectError: undefined,
  ideFrameLoaded: false,
  mainPanelActiveTab: 'job',
  mainPanelOpenTabs: { projectConfig: false, accountConfig: false, fileEdit: false },
  mainPanelTabOrder: [],
  isJobTabCleared: false,

  // ==================
  // Actions
  // ==================
  toggleTheme: () => {
    const current = get().theme;
    const newTheme = current === 'light' ? 'dark' : 'light';
    set({ theme: newTheme });
    saveToStorage(STORAGE_KEYS.THEME, newTheme);
    applyTheme(newTheme);
  },

  setTheme: (theme) => {
    set({ theme });
    saveToStorage(STORAGE_KEYS.THEME, theme);
    applyTheme(theme);
  },

  toggleSplitLayout: (layout) => {
    set({ splitLayout: layout });
  },

  setMainView: (mode) => {
    set({ mainView: mode });
    saveToStorage(STORAGE_KEYS.MAIN_VIEW, mode);
  },

  setIdeBaseUrl: (url) => {
    set({ ideBaseUrl: url });
  },

  setIdeWorkspacePath: (path) => {
    set({ ideWorkspacePath: path });
  },

  switchToCodeIdeView: (workspacePath) => {
    set({ 
      ideWorkspacePath: workspacePath,
      mainView: 'codeIde'
    });
    saveToStorage(STORAGE_KEYS.MAIN_VIEW, 'codeIde');
  },

  setIdeConnecting: (connecting, error) => {
    set({ ideConnecting: connecting, ideConnectError: error });
  },

  setIdeFrameLoaded: (loaded) => {
    set({ ideFrameLoaded: loaded });
  },

  reloadIdeFrame: () => {
    set({ ideReloadTimestamp: Date.now() } as any);
  },

  selectMainPanelTab: (tab) => {
    set({ mainPanelActiveTab: tab });
  },

  openMainPanelTab: (tab) => {
    set((s: any) => {
      const newOrder = s.mainPanelTabOrder.filter((t: string) => t !== tab);
      newOrder.push(tab);
      
      return {
        mainPanelActiveTab: tab,
        mainPanelOpenTabs: {
          ...s.mainPanelOpenTabs,
          [tab]: true
        },
        mainPanelTabOrder: newOrder
      };
    });
  },

  closeMainPanelTab: (tab) => {
    set((s: any) => {
      const nextOpen = { ...s.mainPanelOpenTabs, [tab]: false };
      const nextActive = s.mainPanelActiveTab === tab ? 'job' : s.mainPanelActiveTab;
      const nextOrder = s.mainPanelTabOrder.filter((t: string) => t !== tab);
      
      return {
        mainPanelOpenTabs: nextOpen,
        mainPanelActiveTab: nextActive,
        mainPanelTabOrder: nextOrder
      };
    });
  },

  clearJobTab: async () => {
    const state = get();
    const prevJobId = state.currentJobId;
    const { selectedProject, selectedFeature, selectedJobType } = state;
    
    set({ 
      mainPanelActiveTab: 'job', 
      isJobTabCleared: false,
      currentJobId: undefined,
      isRunning: false,
      currentJob: null,
      taskStartTime: undefined,
      elapsedTime: 0,
      currentMode: undefined,
      chatMessages: [],
      kanban: {
        jobId: undefined,
        todo: [],
        inProgress: null,
        completed: [],
        isEstimating: false,
        dataSource: 'session',
        interruption: undefined,
        recursionCount: undefined,
        recursionLimit: undefined,
        totalElapsedTime: undefined,
        jobTiming: undefined
      }
    });
    
    // Remove from storage
    const { removeFromStorage } = await import('../storage');
    removeFromStorage(STORAGE_KEYS.RUNNING_TASK);
    removeFromStorage(STORAGE_KEYS.TASK_START_TIME);
    removeFromStorage(STORAGE_KEYS.TASK_MODE);
    
    // Disconnect SSE
    if (prevJobId) {
      sseManager.disconnectWorkflow(prevJobId);
    }
    
    // Clear session data
    if (selectedProject && selectedFeature) {
      try {
        const { clearSessionData } = await import('@/infrastructure/http/api');
        await clearSessionData(selectedProject, selectedFeature, selectedJobType);
        console.log(`[Store] ✅ Cleared session data for ${selectedProject}/${selectedFeature} (${selectedJobType})`);
        
        sseManager.disconnect();
        setTimeout(() => {
          if (selectedProject && selectedFeature) {
            sseManager.connect(selectedProject, selectedFeature, selectedJobType);
            console.log(`[Store] 🔄 Reconnected SSE to get fresh state`);
          }
        }, 100);
      } catch (error) {
        console.error('[Store] ❌ Failed to clear session data:', error);
      }
    }
  },

  restoreJobTab: () => {
    set({ isJobTabCleared: false });
  },
});

// Apply initial theme on load
applyTheme(getInitialTheme());

