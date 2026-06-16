import { create } from 'zustand';
import { createProjectSlice, ProjectSlice } from './slices/projectSlice';
import { createFileSlice, FileSlice } from './slices/fileSlice';
import { createJobSlice, JobSlice } from './slices/jobSlice';
import { createSSESlice, SSESlice } from './slices/sseSlice';
import { createUISlice, UISlice } from './slices/uiSlice';
import { createPreviewSlice, PreviewSlice } from './slices/previewSlice';
import { createAuthSlice, AuthSlice } from './slices/authSlice';
import { createConfigSlice, ConfigSlice } from './slices/configSlice';
import { createProjectConfigSlice, ProjectConfigSlice } from './slices/projectConfigSlice';
import { createResetSlice, ResetSlice } from './slices/resetSlice';
import { createChatSlice, ChatSlice } from './slices/chatSlice';
import { createFeatureLogSlice, FeatureLogSlice } from './slices/featureLogSlice';
import { createTransferSlice, TransferSlice } from './slices/transferSlice';
import { createDeploySlice, DeploySlice } from './slices/deploySlice';
import { createProjectDeletionSlice, ProjectDeletionSlice } from './slices/projectDeletionSlice';
import { createFeatureDeletionSlice, FeatureDeletionSlice } from './slices/featureDeletionSlice';
import type { BillingSlice } from './slices/billing.types';
import { createGitWorldSlice, type GitWorldSlice } from '../git-world';
import { getOptionalSlices } from './registry';
import { loadFromStorage, STORAGE_KEYS } from './storage';

// Combined store type
export type Store = ProjectSlice &
  FileSlice &
  JobSlice &
  SSESlice &
  UISlice &
  GitWorldSlice &
  PreviewSlice &
  DeploySlice &
  ProjectDeletionSlice &
  FeatureDeletionSlice &
  AuthSlice &
  ConfigSlice &
  ProjectConfigSlice &
  ResetSlice &
  ChatSlice &
  FeatureLogSlice &
  TransferSlice &
  BillingSlice;

// Initialize persistent state from localStorage
function initializePersistentState() {
  const dismissedInterruptTimestamp = loadFromStorage(STORAGE_KEYS.DISMISSED_INTERRUPT_TIMESTAMP);
  const storedMainView = loadFromStorage(STORAGE_KEYS.MAIN_VIEW);
  const selectedProject = loadFromStorage(STORAGE_KEYS.SELECTED_PROJECT) as string | null;
  const projectLastFeatures = loadFromStorage(STORAGE_KEYS.PROJECT_LAST_FEATURES) as Record<string, string | undefined> | null;
  const selectedFeature = selectedProject && projectLastFeatures ? (projectLastFeatures[selectedProject] as any) : undefined;
  // Backward-compat mapping: 'editor' -> 'codeIde'
  const normalizedMainView = storedMainView === 'editor' ? 'codeIde' : storedMainView;
  const mainView = (normalizedMainView === 'codeIde' || normalizedMainView === 'agents') ? normalizedMainView : 'agents';
  
  const userEmail = loadFromStorage(STORAGE_KEYS.USER_EMAIL) as string | undefined;
  const userOrganization = loadFromStorage(STORAGE_KEYS.USER_ORGANIZATION) as string | undefined;
  
  return {
    dismissedInterruptTimestamp,
    mainView,
    selectedProject: selectedProject || undefined,
    selectedFeature,
    userEmail: userEmail || undefined,
    userOrganization: userOrganization || undefined,
  };
}

// Create store by combining all slices
export const useStore = create<Store>((set, get, store) => {
  const persistent = initializePersistentState();

  const slices: Record<string, unknown> = {
    ...createProjectSlice(set, get, store),
    ...createFileSlice(set, get, store),
    ...createJobSlice(set, get, store),
    ...createSSESlice(set, get, store),
    ...createUISlice(set, get, store),
    ...createGitWorldSlice(set, get, store),
    ...createPreviewSlice(set, get, store),
    ...createAuthSlice(set, get, store),
    ...createConfigSlice(set, get, store),
    ...createProjectConfigSlice(set, get, store),
    ...createResetSlice(set, get, store),
    ...createChatSlice(set, get, store),
    ...createFeatureLogSlice(set, get, store),
    ...createTransferSlice(set, get, store),
    ...createDeploySlice(set, get, store),
    ...createProjectDeletionSlice(set, get, store),
    ...createFeatureDeletionSlice(set, get, store),
  };

  // Optional cloud slices (billing today) register themselves before the store
  // is created — see `registry.ts` + `main.tsx`. An OSS build registers none.
  for (const creator of getOptionalSlices()) {
    Object.assign(slices, creator(set, get, store));
  }

  // Override with persistent state.
  Object.assign(slices, {
    dismissedInterruptTimestamp: persistent.dismissedInterruptTimestamp,
    mainView: persistent.mainView,
    selectedProject: persistent.selectedProject,
    selectedFeature: persistent.selectedFeature,
    userEmail: persistent.userEmail,
    userOrganization: persistent.userOrganization,
  });

  // Cast through `unknown`: neutral slices are fully present, and the optional
  // cloud slices are folded in at runtime (registry) — TS can't see that here.
  return slices as unknown as Store;
});

