import { StateCreator } from 'zustand';
import { isMoreAuthoritativeProfile } from '@ant/shared';
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
// bypasses the VM would lose the `terminal phase ⇒ isLoading=false`
// invariant that fixes the stuck-spinner bug.

export { makeFeatureKey };

// Single owner of the "terminal phase ⇒ not loading" rule. Imported by
// `selectPreviewVM` so the slice and the selector cannot drift. Transitional
// phases (installing / starting / stopping / undefined) keep `isLoading`
// governed by `setPreviewLoading` so the in-flight spinner still shows.
export const isTerminalPhase = (
  phase?: PreviewStatus['phase'],
): boolean => phase === 'running' || phase === 'error' || phase === 'stopped';

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
      // Logs are an SSE-accumulated, hydration-only field on status responses.
      // GET /status DOES return logs (last-50, owning pod only — empty array
      // on a non-owning cloud pod), so a status merge must NEVER let an
      // incoming logs array shrink or replace a buffer the live SSE stream has
      // already filled. Adopt `patch.logs` ONLY to seed an empty buffer (cold
      // hydration, e.g. right after a refresh); otherwise keep the live buffer.
      const hasLocalLogs = (prevStatus?.logs?.length ?? 0) > 0;
      const nextLogs = hasLocalLogs
        ? prevStatus!.logs!
        : (patch.logs ?? prevStatus?.logs ?? []);
      // The project profile is provenance-ranked, not last-write-wins: a
      // decompose `techtier-hint` arriving after a manifest-derived profile must
      // not demote it (that inversion produced a fullstack↔monorepo flip and
      // chimeric language/framework pairs). Only a STRICTLY less authoritative
      // patch is rejected — a same-provenance patch is a fresher observation and
      // must land. Atomic: never field-merged.
      const heldIsStronger = isMoreAuthoritativeProfile(
        prevStatus?.projectProfile,
        patch.projectProfile,
      );
      const nextProfile = heldIsStronger
        ? prevStatus?.projectProfile
        : (patch.projectProfile ?? prevStatus?.projectProfile);
      const nextStatus: PreviewStatus = {
        ...(prevStatus ?? { running: false }),
        ...patch,
        ...(nextProfile !== undefined ? { projectProfile: nextProfile } : {}),
        logs: nextLogs,
      };
      // Invariant: a terminal phase implies not-loading (mirrors
      // selectPreviewVM). Keeps the store truthful and stops the
      // loading-timeout safety net from lingering after a failure.
      const nextLoading = isTerminalPhase(nextStatus.phase) ? false : cur.isLoading;
      return {
        previewByFeature: {
          ...state.previewByFeature,
          [key]: { ...cur, status: nextStatus, isLoading: nextLoading },
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
      // mergePreviewStatus preserves the live buffer — a GET /status `logs`
      // array (last-50 / empty on a non-owning pod) only seeds an empty buffer.
      get().mergePreviewStatus(key, status as Partial<PreviewStatus>);
    } catch (error) {
      console.error('Failed to refresh preview status:', error);
    }
  },
});
