import { StateCreator } from 'zustand';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import { AuthState, AuthStatus } from '../types';
import { STORAGE_KEYS, saveToStorage, loadFromStorage, removeFromStorage } from '../storage';

export interface AuthActions {
  setSelectedAgent: (agent: string) => void;
  setSelectedJobType: (jobType: 'design' | 'code' | 'learn' | 'plan' | 'visual') => void;
  setUser: (email: string, organization: string, name?: string, picture?: string) => void;
  clearUser: () => void;
  setAuthStatus: (status: AuthStatus) => void;
  /**
   * Phase 3 — set onboarding flags from the `/auth/me` envelope.
   * Cleared automatically by `clearUser`.
   */
  setOnboardingState: (needsOnboarding: boolean, suggestedOrganizationName: string | null) => void;
}

export type AuthSlice = AuthState & AuthActions;

export const createAuthSlice: StateCreator<any, [], [], AuthSlice> = (set, get) => {
  // Initial authStatus: if a hydrated `userEmail` exists, we must verify
  // the cookie before trusting it (server is the SSOT for session validity).
  // BE mode is unknown at hydration time — `serverMode` is fetched after
  // mount — but a stored `userEmail` only makes sense for cloud, so we
  // always run the verification path when one is present. Local-mode BEs
  // skip auth at the route level regardless of `authStatus`.
  const hydratedUserEmail = loadFromStorage(STORAGE_KEYS.USER_EMAIL);
  const initialAuthStatus: AuthStatus = hydratedUserEmail ? 'verifying' : 'idle';

  return {
  // ==================
  // State
  // ==================
  userEmail: undefined,
  userOrganization: undefined,
  userName: undefined,
  userPicture: undefined,
  authStatus: initialAuthStatus,
  needsOnboarding: false,
  suggestedOrganizationName: null,
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

  setUser: (email, organization, name, picture) => {
    set({
      userEmail: email,
      userOrganization: organization,
      userName: name,
      userPicture: picture,
      authStatus: 'verified',
    });
    saveToStorage(STORAGE_KEYS.USER_EMAIL, email);
    saveToStorage(STORAGE_KEYS.USER_ORGANIZATION, organization);
    // `userName` / `userPicture` are derived from the JWT and replayed on every
    // `/auth/me`, so we intentionally skip localStorage persistence.
  },

  setAuthStatus: (status) => set({ authStatus: status }),

  setOnboardingState: (needsOnboarding, suggestedOrganizationName) =>
    set({ needsOnboarding, suggestedOrganizationName }),

  /**
   * Single SSOT for user disappearance — used by both the explicit
   * sign-out flow (AppNavBar.handleSignOut) and the implicit stale-session
   * detection in App.tsx (cloud-mode `fetchAuthMe` 401). Both flows MUST
   * cascade to lifecycle-dependent state, otherwise hooks like
   * useProjectLifecycle / usePreviewSync / loadSession keep firing
   * protected requests with stale `selectedProject` and produce 401 storms
   * (regression introduced by 538d9e74 "JWT 보안 미들웨어 구축").
   */
  clearUser: () => {
    set({
      userEmail: undefined,
      userOrganization: undefined,
      userName: undefined,
      userPicture: undefined,
      authStatus: 'expired',
      needsOnboarding: false,
      suggestedOrganizationName: null,
    });
    removeFromStorage(STORAGE_KEYS.USER_EMAIL);
    removeFromStorage(STORAGE_KEYS.USER_ORGANIZATION);

    const state = get() as any;
    if (typeof state.reset === 'function') {
      state.reset();
    }
    set({ projects: [], projectsStatus: 'idle' } as any);
    removeFromStorage(STORAGE_KEYS.SELECTED_PROJECT);
    removeFromStorage(STORAGE_KEYS.PROJECT_LAST_FEATURES);
  },
  };
};

