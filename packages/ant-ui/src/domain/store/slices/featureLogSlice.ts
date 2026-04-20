import { StateCreator } from 'zustand';
import type { TraceLine, FeatureBreadcrumbLine } from '@ant/shared';
import { getFeatureTrace, getFeatureBreadcrumbs } from '@/infrastructure/http/api/featureLog';

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
  traceStatus: LoadStatus;
  breadcrumbsStatus: LoadStatus;
  traceError?: string;
  breadcrumbsError?: string;
  /** Feature-scoped cache key so we can safely discard stale data when switching features. */
  featureLogKey?: string;
}

export interface FeatureLogActions {
  loadFeatureTrace: (projectId: string, featureName: string) => Promise<void>;
  loadFeatureBreadcrumbs: (projectId: string, featureName: string) => Promise<void>;
  appendFeatureTraceLine: (line: TraceLine) => void;
  appendFeatureBreadcrumb: (line: FeatureBreadcrumbLine) => void;
  clearFeatureLog: () => void;
}

export type FeatureLogSlice = FeatureLogState & FeatureLogActions;

function makeKey(projectId: string, featureName: string): string {
  return `${projectId}:::${featureName}`;
}

export const createFeatureLogSlice: StateCreator<any, [], [], FeatureLogSlice> = (set, get) => ({
  traceLines: [],
  breadcrumbs: [],
  traceStatus: 'idle',
  breadcrumbsStatus: 'idle',
  traceError: undefined,
  breadcrumbsError: undefined,
  featureLogKey: undefined,

  loadFeatureTrace: async (projectId, featureName) => {
    const key = makeKey(projectId, featureName);
    set({ traceStatus: 'loading', traceError: undefined, featureLogKey: key });
    try {
      const lines = await getFeatureTrace(projectId, featureName);
      const current = get();
      if (current.featureLogKey !== key) return;
      set({ traceLines: lines, traceStatus: 'loaded' });
    } catch (err) {
      const current = get();
      if (current.featureLogKey !== key) return;
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[FeatureLog] trace load failed:', message);
      set({ traceStatus: 'error', traceError: message });
    }
  },

  loadFeatureBreadcrumbs: async (projectId, featureName) => {
    const key = makeKey(projectId, featureName);
    set({ breadcrumbsStatus: 'loading', breadcrumbsError: undefined, featureLogKey: key });
    try {
      const breadcrumbs = await getFeatureBreadcrumbs(projectId, featureName);
      const current = get();
      if (current.featureLogKey !== key) return;
      set({ breadcrumbs, breadcrumbsStatus: 'loaded' });
    } catch (err) {
      const current = get();
      if (current.featureLogKey !== key) return;
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[FeatureLog] breadcrumbs load failed:', message);
      set({ breadcrumbsStatus: 'error', breadcrumbsError: message });
    }
  },

  appendFeatureTraceLine: (line) => {
    set((state: any) => ({ traceLines: [...state.traceLines, line] }));
  },

  appendFeatureBreadcrumb: (line) => {
    set((state: any) => ({ breadcrumbs: [...state.breadcrumbs, line] }));
  },

  clearFeatureLog: () => {
    set({
      traceLines: [],
      breadcrumbs: [],
      traceStatus: 'idle',
      breadcrumbsStatus: 'idle',
      traceError: undefined,
      breadcrumbsError: undefined,
      featureLogKey: undefined,
    });
  },
});
