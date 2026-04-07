import { StateCreator } from 'zustand';
import { AuthState } from '../types';
import { STORAGE_KEYS, saveToStorage, loadFromStorage, removeFromStorage } from '../storage';

export interface AuthActions {
  setSelectedAgent: (agent: string) => void;
  setSelectedJobType: (jobType: 'design' | 'code' | 'learn' | 'plan' | 'visual') => void;
  setUser: (email: string, organization: string) => void;
  clearUser: () => void;
}

export type AuthSlice = AuthState & AuthActions;

export const createAuthSlice: StateCreator<any, [], [], AuthSlice> = (set, get) => ({
  // ==================
  // State
  // ==================
  userEmail: undefined,
  userOrganization: undefined,
  selectedAgent: loadFromStorage(STORAGE_KEYS.SELECTED_AGENT) || 'planner',
  selectedJobType: (loadFromStorage(STORAGE_KEYS.SELECTED_JOB_TYPE) as 'design' | 'code' | 'learn' | 'plan' | 'visual') || 'plan',

  // ==================
  // Actions
  // ==================
  setSelectedAgent: (agent) => {
    set({ selectedAgent: agent });
    saveToStorage(STORAGE_KEYS.SELECTED_AGENT, agent);
  },

  setSelectedJobType: (jobType) => {
    const state = get();
    set({ selectedJobType: jobType });
    saveToStorage(STORAGE_KEYS.SELECTED_JOB_TYPE, jobType);

    // Sync isRunning/currentJobId/workflow SSE from activeJobs
    state.syncViewToJobType(jobType);
    
    // Reload session for new job type
    if (state.selectedProject && state.selectedFeature) {
      console.log(`[Store] 🔄 Job type changed to '${jobType}', reloading session...`);
      
      (async () => {
        try {
          const { fetchFeatureSession } = await import('@/infrastructure/http/api');
          const session = await fetchFeatureSession(state.selectedProject!, state.selectedFeature!, jobType);
          set({ session: session || undefined });
          console.log(`[Store] ✅ Session loaded for ${jobType}`);
        } catch (error) {
          console.error('[Store] Failed to reload session:', error);
          set({ session: undefined });
        }
      })();
      
      // Reconnect SSE to fetch new job type's kanban data
      if (state.reconnectSSE) {
        state.reconnectSSE('kanban');
      }
    }
  },

  setUser: (email, organization) => {
    set({ userEmail: email, userOrganization: organization });
    saveToStorage(STORAGE_KEYS.USER_EMAIL, email);
    saveToStorage(STORAGE_KEYS.USER_ORGANIZATION, organization);
  },

  clearUser: () => {
    set({ userEmail: undefined, userOrganization: undefined });
    removeFromStorage(STORAGE_KEYS.USER_EMAIL);
    removeFromStorage(STORAGE_KEYS.USER_ORGANIZATION);
  },
});

