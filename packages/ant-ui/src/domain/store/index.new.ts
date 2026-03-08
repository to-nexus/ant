import { create } from 'zustand';
import { createProjectSlice, ProjectSlice } from './slices/projectSlice';
import { createFileSlice, FileSlice } from './slices/fileSlice';
import { createJobSlice, JobSlice } from './slices/jobSlice';
import { createSSESlice, SSESlice } from './slices/sseSlice';
import { createUISlice, UISlice } from './slices/uiSlice';
import { createGitSlice, GitSlice } from './slices/gitSlice';
import { createPreviewSlice, PreviewSlice } from './slices/previewSlice';
import { createAuthSlice, AuthSlice } from './slices/authSlice';
import { createConfigSlice, ConfigSlice } from './slices/configSlice';
import { createResetSlice, ResetSlice } from './slices/resetSlice';
import { loadFromStorage, STORAGE_KEYS } from './storage';

// Combined store type
export type Store = ProjectSlice & 
  FileSlice & 
  JobSlice & 
  SSESlice & 
  UISlice & 
  GitSlice & 
  PreviewSlice & 
  AuthSlice & 
  ConfigSlice & 
  ResetSlice;

// Initialize persistent state from localStorage
function initializePersistentState() {
  const dismissedInterruptTimestamp = loadFromStorage(STORAGE_KEYS.DISMISSED_INTERRUPT_TIMESTAMP);
  const storedMainView = loadFromStorage(STORAGE_KEYS.MAIN_VIEW);
  // Backward-compat mapping: 'editor' -> 'codeIde'
  const normalizedMainView = storedMainView === 'editor' ? 'codeIde' : storedMainView;
  const mainView = (normalizedMainView === 'codeIde' || normalizedMainView === 'agents') ? normalizedMainView : 'agents';
  
  return {
    dismissedInterruptTimestamp,
    mainView,
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
    ...createPreviewSlice(set, get, store),
    ...createAuthSlice(set, get, store),
    ...createConfigSlice(set, get, store),
    ...createResetSlice(set, get, store),
    
    // Override with persistent state
    dismissedInterruptTimestamp: persistent.dismissedInterruptTimestamp,
    mainView: persistent.mainView,
  };
});

