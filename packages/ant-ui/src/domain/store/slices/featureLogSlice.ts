import { StateCreator } from 'zustand';
import type {
  TraceLine,
  FeatureBreadcrumbLine,
  FeatureUserTurnLine,
  FeatureUserTurnMetaLine,
} from '@ant/shared';
import {
  getFeatureTrace,
  getFeatureBreadcrumbs,
  getFeatureTurnMeta,
  resetFeatureContext as resetFeatureContextApi,
} from '@/infrastructure/http/api/featureLog';

/**
 * FeatureLog slice — trace.jsonl + feature.jsonl breadcrumbs (session-redesign SSOT).
 *
 * Backed by the read-only HTTP endpoints:
 *   GET /api/projects/:id/features/:feature/trace
 *   GET /api/projects/:id/features/:feature/breadcrumbs
 *
 * Live updates continue to arrive via the existing SSE workflow / chat
 * streams; this slice is primarily used for initial load, for the breadcrumb
 * timeline view, and as the fallback SSOT for chat rendering when the
 * legacy in-memory chat stream is empty.
 */

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface FeatureLogState {
  traceLines: TraceLine[];
  breadcrumbs: FeatureBreadcrumbLine[];
  /** user_turn lines from feature.jsonl (tier badge — §18). */
  userTurns: FeatureUserTurnLine[];
  /** user_turn_meta patch lines (complexity/decidedBy/reason) — §18. */
  userTurnMetas: FeatureUserTurnMetaLine[];
  traceStatus: LoadStatus;
  breadcrumbsStatus: LoadStatus;
  turnMetaStatus: LoadStatus;
  traceError?: string;
  breadcrumbsError?: string;
  turnMetaError?: string;
  /**
   * Per-loader feature-scoped cache keys so we can safely discard stale data
   * when switching features. Kept separate for trace vs breadcrumbs because
   * the two loaders race freely and may interleave.
   */
  traceKey?: string;
  breadcrumbsKey?: string;
  turnMetaKey?: string;
}

export interface FeatureLogActions {
  loadFeatureTrace: (projectId: string, featureName: string) => Promise<void>;
  loadFeatureBreadcrumbs: (projectId: string, featureName: string) => Promise<void>;
  loadFeatureTurnMeta: (projectId: string, featureName: string) => Promise<void>;
  appendFeatureTraceLine: (line: TraceLine) => void;
  appendFeatureBreadcrumb: (line: FeatureBreadcrumbLine) => void;
  appendFeatureUserTurn: (line: FeatureUserTurnLine) => void;
  appendFeatureUserTurnMeta: (line: FeatureUserTurnMetaLine) => void;
  clearFeatureLog: () => void;
  /**
   * Hard Reset the feature context (§17 hard_reset).
   *
   * Calls the backend reset endpoint, clears the in-memory trace /
   * breadcrumb state, and triggers an immediate refetch so the UI reflects
   * the post-reset (empty) state without needing a navigation round trip.
   */
  resetFeatureContext: (projectId: string, featureName: string, reason?: string) => Promise<void>;
}

export type FeatureLogSlice = FeatureLogState & FeatureLogActions;

function makeKey(projectId: string, featureName: string): string {
  return `${projectId}:::${featureName}`;
}

