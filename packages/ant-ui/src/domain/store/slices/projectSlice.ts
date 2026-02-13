import { StateCreator } from 'zustand';
import { ProjectState } from '../types';
import { STORAGE_KEYS, saveToStorage, loadFromStorage, removeFromStorage } from '../storage';
import type { Feature } from '@/infrastructure/http/api';

export interface ProjectActions {
  setProjects: (projects: string[]) => void;
  fetchProjects: () => Promise<void>;
  setSelectedProject: (projectId: string | undefined) => void;
  setSelectedFeature: (featureName: string | undefined) => void;
  fetchFeatures: (projectId?: string) => Promise<Feature[]>;
  setFeatures: (features: Feature[]) => void;
  // ✅ Session restore actions
  startSessionRestore: (expectedFeature: string | undefined) => void;
  completeSessionRestore: () => void;
}

export type ProjectSlice = ProjectState & ProjectActions;

export const createProjectSlice: StateCreator<
  ProjectSlice,
  [],
  [],
  ProjectSlice
> = (set, get) => ({
  // ==================
  // State
  // ==================
  projects: [],
  projectsLoaded: false,
  selectedProject: undefined,
  selectedFeature: undefined,
  features: [],
  // ✅ Session restore tracking
  isSessionRestoring: false,
  sessionRestoreCompleted: false,
  expectedFeatureAfterRestore: undefined,

  // ==================
  // Actions
  // ==================
  setProjects: (projects) => set({ projects }),

  fetchProjects: async () => {
    try {
      const state = get() as any;
      // Cloud mode requires authentication
      if (state.backendMode === 'cloud' && !state.userEmail) {
        console.log('[Store] Skipping fetchProjects: Cloud mode requires authentication');
        set({ projects: [], projectsLoaded: true });
        return;
      }
      
      const { listProjects } = await import('@/infrastructure/http/projects');
      const projectList = await listProjects();
      set({ projects: projectList, projectsLoaded: true });
    } catch (error) {
      console.error('Failed to fetch projects:', error);
      set({ projects: [], projectsLoaded: true });
    }
  },

  setSelectedProject: (projectId) => {
    const state = get() as any;
    
    if (!projectId) {
      set({ 
        selectedProject: undefined,
        selectedFeature: undefined,
        features: [],
      } as any);
      // Also clear related state from other slices
      if (state.selectFile) state.selectFile(undefined);
      if (state.setFileTree) state.setFileTree([]);
      if (state.setFileContent) state.setFileContent(undefined);
      if (state.setUnseenArtifacts) state.setUnseenArtifacts([]);
      if (state.setRunning) state.setRunning(false);
      
      removeFromStorage(STORAGE_KEYS.SELECTED_PROJECT);
      // Clear project-last-features mapping when clearing project selection
      // (projectId is undefined here, so just remove the mapping key entirely)
      removeFromStorage(STORAGE_KEYS.PROJECT_LAST_FEATURES);
    } else {
      // ✅ Check if we need to restore last feature
      const projectFeatures = loadFromStorage(STORAGE_KEYS.PROJECT_LAST_FEATURES) || {};
      const lastFeature = projectFeatures[projectId];
      const needsRestore = lastFeature !== undefined;
      
      // ✅ If restoring, start session restore to block branch manager
      if (needsRestore) {
        console.log(`[Store] 🚀 Starting restore for ${projectId}, expected feature: ${lastFeature || 'undefined (base)'}`);
        get().startSessionRestore(lastFeature);
      }
      
      // Just set the project, features will be loaded separately
      // ✅ Also clear features & selectedFeature immediately to prevent stale state
      set({ 
        selectedProject: projectId,
        selectedFeature: undefined,
        features: [],
        session: undefined,
      } as any);
      // Clear related state
      if (state.selectFile) state.selectFile(undefined);
      if (state.setFileTree) state.setFileTree([]);
      if (state.setFileContent) state.setFileContent(undefined);
      if (state.setUnseenArtifacts) state.setUnseenArtifacts([]);
      
      saveToStorage(STORAGE_KEYS.SELECTED_PROJECT, projectId);
      
      // Fetch features list (async, non-blocking)
      get().fetchFeatures(projectId);
      
      // ✅ Restore last selected feature for this project (if exists)
      if (needsRestore) {
        console.log(`[Store] 🔄 Will restore last feature for ${projectId}: ${lastFeature || 'undefined (base)'}`);
        
        // Wait for features to load, then set the feature
        const maxAttempts = 50;
        let attempts = 0;
        
        const pollForFeatures = setInterval(() => {
          const currentState = get() as any;
          const currentFeatures = currentState.features;
          
          if (attempts >= maxAttempts) {
            console.warn('[Store] ⚠️ Feature restore timeout');
            clearInterval(pollForFeatures);
            currentState.setSelectedFeature(undefined);
            currentState.completeSessionRestore();
            return;
          }
          
          // Check if features loaded
          const featuresLoaded = currentFeatures.length > 0 || lastFeature === undefined;
          
          if (featuresLoaded) {
            clearInterval(pollForFeatures);
            
            if (lastFeature === undefined) {
              // Restore to base branch
              console.log('[Store] ✅ Restoring to base branch (undefined)');
              currentState.setSelectedFeature(undefined);
              currentState.completeSessionRestore();
            } else {
              // Check if feature exists
              const featureExists = currentFeatures.some((f: any) => f.name === lastFeature);
              if (featureExists) {
                console.log(`[Store] ✅ Restoring feature: ${lastFeature}`);
                currentState.setSelectedFeature(lastFeature);
                currentState.completeSessionRestore();
              } else {
                console.warn(`[Store] ⚠️ Last feature "${lastFeature}" not found, staying on undefined`);
                currentState.setSelectedFeature(undefined);
                currentState.completeSessionRestore();
              }
            }
          }
          
          attempts++;
        }, 100);
      } else {
        console.log(`[Store] ℹ️ No last feature found for ${projectId}, selectedFeature cleared`);
        // ✅ Feature already cleared above via set({ selectedFeature: undefined })
        // No additional action needed
      }
    }
  },

  setSelectedFeature: (featureName) => {
    const state = get() as any;
    
    // ✅ CRITICAL: Update IDE reload timestamp to force VS Code to reload workspace
    // This is necessary because VS Code Server runs in Docker and shares state
    set({ ideReloadTimestamp: Date.now() } as any);
    
    // Calculate isRunning for NEW feature
    const newFeatureKey = state.selectedProject && featureName ? `${state.selectedProject}/${featureName}` : null;
    const newFeatureIsRunning = newFeatureKey ? !!state.runningJobsByFeature[newFeatureKey] : false;
    
    console.log(`[Store] 🔀 Feature changed to: ${featureName || 'none'}`);
    if (newFeatureKey) {
      console.log(`   Feature key: ${newFeatureKey}`);
      console.log(`   Has running job: ${newFeatureIsRunning}`);
    }
    
    set({ 
      selectedFeature: featureName,
    } as any);
    
    // Clear related state from other slices
    if (state.selectFile) state.selectFile(undefined);
    if (state.setFileTree) state.setFileTree([]);
    if (state.setFileContent) state.setFileContent(undefined);
    if (state.setUnseenArtifacts) state.setUnseenArtifacts([]);
    if (state.setRunning) {
      // Only update isRunning flag, don't call full setRunning
      set({ isRunning: newFeatureIsRunning } as any);
    }
    
    if (featureName) {
      // Save project → feature mapping
      if (state.selectedProject) {
        const projectFeatures = loadFromStorage(STORAGE_KEYS.PROJECT_LAST_FEATURES) || {};
        projectFeatures[state.selectedProject] = featureName;
        saveToStorage(STORAGE_KEYS.PROJECT_LAST_FEATURES, projectFeatures);
        console.log(`[Store] 💾 Saved last feature for ${state.selectedProject}: ${featureName}`);
      }
      
      // Load session.json when feature is selected
      const { selectedProject, selectedJobType } = state;
      if (selectedProject) {
        (async () => {
          try {
            const { fetchFeatureSession } = await import('@/infrastructure/http/api');
            
            console.log(`[Store] 📂 Loading session for job type: ${selectedJobType}`);
            const session = await fetchFeatureSession(selectedProject, featureName, selectedJobType);
            
            if (session) {
              console.log(`[Store] ✅ Session loaded for ${selectedJobType}:`, {
                hasJobId: !!session?.state?.jobId,
                taskCount: session?.state?.taskQueue?.length || 0,
                completedCount: session?.state?.completedTasks?.length || 0
              });
            } else {
              console.log(`[Store] ℹ️ No session found for ${selectedJobType}`);
            }
            
            set({ session: session || undefined } as any);
          } catch (error) {
            console.error('[Store] Failed to load session:', error);
            set({ session: undefined } as any);
          }
        })();
      }
      
      // Initialize SSE
      if (typeof state.initializeSSE === 'function') {
        state.initializeSSE();
      }
    } else {
      // Clear project → feature mapping when setting to undefined
      if (state.selectedProject) {
        const projectFeatures = loadFromStorage(STORAGE_KEYS.PROJECT_LAST_FEATURES) || {};
        delete projectFeatures[state.selectedProject];
        saveToStorage(STORAGE_KEYS.PROJECT_LAST_FEATURES, projectFeatures);
        console.log(`[Store] 🗑️ Cleared last feature for ${state.selectedProject}`);
      }
      
      set({ session: undefined } as any);
    }
  },

  fetchFeatures: async (projectId) => {
    const state = get() as any;
    const targetProject = projectId || state.selectedProject;
    const { backendMode, userEmail } = state;
    
    if (!targetProject) {
      set({ features: [] });
      return [];
    }
    
    // Cloud mode requires authentication
    if (backendMode === 'cloud' && !userEmail) {
      console.log('[Store] Skipping fetchFeatures: Cloud mode requires authentication');
      set({ features: [] });
      return [];
    }
    
    try {
      const { fetchFeatures: apiFetchFeatures } = await import('@/infrastructure/http/api');
      const featureList = await apiFetchFeatures(targetProject);
      
      // Filter out base branch names
      const baseBranchNames = ['main', 'master', 'develop'];
      const filteredFeatures = featureList.filter(f => !baseBranchNames.includes(f.name.toLowerCase()));
      
      console.log(`[Store] 📋 Fetched ${filteredFeatures.length} features for ${targetProject}:`, filteredFeatures.map(f => f.name));
      if (featureList.length !== filteredFeatures.length) {
        console.log(`[Store] ⚠️ Filtered out base branches:`, featureList.filter(f => baseBranchNames.includes(f.name.toLowerCase())).map(f => f.name));
      }
      
      set({ features: filteredFeatures });
      return filteredFeatures;
    } catch (error) {
      console.error('[Store] Failed to fetch features:', error);
      set({ features: [] });
      return [];
    }
  },

  setFeatures: (features) => set({ features }),
  
  // ✅ Session restore actions
  startSessionRestore: (expectedFeature) => {
    console.log(`[Store] 🚀 Starting session restore, expected feature: ${expectedFeature || 'undefined'}`);
    set({
      isSessionRestoring: true,
      sessionRestoreCompleted: false,
      expectedFeatureAfterRestore: expectedFeature,
    });
  },
  
  completeSessionRestore: () => {
    console.log(`[Store] ✅ Session restore completed`);
    set({
      isSessionRestoring: false,
      sessionRestoreCompleted: true,
      expectedFeatureAfterRestore: undefined,
    });
  },
});

