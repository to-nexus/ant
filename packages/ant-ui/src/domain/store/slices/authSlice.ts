import { StateCreator } from 'zustand';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import { AuthState, AuthStatus, SelectedJobType } from '../types';
import { STORAGE_KEYS, saveToStorage, loadFromStorage, removeFromStorage } from '../storage';
import { resolveAgentForJobType } from '@/shared/utils/constants';
import { isNonTaskJob } from '@ant/shared';
import { restoresLatestRunFromHistory } from './sse/restoresLatestRun';
import { isTenantChange, tenantScrubPatch, removeTenantScopedStorage } from './auth/tenantScrub';
import type { AuthMeEnvelope } from '@ant/auth-client/types';

export interface AuthActions {
  setSelectedAgent: (agent: string) => void;
  setSelectedJobType: (jobType: SelectedJobType) => void;
  /**
   * SSOT writer for the active job identity. Sole writer of the
   * `(selectedAgent, selectedJobType)` pair: resolves the agent from the job
   * type when not given, persists both, and re-points the SSE job param.
   * Fetch-free and does NOT touch runtime view fields (`isRunning`, SSE
   * connect) — those stay owned by `syncViewToJobType` / `selectJobId` / the
   * kanban reducer. Every identity-change site (toolbar, job-list selection,
   * live re-convergence, feature-entry bootstrap) funnels through this.
   */
  applyJobIdentity: (args: {
    jobType: SelectedJobType;
    agent?: string;
    jobId?: string;
  }) => void;
  /**
   * Sole writer of the `/auth/me` identity — user fields, `memberships`, and
   * the org join surface (invites, domain candidates, own join requests,
   * auto-join notice) in one transaction.
   *
   * It takes the WHOLE success envelope on purpose. This used to be two
   * actions split by field group, held together only by a comment saying to
   * call them together — and the two sites that gain a membership mid-session
   * (invite accept, domain join) called only the join-surface half, so a
   * freshly joined org never reached the account switcher until a refresh.
   * With one envelope parameter that half-apply is unspellable.
   *
   * Fetch-free: `application/auth/refreshAuthIdentity` owns the round trip.
   */
  applyAuthMe: (result: AuthMeEnvelope) => void;
  clearUser: () => void;
  setAuthStatus: (status: AuthStatus) => void;
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
  userId: undefined,
  userOrgKind: undefined,
  memberships: [],
  pendingInvites: [],
  domainJoinableOrgs: [],
  myJoinRequests: [],
  autoJoinedOrg: null,
  authStatus: initialAuthStatus,
  approvalStatus: undefined,
  testAccountLevel: 0,
  selectedAgent: loadFromStorage(STORAGE_KEYS.SELECTED_AGENT) || 'planner',
  selectedJobType: (loadFromStorage(STORAGE_KEYS.SELECTED_JOB_TYPE) as SelectedJobType) || 'plan',

  // ==================
  // Actions
  // ==================
  setSelectedAgent: (agent) => {
    set({ selectedAgent: agent });
    saveToStorage(STORAGE_KEYS.SELECTED_AGENT, agent);
  },

  applyJobIdentity: ({ jobType, agent, jobId }) => {
    const resolvedAgent = agent ?? resolveAgentForJobType(jobType);
    set({
      selectedJobType: jobType,
      selectedAgent: resolvedAgent,
      ...(jobId ? { currentJobId: jobId } : {}),
    });
    saveToStorage(STORAGE_KEYS.SELECTED_JOB_TYPE, jobType);
    saveToStorage(STORAGE_KEYS.SELECTED_AGENT, resolvedAgent);
    sseManager.updateJobParam(jobType);
  },

