import { StateCreator } from 'zustand';
import { STORAGE_KEYS, removeFromStorage } from '../storage';
import { MAIN_PANEL_TABS_ALL_CLOSED } from '../types';
import {
  identityResetPatch,
  tabsToCloseOnTransition,
  type IdentityScope,
} from '../../project-world/identityTransition';
import { makeFeatureKey } from './deploySlice';

export interface ResetActions {
  /**
   * Full logout / auth-teardown wipe. Superset of `applyIdentityTransition`:
   * clears identity + account/job state, closes ALL tabs, and evicts every
   * per-feature preview/deploy bucket.
   */
  reset: () => void;
  /**
   * SSOT for the synchronous half of a `(project, feature)` identity change.
   * `setSelectedProject` / `setSelectedFeature` delegate to this instead of
   * hand-maintaining overlapping `set({...})` blocks. `prevProject` /
   * `prevFeature` identify the bucket to evict — capture them from the store
   * BEFORE flipping the identity. See identityTransition.ts.
   */
  applyIdentityTransition: (input: {
    scope: IdentityScope;
    prevProject?: string;
    prevFeature?: string;
  }) => void;
}

export type ResetSlice = ResetActions;

export const createResetSlice: StateCreator<any, [], [], ResetSlice> = (set, get) => ({
  applyIdentityTransition: ({ scope, prevProject, prevFeature }) => {
    const state = get() as any;

    // (1) Scope-aware field clear (feature vs project runtime).
    set({ ...identityResetPatch(scope) } as any);

    // (2) Cross-slice file/editor + transfer-source clears.
    state.selectFile?.(undefined);
    state.setFileTree?.([]);
    state.resetCurrentFile?.();
    state.setUnseenArtifacts?.([]);
    state.clearSendPreselectedSource?.();

    // (3) Evict the previous feature's preview / deploy / custom-domain
    // buckets. The backend preview server is intentionally left running.
    const prevKey = makeFeatureKey(prevProject, prevFeature);
    if (prevKey) {
      state.removePreviewEntry?.(prevKey);
      state.removeDeployEntry?.(prevKey);
    }

    // (4) Close scope-appropriate secondary tabs (previewConfig closes only
    // on a project change — see tabsToCloseOnTransition).
    for (const tab of tabsToCloseOnTransition(scope)) {
      state.closeMainPanelTab?.(tab);
    }
  },

  reset: () => {
    const state = get() as any;

    set({
      // Shared feature/project runtime clear (project-scope = full wipe).
      ...identityResetPatch('project'),
      // Identity + account/job teardown (logout-only extras).
      selectedProject: undefined,
      selectedFeature: undefined,
      isStopping: false,
      userStoppedJobId: null,
      lastJobFailed: false,
      runningJobsByFeature: {},
      currentJob: null,
      connectionStatus: 'disconnected',
      mainPanelActiveTab: 'job',
      mainPanelOpenTabs: { ...MAIN_PANEL_TABS_ALL_CLOSED },
      mainPanelTabOrder: [],
      actionsStep: 'pick-action',
      basisEditInitialTier: undefined,
      basisEditOverride: false,
      selectedActionId: null,
      selectedIntentId: null,
      // D22: project domain default seed (workspace-level sticky slot).
      actionMetadata: { domain: 'service' },
      highlightedArtifactDirs: [],
      artifactUploadRequest: null,
      // Expand state belongs to a tenant's tree — it must not survive into the
      // next account's. The two sets are one invariant, so both are cleared.
      expandedArtifactDirs: new Set<string>(),
      seenArtifactTopLevelDirs: new Set<string>(),
      bridgeConnected: null,
      bridgeDetected: false,
      figmaDesktopReachable: false,
      accountConfigScrollTarget: null,
      // Logout wipes every per-feature preview/deploy bucket (not just one).
      previewByFeature: {},
      deployByFeature: {},
      customDomainsByFeature: {},
      customDomainEnabledByFeature: {},
    });

    // Cross-slice file/transfer clears (same primitives the applier uses).
    state.selectFile?.(undefined);
    state.setFileTree?.([]);
    state.resetCurrentFile?.();
    state.setUnseenArtifacts?.([]);
    state.clearSendPreselectedSource?.();

    // Clear job-related localStorage
    removeFromStorage(STORAGE_KEYS.RUNNING_TASK);
    removeFromStorage(STORAGE_KEYS.TASK_START_TIME);
    removeFromStorage(STORAGE_KEYS.TASK_MODE);
    removeFromStorage(STORAGE_KEYS.DISMISSED_INTERRUPT_TIMESTAMP);
  },
});
