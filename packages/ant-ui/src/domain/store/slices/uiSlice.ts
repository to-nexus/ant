import { StateCreator } from 'zustand';
import {
  UIState,
  type EditorTab,
  type MainPanelTabId,
  type MainPanelTabOrderItem,
  type StaticMainPanelTab,
} from '../types';
import {
  UNPINNED_EDITOR_TAB_ID,
  fileTitleFromPath,
  isEditorTabId,
  makePinnedRealTabId,
  makeVirtualEditorTabId,
  moveTabIdToOrderEnd,
  reconcileMainPanelActiveTab,
  sanitizeEditorTabOrder,
} from '../editor/editorTabMainPanel';
import {
  buildTurnInfoMap,
  getPendingCardFilePath,
  resolveVirtualTabSource,
  shouldRenderVirtualPreviewCard,
} from '../editor/virtualTabModel';
import { STORAGE_KEYS, saveToStorage } from '../storage';
import {
  type ActionMetadata,
  ACTION_DEFINITIONS,
  deriveFromIntent,
  getConfigSlots,
  isActionVisibleForDomain,
  normalizeUiSourceRefs,
  type IntentGroup,
  type Basis,
  type TechTierConfig,
  type Domain,
} from '@ant/shared';
import {
  updateProjectConfig as apiUpdateProjectConfig,
  type ProjectConfig,
} from '@/infrastructure/http/api';
import i18n from '@/i18n';

// ─────────────────────────────────────────────────────────────────────────
// IntentGroup-scoped techTier cache helpers
//
// The user's `techTier` selection (stack / language / framework / gameEngine)
// is per-IntentGroup — code-job tech choices must NOT leak into design-job
// intents and vice versa. `basis.techTier` mirrors the active group's entry
// from `techTierByGroup`; whenever `selectedActionId` transitions, we swap
// the live mirror to match the new group. Other tiers (visualTier /
// gameArtTier / gameContentTier) stay on `basis` as sticky, group-agnostic
// state.
// ─────────────────────────────────────────────────────────────────────────

type GroupCache = Partial<Record<IntentGroup, TechTierConfig>>;

function basisHasOtherTiers(basis: Basis | undefined): boolean {
  if (!basis) return false;
  return !!(basis.visualTier || basis.gameArtTier || basis.gameContentTier);
}

/**
 * Force-apply `BasisSlotConfig.lockedStack` onto `basis.techTier.stack`
 * when the new intent declares a lock. Used on intent changes within the
 * same IntentGroup (e.g. user toggles between gen-sys-fe / gen-sys-be /
 * gen-sys-full via the IntentTabNav) so the live mirror always matches
 * the lock without waiting for the wizard to mount and normalize.
 *
 * Stack change cascades into clearing language / framework on the prior
 * shape — a fullstack `feLanguage` makes no sense once we lock to
 * single-side, and a single-stack `language` carries the wrong slot key
 * for fullstack. We keep `gameEngine` only when the new stack still
 * allows it (frontend / fullstack).
 */
function applyLockedStackToBasis(
  basis: Basis | undefined,
  intentId: string | undefined,
): Basis | undefined {
  if (!intentId) return basis;
  const slot = getConfigSlots(intentId as any);
  const lockedStack = slot?.basis?.lockedStack;
  if (!lockedStack) return basis;

  const tt = basis?.techTier;
  if (tt?.stack === lockedStack) return basis;

  const carriedGameEngine =
    lockedStack !== 'backend'
      ? (tt?.frontend?.gameEngine ?? tt?.backend?.gameEngine)
      : undefined;

  const cleanedTechTier: TechTierConfig = { stack: lockedStack };
  if (carriedGameEngine) {
    cleanedTechTier.frontend = { stack: 'frontend', gameEngine: carriedGameEngine };
  }

  return basis ? { ...basis, techTier: cleanedTechTier } : { techTier: cleanedTechTier };
}

/**
 * Save outgoing group's techTier into the cache and restore the incoming
 * group's value into `basis.techTier`. When the group is unchanged, this
 * still mirrors any in-place edit on `basis.techTier` into the cache so
 * the SSOT (live mirror = cache entry) holds across every update path.
 */