  setSelectedJobType: (jobType) => {
    const state = get();
    // SSOT: applyJobIdentity owns the (agent, jobType) pair + persistence +
    // updateJobParam. Picking a job type also coherently sets its agent
    // (e.g. selecting `plan` flips the agent to planner).
    state.applyJobIdentity({ jobType });

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
          // Non-task jobs (plan / visual) have no kanban board — the BE route
          // only serves design/code/learn, so fetching would 400. Their
          // progress surfaces via workflow SSE + chat, not a board.
          const [session, kanbanData, history] = await Promise.all([
            fetchFeatureSession(state.selectedProject!, state.selectedFeature!, jobType),
            isNonTaskJob(jobType)
              ? Promise.resolve(null)
              : fetchKanbanData(state.selectedProject!, state.selectedFeature!, jobType),
            // History is best-effort here (drives auto-select only) — its
            // failure must not fail the whole session/kanban load.
            fetchJobHistory(state.selectedProject!, state.selectedFeature!).catch(() => ({ jobs: [] })),
          ]);

          if (get().selectedJobType !== jobType) {
            console.log(`[Store] Discarding stale response for ${jobType} (current: ${get().selectedJobType})`);
            return;
          }

          set({ session: session || undefined });
          if (kanbanData) get().updateKanban(kanbanData);
          console.log(`[Store] ✅ Session + kanban loaded for ${jobType}`);

          // Auto-select the most-recent jobId when the jobType-scoped kanban
          // has no jobId but the history does. The history is now feature-wide,
          // so filter to THIS type — picking a job type must not auto-select a
          // different type's job (that would re-converge the identity back).
          //
          // `restoresLatestRunFromHistory` owns the which-types rule (plan /
          // visual would yank the view onto the latest historical run of a type
          // that shares the feature with a board). Also skipped while a job
          // start is in flight (a redirect that just enqueued a new job must
          // not be clobbered by a stale one).
          const hasBoardJobId = !!kanbanData?.jobId;
          const sameType = history.jobs.filter((j) => j.type === jobType);
          if (
            !hasBoardJobId && sameType.length > 0 &&
            restoresLatestRunFromHistory(jobType) && !get().jobStartPending
          ) {
            const latest = sameType[0];
            console.log(
              `[Store] ↩️ No current jobId for '${jobType}', auto-selecting latest: ${latest.jobId}`,
            );
            await get().selectJobId(latest.jobId, {
              live: latest.live,
              jobType,
              customJobRef: latest.customJobRef,
            });
          }
        } catch (error) {
          console.error('[Store] Failed to switch job type:', error);
          if (get().selectedJobType === jobType) {
            set({ session: undefined });
          }
        }
      })();
    }
  },

  applyAuthMe: (result) => {
    const { user } = result;
    const state = get() as any;
    // The store hydrates `userOrganization` from storage at creation, so this
    // covers an org switch (which reloads the page), a switch made in another
    // tab, and a re-login as a different account. Without it the previous
    // tenant's `selectedProject` survives the reload and the unified SSE opens
    // against a project that does not exist under the new workspace root — the
    // backend 404s and the client reconnect-loops forever on "connecting".
    const tenantChanged = isTenantChange(state.userOrganization, user.organization);

    if (tenantChanged) {
      // Side-effecting half FIRST, while `authStatus` is still 'verifying' so
      // `selectIsAuthBlocked` keeps `useProjectLifecycle` parked. This cannot
      // fold into the set() below — `applyIdentityTransition` runs its own
      // set() plus cross-slice calls.
      sseManager.disconnectAll();
      state.applyIdentityTransition?.({
        scope: 'project',
        prevProject: state.selectedProject,
        prevFeature: state.selectedFeature,
      });
      removeTenantScopedStorage();
    }

    // ONE set(): the scrub, the whole envelope and the 'verified' flip must be
    // atomic. Split in two, `useProjectLifecycle` (deps include both
    // `selectedProject` and `authStatus`) can observe "verified + stale
    // project" and fire exactly the `initializeSSE()` this is here to prevent —
    // and any reader can observe half an envelope.
    set({
      ...(tenantChanged ? tenantScrubPatch() : {}),
      userEmail: user.email,
      userOrganization: user.organization,
      userName: user.name,
      userPicture: user.picture,
      userId: user.userId,
      userOrgKind: user.orgKind,
      memberships: result.memberships,
      approvalStatus: user.approvalStatus,
      testAccountLevel: user.testAccountLevel ?? 0,
      pendingInvites: result.pendingInvites,
      domainJoinableOrgs: result.domainJoinableOrgs,
      myJoinRequests: result.myJoinRequests,
      autoJoinedOrg: result.autoJoinedOrg,
      authStatus: 'verified',
    } as any);
    saveToStorage(STORAGE_KEYS.USER_EMAIL, user.email);
    saveToStorage(STORAGE_KEYS.USER_ORGANIZATION, user.organization);
    // `userName` / `userPicture` / `userId` / `userOrgKind` / `memberships` are
    // derived from the JWT and replayed on every `/auth/me`, so we intentionally
    // skip localStorage persistence.
  },

  setAuthStatus: (status) => set({ authStatus: status }),

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
      userId: undefined,
      userOrgKind: undefined,
      memberships: [],
      pendingInvites: [],
      domainJoinableOrgs: [],
      myJoinRequests: [],
      autoJoinedOrg: null,
      approvalStatus: undefined,
      testAccountLevel: 0,
      authStatus: 'expired',
    });
    removeFromStorage(STORAGE_KEYS.USER_EMAIL);
    removeFromStorage(STORAGE_KEYS.USER_ORGANIZATION);

    const state = get() as any;
    if (typeof state.reset === 'function') {
      state.reset();
    }
    // Shared with `applyAuthMe`'s tenant-change branch so the two teardowns cannot
    // drift — see `./auth/tenantScrub`.
    set({ ...tenantScrubPatch() } as any);
    removeTenantScopedStorage();
  },
  };
};

