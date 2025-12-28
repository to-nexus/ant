import { create } from 'zustand';
import { createProjectSlice, ProjectSlice } from './slices/projectSlice';
import { createFileSlice, FileSlice } from './slices/fileSlice';
import { createJobSlice, JobSlice } from './slices/jobSlice';
import { createSSESlice, SSESlice } from './slices/sseSlice';
import { createUISlice, UISlice } from './slices/uiSlice';
import { createGitSlice, GitSlice } from './slices/gitSlice';
import { createDevServerSlice, DevServerSlice } from './slices/devServerSlice';
import { createAuthSlice, AuthSlice } from './slices/authSlice';
import { createConfigSlice, ConfigSlice } from './slices/configSlice';
import { createResetSlice, ResetSlice } from './slices/resetSlice';
import { createChatSlice, ChatSlice } from './slices/chatSlice';
import { loadFromStorage, STORAGE_KEYS } from './storage';

// Combined store type
export type Store = ProjectSlice & 
  FileSlice & 
  JobSlice & 
  SSESlice & 
  UISlice & 
  GitSlice & 
  DevServerSlice & 
  AuthSlice & 
  ConfigSlice & 
  ResetSlice &
  ChatSlice;

// Initialize persistent state from localStorage
function initializePersistentState() {
  const userEmail = loadFromStorage(STORAGE_KEYS.USER_EMAIL);
  const userOrganization = loadFromStorage(STORAGE_KEYS.USER_ORGANIZATION);
  const dismissedInterruptTimestamp = loadFromStorage(STORAGE_KEYS.DISMISSED_INTERRUPT_TIMESTAMP);
  const storedMainView = loadFromStorage(STORAGE_KEYS.MAIN_VIEW);
  const selectedProject = loadFromStorage(STORAGE_KEYS.SELECTED_PROJECT) as string | null;
  const projectLastFeatures = loadFromStorage(STORAGE_KEYS.PROJECT_LAST_FEATURES) as Record<string, string | undefined> | null;
  const selectedFeature = selectedProject && projectLastFeatures ? (projectLastFeatures[selectedProject] as any) : undefined;
  // Backward-compat mapping: 'editor' -> 'codeIde'
  const normalizedMainView = storedMainView === 'editor' ? 'codeIde' : storedMainView;
  const mainView = (normalizedMainView === 'codeIde' || normalizedMainView === 'agents') ? normalizedMainView : 'agents';
  
  return {
    userEmail,
    userOrganization,
    dismissedInterruptTimestamp,
    mainView,
    selectedProject: selectedProject || undefined,
    selectedFeature,
  };
}

// Create store by combining all slices
export const useStore = create<Store>((set, get, store) => {
  const persistent = initializePersistentState();
  
  return {
    ...createProjectSlice(set, get, store),
    ...createFileSlice(set, get, store),
    ...createJobSlice(set, get, store),
    ...createSSESlice(set, get, store),
    ...createUISlice(set, get, store),
    ...createGitSlice(set, get, store),
    ...createDevServerSlice(set, get, store),
    ...createAuthSlice(set, get, store),
    ...createConfigSlice(set, get, store),
    ...createResetSlice(set, get, store),
    ...createChatSlice(set, get, store),
    
    // Override with persistent state
    userEmail: persistent.userEmail,
    userOrganization: persistent.userOrganization,
    dismissedInterruptTimestamp: persistent.dismissedInterruptTimestamp,
    mainView: persistent.mainView,
    selectedProject: persistent.selectedProject,
    selectedFeature: persistent.selectedFeature,
  };
});