function applyGroupSwap(
  basis: Basis | undefined,
  cache: GroupCache,
  prevGroup: IntentGroup | null,
  nextGroup: IntentGroup | null,
): { basis: Basis | undefined; cache: GroupCache } {
  const nextCache: GroupCache = { ...cache };

  if (prevGroup) {
    const liveTechTier = basis?.techTier;
    if (liveTechTier) {
      nextCache[prevGroup] = liveTechTier;
    } else {
      delete nextCache[prevGroup];
    }
  }

  if (prevGroup === nextGroup) {
    return { basis, cache: nextCache };
  }

  const restored = nextGroup ? nextCache[nextGroup] : undefined;
  if (restored) {
    return {
      basis: { ...(basis || {}), techTier: restored },
      cache: nextCache,
    };
  }

  if (!basis) return { basis: undefined, cache: nextCache };

  if (basis.techTier === undefined) {
    return { basis, cache: nextCache };
  }

  const stripped: Basis = { ...basis, techTier: undefined };
  return {
    basis: basisHasOtherTiers(stripped) ? stripped : undefined,
    cache: nextCache,
  };
}

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
  selectMainPanelTab: (tab: MainPanelTabId) => void;
  openMainPanelTab: (tab: Exclude<StaticMainPanelTab, 'job'>) => void;
  closeMainPanelTab: (tab: Exclude<StaticMainPanelTab, 'job'>) => void;
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
  setBasisEditInitialTier: (tier: 'techTier' | 'visualTier' | 'gameArtTier' | 'gameContentTier' | undefined) => void;
  selectAction: (actionId: string) => void;
  selectIntent: (intentId: string) => void;
  updateActionMetadata: (patch: Partial<ActionMetadata>) => void;
  resetActionMetadata: () => void;
  highlightArtifactDirs: (dirs: string[]) => void;
  clearHighlightedArtifactDirs: () => void;
  setSpotlightTarget: (target: { type: 'file' | 'dir'; path: string }) => void;
  clearSpotlightTarget: () => void;
  syncUnpinnedEditorTab: (filePath: string | undefined) => void;
  selectEditorTab: (tabId: string) => void;
  pinEditorTab: (tabId: string) => void;
  unpinEditorTab: (tabId: string) => void;
  closeEditorTab: (tabId: string) => void;
  clearEditorTabs: () => void;
  syncVirtualEditorTabsFromBuffers: (
    buffers: Record<string, { turnId: string; pendingCards?: Record<string, import('@ant/shared').PendingCardSnapshot> }>,
  ) => void;
  promoteVirtualEditorTabToReal: (args: { cardId: string; filePath: string; source?: 'plan' | 'design' }) => void;
  removeVirtualEditorTabsByJobId: (jobId: string) => void;
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

function isRealUnpinnedTab(tab: EditorTab): boolean {
  return tab.kind === 'real' && tab.pinned === false;
}

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

/**
 * Fire-and-forget write of `WorkspaceConfig.domain` to `config.json`
 * (BE artifact). This is the SSOT for project-level domain persistence;
 * localStorage / sessionStorage are intentionally not used for this slot.
 *
 * Guard: skip the PUT when `cfg.domain === nextDomain` so the inverse
 * sync path (`fetchProjectConfig` → `updateActionMetadata({ domain })`)
 * is a no-op rather than an echo write.
 */
