import { StateCreator } from 'zustand';
import { UIState } from '../types';
import { STORAGE_KEYS, saveToStorage } from '../storage';
import { type ActionMetadata, deriveFromIntent, getConfigSlots } from '@ant/shared';
import i18n from '@/i18n';

export interface UIActions {
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setLanguage: (language: 'en' | 'ko') => void;
  toggleSplitLayout: (layout: 'horizontal' | 'vertical') => void;
  toggleShowWorkflow: () => void;
  setMainView: (mode: 'agents' | 'codeIde') => void;
  setIdeBaseUrl: (url: string | undefined) => void;
  setIdeWorkspacePath: (path: string | undefined) => void;
  switchToCodeIdeView: (workspacePath: string) => void;
  setIdeConnecting: (connecting: boolean, error?: string) => void;
  setIdeFrameLoaded: (loaded: boolean) => void;
  reloadIdeFrame: () => void;
  selectMainPanelTab: (tab: 'job' | 'projectConfig' | 'accountConfig' | 'fileEdit' | 'transfer' | 'previewConfig' | 'actions') => void;
  openMainPanelTab: (tab: 'projectConfig' | 'accountConfig' | 'fileEdit' | 'transfer' | 'previewConfig' | 'actions') => void;
  closeMainPanelTab: (tab: 'projectConfig' | 'accountConfig' | 'fileEdit' | 'transfer' | 'previewConfig' | 'actions') => void;
  // ✅ Pending clarify answers (compound ChoiceCard ↔ ChatInput shared state)
  setPendingClarifyAnswer: (index: number, answer: string) => void;
  removePendingClarifyAnswer: (index: number) => void;
  setPendingClarifyContext: (questions: string[]) => void;
  clearPendingClarify: () => void;
  // ✅ Onboarding skip
  setOnboardingSkipped: (skipped: boolean) => void;
  // ✅ QuickStart with existing project
  setQuickStartProjectId: (projectId: string | undefined) => void;
  // ✅ ProjectWizard modal (design/code wizard)
  setProjectSetupConfig: (config: { mode: 'design' | 'code'; existingProjectId?: string } | undefined) => void;
  // ✅ Figma integration bridge state (single normalization point)
  setBridgeStatus: (status: { connected: boolean; detected?: boolean; figmaDesktopReachable?: boolean }) => void;
  setAccountConfigScrollTarget: (target: string | null) => void;
  // Actions panel
  openActionsPanel: (actionId?: string) => void;
  setActionsStep: (step: 'pick-action' | 'pick-intent' | 'config' | 'basis-edit') => void;
  selectAction: (actionId: string) => void;
  selectIntent: (intentId: string) => void;
  updateActionMetadata: (patch: Partial<ActionMetadata>) => void;
  resetActionMetadata: () => void;
  highlightArtifactDirs: (dirs: string[]) => void;
  clearHighlightedArtifactDirs: () => void;
  setSpotlightTarget: (target: { type: 'file' | 'dir'; path: string }) => void;
  clearSpotlightTarget: () => void;
}

export type UISlice = UIState & UIActions;

