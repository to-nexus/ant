import { StateCreator } from 'zustand';
import type { PreviewStatus, LogEntry } from '@/infrastructure/http/api';
import { makeFeatureKey } from './deploySlice';
import { selectIsAuthBlocked } from '../selectors/auth';

export interface PerFeaturePreviewState {
  status: PreviewStatus | undefined;
  isLoading: boolean;
  stopGuardUntil: number;
}

export interface PreviewSliceState {
  /** Map keyed by `${projectId}:${featureName}` — isolates state per feature. */
  previewByFeature: Record<string, PerFeaturePreviewState>;
}

export interface PreviewActions {
  setPreviewStatus: (key: string, status: PreviewStatus | undefined) => void;
  mergePreviewStatus: (key: string, patch: Partial<PreviewStatus>) => void;
  appendPreviewLog: (key: string, log: LogEntry) => void;
  clearPreviewLogs: (key: string) => void;
  setPreviewLoading: (key: string, loading: boolean) => void;
  setPreviewStopGuard: (key: string, until: number) => void;
  removePreviewEntry: (key: string) => void;
  refreshPreviewStatus: (projectId: string, feature: string) => Promise<void>;
}

export type PreviewSlice = PreviewSliceState & PreviewActions;

const emptyEntry = (): PerFeaturePreviewState => ({
  status: undefined,
  isLoading: false,
  stopGuardUntil: 0,
});

// Cap per-feature log buffer to prevent unbounded memory growth during long
// install/starting runs. Matches deploySlice.ts philosophy (200 there — logs
// here can be more verbose so 500 is a safer ceiling).
const MAX_LOGS = 500;

// Read path is intentionally narrow: `selectPreviewVM(state, key)` is the
// ONLY supported way for components to read preview state. Helper
// selectors (`selectPreviewStatus`, `selectPreviewLogs`, …) were removed
// to prevent parallel read paths from drifting — a new reader that
// bypasses the VM would lose the `phase==='running' ⇒ isLoading=false`
// invariant that fixes the stuck-spinner bug.

export { makeFeatureKey };

export const createPreviewSlice: StateCreator<any, [], [], PreviewSlice> = (set, get) => ({
  previewByFeature: {},

  setPreviewStatus: (key, status) => {
    set((state: any) => ({
      previewByFeature: {
        ...state.previewByFeature,
        [key]: {
          ...(state.previewByFeature[key] ?? emptyEntry()),
          status,
        },
      },
    }));
  },

  mergePreviewStatus: (key, patch) => {
    set((state: any) => {
      const cur = state.previewByFeature[key] ?? emptyEntry();
      const prevStatus = cur.status;
      // Preserve accumulated logs when the patch doesn't carry new ones —
      // HTTP GET /status never returns `logs`, so a naïve merge would wipe
      // them. `appendPreviewLog` handles the log-append path on its own.
      const nextLogs = patch.logs ?? prevStatus?.logs ?? [];
      const nextStatus: PreviewStatus = {
        ...(prevStatus ?? { running: false }),
        ...patch,
        logs: nextLogs,
      };
      return {
        previewByFeature: {
          ...state.previewByFeature,
          [key]: { ...cur, status: nextStatus },
        },
      };
    });
  },

  appendPreviewLog: (key, log) => {
    set((state: any) => {
      const cur = state.previewByFeature[key] ?? emptyEntry();
      const prevStatus = cur.status ?? { running: false };
      const nextLogs = [...(prevStatus.logs ?? []), log].slice(-MAX_LOGS);
      return {
        previewByFeature: {
          ...state.previewByFeature,
          [key]: {
            ...cur,
            status: { ...prevStatus, logs: nextLogs },
          },
        },
      };
    });
  },

  clearPreviewLogs: (key) => {
    set((state: any) => {
      const cur = state.previewByFeature[key] ?? emptyEntry();
      if (!cur.status) return state;
      return {
        previewByFeature: {
          ...state.previewByFeature,
          [key]: { ...cur, status: { ...cur.status, logs: [] } },
        },
      };
    });
  },

  setPreviewLoading: (key, loading) => {
    set((state: any) => ({
      previewByFeature: {
        ...state.previewByFeature,
        [key]: { ...(state.previewByFeature[key] ?? emptyEntry()), isLoading: loading },
      },
    }));
  },

  setPreviewStopGuard: (key, until) => {
    set((state: any) => ({
      previewByFeature: {
        ...state.previewByFeature,
        [key]: { ...(state.previewByFeature[key] ?? emptyEntry()), stopGuardUntil: until },
      },
    }));
  },

  removePreviewEntry: (key) => {
    set((state: any) => {
      if (!state.previewByFeature[key]) return state;
      const next = { ...state.previewByFeature };
      delete next[key];
      return { previewByFeature: next };
    });
  },

  refreshPreviewStatus: async (projectId, feature) => {
    const key = makeFeatureKey(projectId, feature);
    if (!key) return;
    const state = get();
    if (selectIsAuthBlocked(state as any)) {
      get().setPreviewStatus(key, undefined);
      return;
    }
    try {
      const { getPreviewStatus } = await import('@/infrastructure/http/api');
      const status = await getPreviewStatus(projectId, feature);
      // GET /status never returns `logs` — merge to preserve accumulated SSE logs.
      get().mergePreviewStatus(key, status as Partial<PreviewStatus>);
    } catch (error) {
      console.error('Failed to refresh preview status:', error);
    }
  },
});