export const createFeatureLogSlice: StateCreator<any, [], [], FeatureLogSlice> = (set, get) => ({
  traceLines: [],
  breadcrumbs: [],
  userTurns: [],
  userTurnMetas: [],
  traceStatus: 'idle',
  breadcrumbsStatus: 'idle',
  turnMetaStatus: 'idle',
  traceError: undefined,
  breadcrumbsError: undefined,
  turnMetaError: undefined,
  traceKey: undefined,
  breadcrumbsKey: undefined,
  turnMetaKey: undefined,

  loadFeatureTrace: async (projectId, featureName) => {
    const key = makeKey(projectId, featureName);
    const isNewFeature = get().traceKey !== key;
    // When the target feature changes, discard the previous feature's data
    // immediately so the UI does not briefly flash stale content while the
    // new fetch is in flight.
    set({
      traceStatus: 'loading',
      traceError: undefined,
      traceKey: key,
      ...(isNewFeature ? { traceLines: [] } : {}),
    });
    try {
      const lines = await getFeatureTrace(projectId, featureName);
      if (get().traceKey !== key) return;
      set({ traceLines: lines, traceStatus: 'loaded' });
    } catch (err) {
      if (get().traceKey !== key) return;
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[FeatureLog] trace load failed:', message);
      set({ traceStatus: 'error', traceError: message });
    }
  },

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

  loadFeatureTurnMeta: async (projectId, featureName) => {
    const key = makeKey(projectId, featureName);
    const isNewFeature = get().turnMetaKey !== key;
    set({
      turnMetaStatus: 'loading',
      turnMetaError: undefined,
      turnMetaKey: key,
      ...(isNewFeature ? { userTurns: [], userTurnMetas: [] } : {}),
    });
    try {
      const { userTurns, userTurnMetas } = await getFeatureTurnMeta(projectId, featureName);
      if (get().turnMetaKey !== key) return;
      set({ userTurns, userTurnMetas, turnMetaStatus: 'loaded' });
    } catch (err) {
      if (get().turnMetaKey !== key) return;
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[FeatureLog] user-turn-meta load failed:', message);
      set({ turnMetaStatus: 'error', turnMetaError: message });
    }
  },

  appendFeatureTraceLine: (line) => {
    set((state: any) => ({ traceLines: [...state.traceLines, line] }));
  },

  appendFeatureBreadcrumb: (line) => {
    set((state: any) => ({ breadcrumbs: [...state.breadcrumbs, line] }));
  },

  appendFeatureUserTurn: (line) => {
    set((state: any) => ({ userTurns: [...state.userTurns, line] }));
  },

  appendFeatureUserTurnMeta: (line) => {
    set((state: any) => ({ userTurnMetas: [...state.userTurnMetas, line] }));
  },

  clearFeatureLog: () => {
    set({
      traceLines: [],
      breadcrumbs: [],
      userTurns: [],
      userTurnMetas: [],
      traceStatus: 'idle',
      breadcrumbsStatus: 'idle',
      turnMetaStatus: 'idle',
      traceError: undefined,
      breadcrumbsError: undefined,
      turnMetaError: undefined,
      traceKey: undefined,
      breadcrumbsKey: undefined,
      turnMetaKey: undefined,
    });
  },

  resetFeatureContext: async (projectId, featureName, reason) => {
    await resetFeatureContextApi(projectId, featureName, reason);
    // Eagerly wipe both SSOT caches the Chat / Activity / Timeline tabs
    // read from:
    //   - `chatMessages` (chat slice, SSE-populated) → cleared locally
    //     so the Chat tab does not flash stale messages between the
    //     HTTP response and the `messages_cleared` SSE broadcast that
    //     the backend fires as part of the shared §16.2 Clear·Reset
    //     pipeline. Clearing here is idempotent — the SSE handler
    //     will also clear it if this runs first.
    //   - feature-log arrays (this slice) → cleared + cache keys
    //     dropped so each loader treats the subsequent re-fetch as a
    //     fresh feature switch.
    //
    // Why both-sides clear: the original §17 implementation assumed
    // the Chat tab was trace-derived and would auto-empty when
    // `traceLines` cleared. It isn't — ChatPanel still reads
    // `state.chatMessages`. Without this explicit clear, the Chat tab
    // stays frozen on the pre-reset transcript until the SSE event
    // lands (or until a feature switch).
    get().clearChatMessages?.();
    set({
      traceLines: [],
      breadcrumbs: [],
      userTurns: [],
      userTurnMetas: [],
      traceStatus: 'idle',
      breadcrumbsStatus: 'idle',
      turnMetaStatus: 'idle',
      traceError: undefined,
      breadcrumbsError: undefined,
      turnMetaError: undefined,
      traceKey: undefined,
      breadcrumbsKey: undefined,
      turnMetaKey: undefined,
    });
    // Re-fetch in parallel; errors are surfaced via each loader's own error
    // state so the UI can show them in the Activity / Timeline tabs.
    await Promise.all([
      get().loadFeatureTrace(projectId, featureName),
      get().loadFeatureBreadcrumbs(projectId, featureName),
      get().loadFeatureTurnMeta(projectId, featureName),
    ]);
  },
});