// Helper to get initial language from localStorage
const getInitialLanguage = (): 'en' | 'ko' => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.LANGUAGE);
    if (stored === '"en"' || stored === '"ko"') {
      return JSON.parse(stored);
    }
    if (stored === 'en' || stored === 'ko') {
      return stored;
    }
  } catch (error) {
    console.error('Failed to read language from localStorage:', error);
  }
  return 'ko';
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
  language: getInitialLanguage(),
  splitLayout: 'vertical',
  showWorkflow: true,
  mainView: 'agents',
  ideBaseUrl: undefined,
  ideWorkspacePath: undefined,
  ideReloadTimestamp: 0,
  ideConnecting: false,
  ideConnectError: undefined,
  ideFrameLoaded: false,
  mainPanelActiveTab: 'job',
  mainPanelOpenTabs: { projectConfig: false, accountConfig: false, fileEdit: false, transfer: false, previewConfig: false, actions: false },
  mainPanelTabOrder: [],
  actionsStep: 'pick-action' as const,
  selectedActionId: null,
  selectedIntentId: null,
  actionMetadata: {} as ActionMetadata,
  highlightedArtifactDirs: [] as string[],
  spotlightTarget: null as { type: 'file' | 'dir'; path: string } | null,
  pendingClarifyAnswers: {},
  pendingClarifyQuestions: [],
  onboardingSkipped: false,
  quickStartProjectId: undefined,
  projectSetupConfig: undefined,
  bridgeConnected: null,
  bridgeDetected: false,
  figmaDesktopReachable: false,
  accountConfigScrollTarget: null,

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

  setLanguage: (language) => {
    set({ language });
    saveToStorage(STORAGE_KEYS.LANGUAGE, language);
    i18n.changeLanguage(language);
  },

  toggleSplitLayout: (layout) => {
    set({ splitLayout: layout });
  },

  toggleShowWorkflow: () => {
    set((s: any) => ({ showWorkflow: !s.showWorkflow }));
  },

  setMainView: (mode) => {
    const prev = get().mainView;
    set({ mainView: mode });
    saveToStorage(STORAGE_KEYS.MAIN_VIEW, mode);

    // Agents -> Code IDE 전환 시 iframe 로딩 상태 리셋 (iframe이 리마운트되므로)
    if (mode === 'codeIde' && prev !== 'codeIde') {
      set({ ideFrameLoaded: false } as any);
    }

    // IDE -> Agents 전환 시 stale 데이터 refresh
    if (prev === 'codeIde' && mode === 'agents') {
      const state = get();
      if (state.connectionStatus === 'connected' && state.selectedProject && state.selectedFeature) {
        // File tree refresh
        state.refreshFileTree();
        // Transfer count refresh
        import('@/infrastructure/http/api').then(({ fetchTransferRequests }) => {
          fetchTransferRequests('received')
            .then(({ pendingCount }: { pendingCount: number }) => state.setPendingTransferCount(pendingCount))
            .catch(() => {});
        });
      }
    }
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
    set({ ideReloadTimestamp: Date.now(), ideFrameLoaded: false } as any);
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

  // ✅ Pending clarify answers
  setPendingClarifyAnswer: (index: number, answer: string) => {
    set((s: any) => ({
      pendingClarifyAnswers: { ...s.pendingClarifyAnswers, [index]: answer },
    }));
  },

  removePendingClarifyAnswer: (index: number) => {
    set((s: any) => {
      const next = { ...s.pendingClarifyAnswers };
      delete next[index];
      return { pendingClarifyAnswers: next };
    });
  },

  setPendingClarifyContext: (questions: string[]) => {
    set({ pendingClarifyQuestions: questions });
  },

  clearPendingClarify: () => {
    set({ pendingClarifyAnswers: {}, pendingClarifyQuestions: [] });
  },

  setOnboardingSkipped: (skipped: boolean) => {
    set({ onboardingSkipped: skipped });
  },

  setQuickStartProjectId: (projectId: string | undefined) => {
    set({ quickStartProjectId: projectId });
  },

  setProjectSetupConfig: (config: { mode: 'design' | 'code'; existingProjectId?: string } | undefined) => {
    set({ projectSetupConfig: config });
  },

  setBridgeStatus: (status) => {
    set({
      bridgeConnected: status.connected,
      bridgeDetected: status.detected ?? status.connected,
      figmaDesktopReachable: status.figmaDesktopReachable ?? false,
    });
  },

  setAccountConfigScrollTarget: (target) => {
    set({ accountConfigScrollTarget: target });
  },

  openActionsPanel: (actionId?: string) => {
    set((s: any) => {
      const newOrder = s.mainPanelTabOrder.filter((t: string) => t !== 'actions');
      newOrder.push('actions');

      let step: 'pick-action' | 'pick-intent' | 'config' | 'basis-edit' = 'pick-action';
      let selectedIntentId: string | null = null;

      if (actionId) {
        step = 'pick-intent';
      }

      return {
        mainPanelActiveTab: 'actions',
        mainPanelOpenTabs: { ...s.mainPanelOpenTabs, actions: true },
        mainPanelTabOrder: newOrder,
        actionsStep: step,
        selectedActionId: actionId || null,
        selectedIntentId,
        actionMetadata: { basis: s.actionMetadata.basis },
      };
    });
  },

  setActionsStep: (step) => {
    set({ actionsStep: step });
  },

  selectAction: (actionId: string) => {
    set((s: any) => ({
      selectedActionId: actionId,
      selectedIntentId: null,
      actionMetadata: { basis: s.actionMetadata.basis },
    }));
  },

  selectIntent: (intentId: string) => {
    const derived = deriveFromIntent(intentId);
    set((s: any) => ({
      selectedIntentId: intentId,
      actionMetadata: {
        intent: intentId,
        basis: s.actionMetadata.basis,
      },
      selectedAgent: derived.agent,
      selectedJobType: derived.jobType as any,
      pendingChatInput: { message: '', source: 'intent-change' },
    }));
  },

  updateActionMetadata: (patch: Partial<ActionMetadata>) => {
    set((s: any) => {
      const next = { ...s.actionMetadata, ...patch };
      const updates: any = {};

      if (patch.intent !== undefined && patch.intent !== s.actionMetadata.intent) {
        next.refs = undefined;
        next.context = undefined;
        next.target = undefined;

        if (patch.intent) {
          const derived = deriveFromIntent(patch.intent);
          updates.selectedAgent = derived.agent;
          updates.selectedJobType = derived.jobType;
        }
      }

      if ('refs' in patch && next.intent) {
        const slots = getConfigSlots(next.intent);
        if (slots?.target.kind === 'revise') {
          next.target = patch.refs;
        }
      }

      updates.actionMetadata = next;
      return updates;
    });
  },

  resetActionMetadata: () => {
    set((s: any) => {
      const nextOpen = { ...s.mainPanelOpenTabs, actions: false };
      const nextOrder = s.mainPanelTabOrder.filter((t: string) => t !== 'actions');
      return {
        actionMetadata: { basis: s.actionMetadata.basis },
        selectedIntentId: null,
        actionsStep: 'pick-action' as const,
        selectedActionId: null,
        mainPanelActiveTab: 'job',
        mainPanelOpenTabs: nextOpen,
        mainPanelTabOrder: nextOrder,
      };
    });
  },

  highlightArtifactDirs: (dirs: string[]) => {
    set({ highlightedArtifactDirs: dirs });
    setTimeout(() => {
      set((s: any) => {
        if (JSON.stringify(s.highlightedArtifactDirs) === JSON.stringify(dirs)) {
          return { highlightedArtifactDirs: [] };
        }
        return {};
      });
    }, 4000);
  },

  clearHighlightedArtifactDirs: () => {
    set({ highlightedArtifactDirs: [] });
  },

  setSpotlightTarget: (target: { type: 'file' | 'dir'; path: string }) => {
    set({ spotlightTarget: target });
  },

  clearSpotlightTarget: () => {
    set({ spotlightTarget: null });
  },
});

// Apply initial theme on load
applyTheme(getInitialTheme());

