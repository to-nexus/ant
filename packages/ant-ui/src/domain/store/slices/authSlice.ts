import { StateCreator } from 'zustand';
import { sseManager } from '@/infrastructure/sse/SSEManager';
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

    state.syncViewToJobType(jobType);

    if (state.selectedProject && state.selectedFeature) {
      console.log(`[Store] 🔄 Job type changed to '${jobType}', loading session + kanban...`);

      (async () => {
        try {
          // Fetch session + jobType-scoped kanban + jobId history in parallel.
          // The history is what guarantees the Job tab never shows an empty
          // board when the jobType has prior runs: if the session-scoped
          // kanban lacks a jobId (e.g. session.state is stale or not yet
          // written for this jobType), we fall back to the most-recent
          // history entry and switch the board there.
          const [{ fetchFeatureSession, fetchJobHistory }, { fetchKanbanData }] = await Promise.all([
            import('@/infrastructure/http/api'),
            import('@/infrastructure/http/api/kanban'),
          ]);
          const [session, kanbanData, history] = await Promise.all([
            fetchFeatureSession(state.selectedProject!, state.selectedFeature!, jobType),
            fetchKanbanData(state.selectedProject!, state.selectedFeature!, jobType),
            fetchJobHistory(state.selectedProject!, state.selectedFeature!, jobType),
          ]);

          if (get().selectedJobType !== jobType) {
            console.log(`[Store] Discarding stale response for ${jobType} (current: ${get().selectedJobType})`);
            return;
          }

          set({ session: session || undefined });
          get().updateKanban(kanbanData);
          console.log(`[Store] ✅ Session + kanban loaded for ${jobType}`);

          // Auto-select the most-recent jobId when the jobType-scoped kanban
          // has no jobId but the history does. Without this, switching job
          // types in chat and coming back could leave the Job tab empty
          // even though completed runs exist for that jobType.
          const hasBoardJobId = !!kanbanData?.jobId;
          if (!hasBoardJobId && history.jobs.length > 0) {
            const latest = history.jobs[0];
            console.log(
              `[Store] ↩️ No current jobId for '${jobType}', auto-selecting latest: ${latest.jobId}`,
            );
            await get().selectJobId(latest.jobId, { live: latest.live });
          }
        } catch (error) {
          console.error('[Store] Failed to switch job type:', error);
          if (get().selectedJobType === jobType) {
            set({ session: undefined });
          }
        }
      })();

      sseManager.updateJobParam(jobType);
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

