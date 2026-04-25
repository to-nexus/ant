import { StateCreator } from 'zustand';
import type { FeatureBreadcrumbLine } from '@ant/shared';
import {
  getFeatureBreadcrumbs,
  resetFeatureContext as resetFeatureContextApi,
} from '@/infrastructure/http/api/featureLog';

/**
 * FeatureLog slice — feature.jsonl breadcrumbs (session-redesign §2.4).
 *
 * Backed by the read-only HTTP endpoint:
 *   GET /api/projects/:id/features/:feature/breadcrumbs
 *
 * Refresh paths:
 *   1. Feature switch → `useFeatureLogSync` triggers `loadFeatureBreadcrumbs`.
 *   2. Job completion → `chatSseHandler` re-issues `loadFeatureBreadcrumbs`
 *      when a `job_status=completed|failed` SSE event arrives for the
 *      current feature.
 *   3. Hard Reset → `resetFeatureContext` wipes the cache and re-fetches.
 *
 * Note: chat.jsonl / user-turn-meta are recorded on disk (BE SSOT) but are
 * no longer mirrored into this slice — the Activity tab that consumed them
 * was retired in favor of the legacy Chat tab (which is fed by its own SSE
 * pipeline). The BE endpoints remain in place for ChatService server-side
 * rehydration and for potential future reintroduction.
 */

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface FeatureLogState {
  breadcrumbs: FeatureBreadcrumbLine[];
  breadcrumbsStatus: LoadStatus;
  breadcrumbsError?: string;
  /**
   * Feature-scoped cache key so stale responses from a previous feature
   * cannot overwrite the current feature's data.
   */
  breadcrumbsKey?: string;
}

export interface FeatureLogActions {
  loadFeatureBreadcrumbs: (projectId: string, featureName: string) => Promise<void>;
  /**
   * Reserved hook for a future SSE push path (§2.4 live breadcrumb).
   * Currently unused — breadcrumbs are refreshed via `loadFeatureBreadcrumbs`
   * on job completion. Kept as a stub so the eventual SSE handler has a
   * named entry point instead of growing ad-hoc mutation logic.
   */
  appendFeatureBreadcrumb: (line: FeatureBreadcrumbLine) => void;
  clearFeatureLog: () => void;
  /**
   * Hard Reset the feature context (§17 hard_reset).
   *
   * Calls the backend reset endpoint, clears the in-memory state, and
   * triggers an immediate refetch so the UI reflects the post-reset (empty)
   * state without needing a navigation round trip.
   */
  resetFeatureContext: (projectId: string, featureName: string, reason?: string) => Promise<void>;
}

export type FeatureLogSlice = FeatureLogState & FeatureLogActions;

function makeKey(projectId: string, featureName: string): string {
  return `${projectId}:::${featureName}`;
}

export const createFeatureLogSlice: StateCreator<any, [], [], FeatureLogSlice> = (set, get) => ({
  breadcrumbs: [],
  breadcrumbsStatus: 'idle',
  breadcrumbsError: undefined,
  breadcrumbsKey: undefined,

  loadFeatureBreadcrumbs: async (projectId, featureName) => {
    const key = makeKey(projectId, featureName);
    const isNewFeature = get().breadcrumbsKey !== key;
    set({
      breadcrumbsStatus: 'loading',
      breadcrumbsError: undefined,
      breadcrumbsKey: key,
      ...(isNewFeature ? { breadcrumbs: [] } : {}),
    });
    try {
      const breadcrumbs = await getFeatureBreadcrumbs(projectId, featureName);
      if (get().breadcrumbsKey !== key) return;
      set({ breadcrumbs, breadcrumbsStatus: 'loaded' });
    } catch (err) {
      if (get().breadcrumbsKey !== key) return;
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[FeatureLog] breadcrumbs load failed:', message);
      set({ breadcrumbsStatus: 'error', breadcrumbsError: message });
    }
  },

  appendFeatureBreadcrumb: (line) => {
    set((state: any) => ({ breadcrumbs: [...state.breadcrumbs, line] }));
  },

  clearFeatureLog: () => {
    set({
      breadcrumbs: [],
      breadcrumbsStatus: 'idle',
      breadcrumbsError: undefined,
      breadcrumbsKey: undefined,
    });
  },

  resetFeatureContext: async (projectId, featureName, reason) => {
    await resetFeatureContextApi(projectId, featureName, reason);
    // Eagerly wipe both SSOT caches the Chat / Timeline tabs read from:
    //   - `chatEvents` / `streamingBuffers` (chat slice, SSE-populated) →
    //     cleared locally so the Chat tab does not flash stale messages
    //     between the HTTP response and the `events_cleared` SSE
    //     broadcast that the backend fires as part of the shared §16.2
    //     Clear·Reset pipeline. Clearing here is idempotent — the SSE
    //     handler will also clear it if this runs first.
    //   - feature-log breadcrumbs (this slice) → cleared + cache key
    //     dropped so the subsequent re-fetch is treated as a fresh feature
    //     switch.
    get().clearChatEvents?.('full');
    set({
      breadcrumbs: [],
      breadcrumbsStatus: 'idle',
      breadcrumbsError: undefined,
      breadcrumbsKey: undefined,
    });
    // Re-fetch; errors surface via the loader's own error state so the UI
    // can show them in the Timeline tab.
    await get().loadFeatureBreadcrumbs(projectId, featureName);
  },
});