function persistWorkspaceDomain(
  selectedProject: string | undefined,
  cfg: ProjectConfig | undefined,
  nextDomain: Domain,
): void {
  if (!selectedProject) return;
  if (!cfg) return;
  if (cfg.domain === nextDomain) return;

  void apiUpdateProjectConfig(selectedProject, {
    ...cfg,
    domain: nextDomain,
  }).catch((error) => {
    console.error('[uiSlice] failed to persist workspace domain', error);
  });
}

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
  basisEditInitialTier: undefined,
  selectedActionId: null,
  selectedIntentId: null,
  // Phase 2 (D22) — workspace project domain defaults to 'service' so the
  // ActionsPanel renders the matrix-correct card set on first paint and
  // the BE detect pipeline gets a deterministic explicit override (10.2).
  // The chip is mutated only via the top-level DomainToggle on `pick-action`.
  // The persisted SSOT is `WorkspaceConfig.domain` in the project's
  // `config.json` artifact — `projectConfigSlice.fetchProjectConfig`
  // hydrates this value on project load, and `updateActionMetadata`
  // writes it back on toggle.
  actionMetadata: { domain: 'service' } as ActionMetadata,
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
  editorTabs: [],
  activeEditorTabId: null,

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
    if (tab === 'fileEdit') {
      const activeEditorTabId = get().activeEditorTabId;
      set({ mainPanelActiveTab: activeEditorTabId ?? 'job' });
      return;
    }
    if (isEditorTabId(tab)) {
      get().selectEditorTab(tab);
      return;
    }
    set({ mainPanelActiveTab: tab });
  },

  openMainPanelTab: (tab) => {
    if (tab === 'fileEdit') {
      const activeEditorTabId = get().activeEditorTabId;
      const editorTabs = get().editorTabs as EditorTab[];
      const hasTabs = editorTabs.length > 0;
      const order = sanitizeEditorTabOrder(get().mainPanelTabOrder as string[], editorTabs);
      if (activeEditorTabId && hasTabs) {
        const nextOrder = order.filter((candidate) => candidate !== activeEditorTabId);
        nextOrder.push(activeEditorTabId);
        set((s: any) => ({
          mainPanelActiveTab: activeEditorTabId,
          mainPanelOpenTabs: {
            ...s.mainPanelOpenTabs,
            fileEdit: true,
          },
          mainPanelTabOrder: nextOrder,
        }));
      } else {
        set((s: any) => ({
          mainPanelActiveTab: 'job',
          mainPanelOpenTabs: {
            ...s.mainPanelOpenTabs,
            fileEdit: false,
          },
          mainPanelTabOrder: order,
        }));
      }
      return;
    }
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
    if (tab === 'fileEdit') {
      const activeEditorTabId = get().activeEditorTabId;
      if (activeEditorTabId) {
        get().closeEditorTab(activeEditorTabId);
        return;
      }
      set((s: any) => ({
        editorTabs: [],
        activeEditorTabId: null,
        selectedFile: undefined,
        mainPanelOpenTabs: { ...s.mainPanelOpenTabs, fileEdit: false },
        mainPanelActiveTab: isEditorTabId(s.mainPanelActiveTab) ? 'job' : s.mainPanelActiveTab,
        mainPanelTabOrder: s.mainPanelTabOrder.filter((t: string) => !isEditorTabId(t)),
      }));
      get().resetCurrentFile?.();
      return;
    }
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

  syncUnpinnedEditorTab: (filePath) => {
    set((s: any) => {
      const tabs = [...((s.editorTabs ?? []) as EditorTab[])];
      const existingIdx = tabs.findIndex((tab) => tab.id === UNPINNED_EDITOR_TAB_ID);

      if (!filePath) {
        if (existingIdx >= 0) tabs.splice(existingIdx, 1);
        const nextActive =
          s.activeEditorTabId === UNPINNED_EDITOR_TAB_ID
            ? (tabs.find((tab) => tab.id === UNPINNED_EDITOR_TAB_ID)?.id ?? tabs[0]?.id ?? null)
            : (tabs.some((tab) => tab.id === s.activeEditorTabId) ? s.activeEditorTabId : null);
        const hasTabs = tabs.length > 0;
        const nextOrder = sanitizeEditorTabOrder(s.mainPanelTabOrder as string[], tabs).filter(
          (tab) => tab !== 'fileEdit',
        );
        const nextMainActive = reconcileMainPanelActiveTab({
          currentMainPanelActiveTab: s.mainPanelActiveTab,
          nextTabs: tabs,
          nextActiveEditorTabId: nextActive,
        });
        return {
          editorTabs: tabs,
          activeEditorTabId: nextActive,
          mainPanelOpenTabs: {
            ...s.mainPanelOpenTabs,
            fileEdit: hasTabs,
          },
          mainPanelActiveTab: nextMainActive,
          mainPanelTabOrder: nextOrder,
        };
      }

      const unpinned: EditorTab = {
        id: UNPINNED_EDITOR_TAB_ID,
        title: fileTitleFromPath(filePath),
        path: filePath,
        kind: 'real',
        pinned: false,
        readOnly: false,
        status: 'ready',
      };
      if (existingIdx >= 0) tabs[existingIdx] = unpinned;
      else tabs.push(unpinned);

      const newOrder = sanitizeEditorTabOrder(s.mainPanelTabOrder as string[], tabs).filter(
        (tab) => tab !== 'fileEdit',
      );
      const nextOrder = newOrder.filter((tab) => tab !== UNPINNED_EDITOR_TAB_ID);
      nextOrder.push(UNPINNED_EDITOR_TAB_ID);

      return {
        editorTabs: tabs,
        activeEditorTabId: UNPINNED_EDITOR_TAB_ID,
        mainPanelActiveTab: UNPINNED_EDITOR_TAB_ID,
        mainPanelOpenTabs: {
          ...s.mainPanelOpenTabs,
          fileEdit: true,
        },
        mainPanelTabOrder: nextOrder,
      };
    });
  },

  selectEditorTab: (tabId) => {
    const tab = (get().editorTabs as EditorTab[]).find((candidate) => candidate.id === tabId);
    if (!tab) return;

    set((s: any) => {
      const order = sanitizeEditorTabOrder(s.mainPanelTabOrder as string[], s.editorTabs ?? []);
      const withoutFileEdit = order.filter((t) => t !== 'fileEdit');
      // Preserve the clicked tab's existing position. Moving it to the end
      // (the previous behaviour) reshuffled the visible order every click,
      // and because only the active tab renders its label the rearranged
      // tabs appeared as if the last tab's content had been replaced.
      const tabOrderId = tab.id as `editor:${string}`;
      const newOrder = withoutFileEdit.includes(tabOrderId)
        ? (withoutFileEdit as MainPanelTabOrderItem[])
        : ([...withoutFileEdit, tabOrderId] as MainPanelTabOrderItem[]);
      return {
        activeEditorTabId: tabId,
        mainPanelActiveTab: tabId,
        mainPanelOpenTabs: {
          ...s.mainPanelOpenTabs,
          fileEdit: true,
        },
        mainPanelTabOrder: newOrder,
      };
    });

    if (tab.kind === 'real' && tab.path) {
      const syncUnpinnedTab = tab.id === UNPINNED_EDITOR_TAB_ID;
      get().openFile(tab.path, { syncUnpinnedTab });
    }
  },

  pinEditorTab: (tabId) => {
    set((s: any) => {
      const tabs = [...((s.editorTabs ?? []) as EditorTab[])];
      const idx = tabs.findIndex((tab) => tab.id === tabId);
      if (idx < 0) return {};
      const target = tabs[idx];
      if (target.kind !== 'real' || target.pinned || !target.path || target.status === 'streaming') {
        return {};
      }

      const pinnedId = makePinnedRealTabId(target.path);
      const existingPinned = tabs.find((tab) => tab.id === pinnedId);
      if (existingPinned) {
        tabs.splice(idx, 1);
        const nextOrder = sanitizeEditorTabOrder(s.mainPanelTabOrder as string[], tabs);
        let nextMainActive = s.mainPanelActiveTab as string;
        if (nextMainActive === tabId) nextMainActive = existingPinned.id;
        return {
          editorTabs: tabs,
          activeEditorTabId:
            s.activeEditorTabId === tabId ? existingPinned.id : s.activeEditorTabId,
          mainPanelActiveTab: nextMainActive,
          mainPanelTabOrder: nextOrder,
        };
      }

      tabs[idx] = {
        ...target,
        id: pinnedId,
        title: fileTitleFromPath(target.path),
        pinned: true,
      };
      const baseOrder = sanitizeEditorTabOrder(s.mainPanelTabOrder as string[], tabs).filter(
        (tab) => tab !== 'fileEdit',
      );
      const nextOrder = moveTabIdToOrderEnd(baseOrder, pinnedId as MainPanelTabOrderItem);
      let nextMainActive = s.mainPanelActiveTab as string;
      if (nextMainActive === tabId) nextMainActive = pinnedId;
      return {
        editorTabs: tabs,
        activeEditorTabId: s.activeEditorTabId === tabId ? pinnedId : s.activeEditorTabId,
        mainPanelActiveTab: nextMainActive,
        mainPanelTabOrder: nextOrder,
      };
    });
  },

  unpinEditorTab: (tabId) => {
    let nextToOpen: EditorTab | undefined;
    set((s: any) => {
      const tabs = [...((s.editorTabs ?? []) as EditorTab[])];
      const idx = tabs.findIndex((tab) => tab.id === tabId);
      if (idx < 0) return {};
      const target = tabs[idx];
      if (target.kind !== 'real' || !target.pinned || target.status === 'streaming') return {};

      const unpinnedIdx = tabs.findIndex((tab) => tab.id === UNPINNED_EDITOR_TAB_ID);
      if (unpinnedIdx >= 0) {
        tabs.splice(idx, 1);
        const fallback = tabs[unpinnedIdx] ?? tabs.find(isRealUnpinnedTab) ?? tabs[0];
        if (fallback?.kind === 'real' && fallback.path) nextToOpen = fallback;
        const nextOrder = sanitizeEditorTabOrder(s.mainPanelTabOrder as string[], tabs);
        let nextMainActive = s.mainPanelActiveTab as string;
        if (nextMainActive === tabId) nextMainActive = fallback?.id ?? 'job';
        return {
          editorTabs: tabs,
          activeEditorTabId: s.activeEditorTabId === tabId ? (fallback?.id ?? null) : s.activeEditorTabId,
          mainPanelActiveTab: nextMainActive,
          mainPanelTabOrder: nextOrder,
        };
      }

      tabs[idx] = {
        ...target,
        id: UNPINNED_EDITOR_TAB_ID,
        pinned: false,
      };
      if (tabs[idx].kind === 'real' && tabs[idx].path) nextToOpen = tabs[idx];
      const baseOrder = sanitizeEditorTabOrder(s.mainPanelTabOrder as string[], tabs).filter(
        (tab) => tab !== 'fileEdit',
      );
      const nextOrder = moveTabIdToOrderEnd(baseOrder, UNPINNED_EDITOR_TAB_ID);
      let nextMainActive = s.mainPanelActiveTab as string;
      if (nextMainActive === tabId) nextMainActive = UNPINNED_EDITOR_TAB_ID;
      return {
        editorTabs: tabs,
        activeEditorTabId: s.activeEditorTabId === tabId ? UNPINNED_EDITOR_TAB_ID : s.activeEditorTabId,
        mainPanelActiveTab: nextMainActive,
        mainPanelTabOrder: nextOrder,
      };
    });

    if (nextToOpen?.path) {
      const syncUnpinnedTab = nextToOpen.id === UNPINNED_EDITOR_TAB_ID;
      get().openFile(nextToOpen.path, { syncUnpinnedTab });
    }
  },

  closeEditorTab: (tabId) => {
    let nextToOpen: EditorTab | undefined;
    let shouldClearSelected = false;
    set((s: any) => {
      const tabs = [...((s.editorTabs ?? []) as EditorTab[])];
      const idx = tabs.findIndex((tab) => tab.id === tabId);
      if (idx < 0) return {};

      tabs.splice(idx, 1);
      const nextActive =
        s.activeEditorTabId === tabId
          ? (tabs.find((tab) => tab.id === UNPINNED_EDITOR_TAB_ID)?.id ?? tabs[0]?.id ?? null)
          : s.activeEditorTabId;
      const activeTab = tabs.find((tab) => tab.id === nextActive);
      if (activeTab?.kind === 'real' && activeTab.path) {
        nextToOpen = activeTab;
      } else if (!activeTab) {
        shouldClearSelected = true;
      }

      const hasTabs = tabs.length > 0;
      const nextOrder = sanitizeEditorTabOrder(s.mainPanelTabOrder as string[], tabs).filter(
        (tab) => tab !== 'fileEdit',
      );
      const requestedActive =
        s.mainPanelActiveTab === tabId ? (nextActive ?? 'job') : s.mainPanelActiveTab;
      const nextMainActive = reconcileMainPanelActiveTab({
        currentMainPanelActiveTab: requestedActive,
        nextTabs: tabs,
        nextActiveEditorTabId: nextActive,
      });
      return {
        editorTabs: tabs,
        activeEditorTabId: nextActive,
        mainPanelOpenTabs: {
          ...s.mainPanelOpenTabs,
          fileEdit: hasTabs,
        },
        mainPanelActiveTab: nextMainActive,
        mainPanelTabOrder: nextOrder,
      };
    });

    if (nextToOpen?.path) {
      const syncUnpinnedTab = nextToOpen.id === UNPINNED_EDITOR_TAB_ID;
      get().openFile(nextToOpen.path, { syncUnpinnedTab });
      return;
    }
    if (shouldClearSelected) {
      set({ selectedFile: undefined });
      get().resetCurrentFile?.();
    }
  },

  clearEditorTabs: () => {
    set((s: any) => ({
      editorTabs: [],
      activeEditorTabId: null,
      mainPanelOpenTabs: {
        ...s.mainPanelOpenTabs,
        fileEdit: false,
      },
      mainPanelActiveTab: isEditorTabId(s.mainPanelActiveTab) ? 'job' : s.mainPanelActiveTab,
      mainPanelTabOrder: s.mainPanelTabOrder.filter((t: string) => !isEditorTabId(t)),
    }));
  },

  syncVirtualEditorTabsFromBuffers: (buffers) => {
    set((s: any) => {
      const tabs = [...((s.editorTabs ?? []) as EditorTab[])];
      const byId = new Map(tabs.map((tab) => [tab.id, tab]));
      const seenVirtualIds = new Set<string>();
      const turnInfo = buildTurnInfoMap(s.chatEvents ?? []);
      const createdIds: Array<`editor:virtual:${string}`> = [];

      for (const snapshot of Object.values(buffers ?? {})) {
        const pendingCards = snapshot?.pendingCards ?? {};
        const source = resolveVirtualTabSource({
          turnInfo,
          turnId: snapshot.turnId,
          selectedJobType: s.selectedJobType,
        });
        if (!source) continue;
        const meta = turnInfo.get(snapshot.turnId);

        for (const pending of Object.values(pendingCards)) {
          const card = pending as import('@ant/shared').PendingCardSnapshot;
          if (!shouldRenderVirtualPreviewCard(card)) continue;

          const filePath = getPendingCardFilePath(card);
          if (!filePath) continue;
          const title = fileTitleFromPath(filePath);
          const id = makeVirtualEditorTabId(card.cardId);
          seenVirtualIds.add(id);
          const next: EditorTab = {
            id,
            cardId: card.cardId,
            title,
            kind: 'virtual',
            pinned: true,
            readOnly: true,
            path: filePath,
            content: card.streamedOutput ?? '',
            status: 'streaming',
            turnId: snapshot.turnId,
            jobId: meta?.jobId,
            source,
          };
          if (!byId.has(id)) createdIds.push(id as `editor:virtual:${string}`);
          byId.set(id, { ...(byId.get(id) ?? {}), ...next });
        }
      }

      const nextTabs = Array.from(byId.values()).filter((tab) => {
        if (tab.kind !== 'virtual') return true;
        if (tab.status === 'ready') return true;
        return seenVirtualIds.has(tab.id);
      });
      const hasTabs = nextTabs.length > 0;
      const nextOrderBase = sanitizeEditorTabOrder(s.mainPanelTabOrder as string[], nextTabs).filter(
        (tab) => tab !== 'fileEdit',
      );
      if (createdIds.length === 0) {
        const nextActive =
          s.activeEditorTabId && nextTabs.some((tab) => tab.id === s.activeEditorTabId)
            ? s.activeEditorTabId
            : null;
        const nextMainActive = reconcileMainPanelActiveTab({
          currentMainPanelActiveTab: s.mainPanelActiveTab,
          nextTabs,
          nextActiveEditorTabId: nextActive,
        });
        return {
          editorTabs: nextTabs,
          activeEditorTabId: nextActive,
          mainPanelOpenTabs: {
            ...s.mainPanelOpenTabs,
            fileEdit: hasTabs,
          },
          mainPanelActiveTab: nextMainActive,
          mainPanelTabOrder: nextOrderBase,
        };
      }

      const newOrder = [...nextOrderBase];
      for (const createdId of createdIds) {
        const filtered = newOrder.filter((tab) => tab !== createdId);
        filtered.push(createdId);
        newOrder.splice(0, newOrder.length, ...filtered);
      }
      const nextActiveId = createdIds[createdIds.length - 1];
      return {
        editorTabs: nextTabs,
        activeEditorTabId: nextActiveId,
        mainPanelActiveTab: nextActiveId,
        mainPanelOpenTabs: {
          ...s.mainPanelOpenTabs,
          fileEdit: true,
        },
        mainPanelTabOrder: newOrder,
      };
    });
  },

  promoteVirtualEditorTabToReal: ({ cardId, filePath, source }) => {
    if (!cardId || !filePath) return;
    const realId = makePinnedRealTabId(filePath);
    const virtualId = makeVirtualEditorTabId(cardId);
    set((s: any) => {
      const tabs = [...((s.editorTabs ?? []) as EditorTab[])].filter(
        (tab) => !(tab.kind === 'virtual' && tab.cardId === cardId),
      );
      if (!tabs.some((tab) => tab.id === realId)) {
        tabs.push({
          id: realId,
          title: fileTitleFromPath(filePath),
          path: filePath,
          kind: 'real',
          pinned: true,
          readOnly: false,
          status: 'ready',
          source,
        });
      }

      const newOrder = sanitizeEditorTabOrder(s.mainPanelTabOrder as string[], tabs).filter(
        (tab) => tab !== realId && tab !== 'fileEdit',
      );
      const fromVirtual = newOrder.findIndex((tab) => tab === virtualId);
      if (fromVirtual >= 0) {
        newOrder[fromVirtual] = realId as MainPanelTabOrderItem;
      } else {
        const moved = moveTabIdToOrderEnd(newOrder, realId as MainPanelTabOrderItem);
        newOrder.splice(0, newOrder.length, ...moved);
      }
      return {
        editorTabs: tabs,
        activeEditorTabId: realId,
        mainPanelActiveTab: realId,
        mainPanelOpenTabs: {
          ...s.mainPanelOpenTabs,
          fileEdit: true,
        },
        mainPanelTabOrder: newOrder,
      };
    });
    get().openFile(filePath, { syncUnpinnedTab: false });
    get().setFileViewMode(filePath, 'preview');
  },

  removeVirtualEditorTabsByJobId: (jobId) => {
    if (!jobId) return;
    let nextToOpen: EditorTab | undefined;
    set((s: any) => {
      const tabs = [...((s.editorTabs ?? []) as EditorTab[])];
      const removedIds = new Set(
        tabs.filter((tab) => tab.kind === 'virtual' && tab.jobId === jobId).map((tab) => tab.id),
      );
      if (removedIds.size === 0) return {};

      const nextTabs = tabs.filter((tab) => !removedIds.has(tab.id));
      const nextActive = removedIds.has(s.activeEditorTabId)
        ? (nextTabs.find((tab) => tab.id === UNPINNED_EDITOR_TAB_ID)?.id ?? nextTabs[0]?.id ?? null)
        : s.activeEditorTabId;
      const activeTab = nextTabs.find((tab) => tab.id === nextActive);
      if (activeTab?.kind === 'real' && activeTab.path) nextToOpen = activeTab;
      const hasTabs = nextTabs.length > 0;
      const nextOrder = sanitizeEditorTabOrder(s.mainPanelTabOrder as string[], nextTabs).filter(
        (tab) => tab !== 'fileEdit',
      );
      const requestedActive =
        removedIds.has(s.mainPanelActiveTab) ? (nextActive ?? 'job') : s.mainPanelActiveTab;
      const nextMainActive = reconcileMainPanelActiveTab({
        currentMainPanelActiveTab: requestedActive,
        nextTabs,
        nextActiveEditorTabId: nextActive,
      });

      return {
        editorTabs: nextTabs,
        activeEditorTabId: nextActive,
        mainPanelOpenTabs: {
          ...s.mainPanelOpenTabs,
          fileEdit: hasTabs,
        },
        mainPanelActiveTab: nextMainActive,
        mainPanelTabOrder: nextOrder,
      };
    });
    if (nextToOpen?.path) {
      const syncUnpinnedTab = nextToOpen.id === UNPINNED_EDITOR_TAB_ID;
      get().openFile(nextToOpen.path, { syncUnpinnedTab });
    }
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

      const prevGroup = (s.selectedActionId ?? null) as IntentGroup | null;
      const nextGroup = (actionId ?? null) as IntentGroup | null;
      const { basis, cache } = applyGroupSwap(
        s.actionMetadata.basis as Basis | undefined,
        (s.actionMetadata.techTierByGroup ?? {}) as GroupCache,
        prevGroup,
        nextGroup,
      );

      return {
        mainPanelActiveTab: 'actions',
        mainPanelOpenTabs: { ...s.mainPanelOpenTabs, actions: true },
        mainPanelTabOrder: newOrder,
        actionsStep: step,
        basisEditInitialTier: undefined,
        selectedActionId: actionId || null,
        selectedIntentId,
        // D22: preserve sticky workspace-level domain across action navigation.
        actionMetadata: {
          basis,
          domain: s.actionMetadata.domain,
          techTierByGroup: cache,
        },
      };
    });
  },

  setActionsStep: (step) => {
    set({ actionsStep: step });
  },

  setBasisEditInitialTier: (tier) => {
    set({ basisEditInitialTier: tier });
  },

  selectAction: (actionId: string) => {
    set((s: any) => {
      const prevGroup = (s.selectedActionId ?? null) as IntentGroup | null;
      const nextGroup = actionId as IntentGroup;
      const { basis, cache } = applyGroupSwap(
        s.actionMetadata.basis as Basis | undefined,
        (s.actionMetadata.techTierByGroup ?? {}) as GroupCache,
        prevGroup,
        nextGroup,
      );
      return {
        selectedActionId: actionId,
        selectedIntentId: null,
        // D22: preserve sticky workspace-level domain. techTier is scoped
        // per IntentGroup — `applyGroupSwap` rotates the live mirror.
        actionMetadata: {
          basis,
          domain: s.actionMetadata.domain,
          techTierByGroup: cache,
        },
      };
    });
  },

  selectIntent: (intentId: string) => {
    const derived = deriveFromIntent(intentId as Parameters<typeof deriveFromIntent>[0]);
    set((s: any) => {
      const normalizedBasis = applyLockedStackToBasis(
        s.actionMetadata.basis as Basis | undefined,
        intentId,
      );

      // Mirror the (possibly normalized) live techTier into the per-group
      // cache so a later group switch saves the locked value, not the
      // pre-lock stack the user came in with.
      const group = (s.selectedActionId ?? null) as IntentGroup | null;
      let nextCache = (s.actionMetadata.techTierByGroup ?? {}) as GroupCache;
      if (group) {
        nextCache = { ...nextCache };
        if (normalizedBasis?.techTier) {
          nextCache[group] = normalizedBasis.techTier;
        } else {
          delete nextCache[group];
        }
      }

      return {
        selectedIntentId: intentId,
        actionMetadata: {
          intent: intentId,
          basis: normalizedBasis,
          // D22: preserve sticky workspace-level domain.
          domain: s.actionMetadata.domain,
          techTierByGroup: nextCache,
        },
        selectedAgent: derived.agent,
        selectedJobType: derived.jobType as any,
        pendingChatInput: { message: '', source: 'intent-change' },
      };
    });
  },

  updateActionMetadata: (patch: Partial<ActionMetadata>) => {
    set((s: any) => {
      const next = { ...s.actionMetadata, ...patch };
      const updates: any = {};

      // Hard-exclusive UiSource invariant — the SSOT funnel
      // (`normalizeUiSourceRefs`, canonical.ts) drops any mixed-UiSource
      // input down to the highest-priority source present (ant > figma >
      // handoff). Applied here, every entry point — auto-fill,
      // toggleFile / toggleFiles, mention-driven assigns — produces a
      // store that satisfies the invariant by construction. Downstream
      // surfaces (SlotEntryList card lock, BE detect, validateUiSourceExclusivity)
      // can then assume a single-source state without re-checking.
      if (next.refs && next.refs.length > 0) {
        next.refs = normalizeUiSourceRefs(next.refs);
        if (next.refs.length === 0) next.refs = undefined;
      }
      if (next.context && next.context.length > 0) {
        next.context = normalizeUiSourceRefs(next.context);
        if (next.context.length === 0) next.context = undefined;
      }

      if (patch.intent !== undefined && patch.intent !== s.actionMetadata.intent) {
        next.refs = undefined;
        next.context = undefined;
        next.target = undefined;

        if (patch.intent) {
          const derived = deriveFromIntent(patch.intent);
          updates.selectedAgent = derived.agent;
          updates.selectedJobType = derived.jobType;
          // Re-apply intent-level lockedStack so an IntentTabNav swap from
          // gen-sys-be → gen-sys-fe forces stack='frontend' immediately.
          next.basis = applyLockedStackToBasis(next.basis as Basis | undefined, patch.intent);
        }
      }

      if ('refs' in patch && next.intent) {
        const slots = getConfigSlots(next.intent);
        if (slots?.target.kind === 'revise') {
          next.target = next.refs;
        }
      }

      // Phase 2 (D22) — domain transition policy. Centralized here so
      // every entry point (DomainToggle, projectConfigSlice mirror /
      // backfill, future SSE broadcast) shares the same cleanup contract
      // instead of each call site re-implementing it.
      //
      // Two-tier guard: cleanup runs only on actual domain change
      // (game ↔ service); persist (`persistWorkspaceDomain`) runs on
      // every domain patch and short-circuits internally when
      // `cfg.domain === nextDomain`. Splitting the gates lets the
      // backfill path — where store already matches `next` but disk is
      // empty — still trigger the PUT.
      if (patch.domain !== undefined && patch.domain !== s.actionMetadata.domain) {
        // 1) game → service: drop game-only basis tiers and the gameEngine
        //    5th slot. visualTier survives — it is matrix-permitted on both
        //    domains and the user's previous selection is still meaningful.
        if (patch.domain !== 'game' && next.basis) {
          const cleaned = { ...next.basis };
          cleaned.gameArtTier = undefined;
          cleaned.gameContentTier = undefined;
          if (cleaned.techTier?.frontend) {
            cleaned.techTier = {
              ...cleaned.techTier,
              frontend: { ...cleaned.techTier.frontend, gameEngine: undefined },
            };
          }
          if (cleaned.techTier?.backend) {
            cleaned.techTier = {
              ...cleaned.techTier,
              backend: { ...cleaned.techTier.backend, gameEngine: undefined },
            };
          }
          const stillHasAny =
            cleaned.techTier || cleaned.visualTier || cleaned.gameArtTier || cleaned.gameContentTier;
          next.basis = stillHasAny ? cleaned : undefined;
        }

        // 1b) Same gameEngine cleanup applies to the per-group cache so
        //     a stale `phaser` doesn't resurface when the user revisits
        //     a group whose live mirror is no longer active.
        if (patch.domain !== 'game' && next.techTierByGroup) {
          const scrubbed: GroupCache = {};
          for (const key of Object.keys(next.techTierByGroup) as IntentGroup[]) {
            const ttc = next.techTierByGroup[key];
            if (!ttc) continue;
            let cleaned = ttc;
            if (cleaned.frontend?.gameEngine) {
              cleaned = { ...cleaned, frontend: { ...cleaned.frontend, gameEngine: undefined } };
            }
            if (cleaned.backend?.gameEngine) {
              cleaned = { ...cleaned, backend: { ...cleaned.backend, gameEngine: undefined } };
            }
            scrubbed[key] = cleaned;
          }
          next.techTierByGroup = scrubbed;
        }

        // 2) If the currently-selected action card violates the new
        //    domain gate (e.g. `design-game-art` on service or
        //    `design-ui` on game), unwind back
        //    to `pick-action` so the wizard never renders a `selectedId`
        //    whose tab was just hidden by the gate (the original
        //    "intent screen blank" regression).
        const selId = s.selectedActionId as IntentGroup | null;
        if (selId) {
          const def = ACTION_DEFINITIONS.find(d => d.id === selId);
          if (def && !isActionVisibleForDomain(def, patch.domain)) {
            updates.selectedActionId = null;
            updates.selectedIntentId = null;
            updates.actionsStep = 'pick-action';
            updates.basisEditInitialTier = undefined;
            // Drop the now-orphaned per-intent fields too.
            next.intent = undefined;
            next.refs = undefined;
            next.context = undefined;
            next.target = undefined;
          }
        }
      }

      // Persist runs for every domain patch (not just changes) so the
      // disk-backfill path (mirror sees `cfg.domain` undefined, store
      // already at default 'service') still triggers a PUT. The inner
      // `cfg.domain === nextDomain` guard inside `persistWorkspaceDomain`
      // makes refresh / re-entry no-op.
      if (patch.domain !== undefined) {
        const selectedProject = s.selectedProject as string | undefined;
        const cfgData = (s.projectConfig?.data ?? undefined) as
          | ProjectConfig
          | undefined;
        persistWorkspaceDomain(selectedProject, cfgData, patch.domain);
      }

      // techTier cache mirror — keep `basis.techTier` and
      // `techTierByGroup[currentGroup]` in lockstep, and run the
      // group-swap helper if the active group transitions in this update
      // (e.g. domain-gate unwind sets selectedActionId → null above).
      const prevGroup = (s.selectedActionId ?? null) as IntentGroup | null;
      const nextGroup = (
        updates.selectedActionId !== undefined
          ? updates.selectedActionId
          : s.selectedActionId
      ) as IntentGroup | null;
      const swapResult = applyGroupSwap(
        next.basis as Basis | undefined,
        (next.techTierByGroup ?? {}) as GroupCache,
        prevGroup,
        nextGroup,
      );
      next.basis = swapResult.basis;
      next.techTierByGroup = swapResult.cache;

      updates.actionMetadata = next;
      return updates;
    });
  },

  resetActionMetadata: () => {
    set((s: any) => {
      const nextOpen = { ...s.mainPanelOpenTabs, actions: false };
      const nextOrder = s.mainPanelTabOrder.filter((t: string) => t !== 'actions');
      const prevGroup = (s.selectedActionId ?? null) as IntentGroup | null;
      const { basis, cache } = applyGroupSwap(
        s.actionMetadata.basis as Basis | undefined,
        (s.actionMetadata.techTierByGroup ?? {}) as GroupCache,
        prevGroup,
        null,
      );
      return {
        // D22: preserve sticky workspace-level domain. Other-tier basis
        // selections survive; techTier rotates back into the cache so a
        // future `openActionsPanel(group)` restores it.
        actionMetadata: {
          basis,
          domain: s.actionMetadata.domain,
          techTierByGroup: cache,
        },
        selectedIntentId: null,
        actionsStep: 'pick-action' as const,
        basisEditInitialTier: undefined,
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

