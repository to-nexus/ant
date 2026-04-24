/**
 * git-world slice — single Zustand slice owning snapshot/operation/pat.
 *
 * Sole source of truth for Git UI state. Replaces the pre-greenfield
 * combination of `gitSlice.gitStatus` + `gitSlice.gitChanges` + phase
 * flag + scattered writers with a unified, shape-stable state.
 *
 * State invariants:
 * - `snapshot.data` is a frozen {@link GitSnapshot} (never mutated in place).
 * - `operation.status === 'running'` is exclusive: a second dispatch while
 *   running returns a rejection rather than queuing.
 * - `pat.data` mirrors `GitPatState`; `pat.refreshing` is a boolean, not a
 *   status enum, because PAT state has no per-op progress.
 */

import { StateCreator } from 'zustand';
import type {
  GitSnapshot,
  GitOperationState,
  GitPatState,
  GitUserOperation,
  GitOperationError as GitOperationErrorShape,
  GitStateEventData,
} from '@ant/shared';
import {
  fetchGitState,
  fetchPatState,
  dispatchGitOp,
  savePat as savePatApi,
  deletePat as deletePatApi,
} from './infrastructure/api';

// ── AsyncFields — unified {data, refreshing, error} envelope ─────────
export interface AsyncFields<T> {
  data: T | null;
  refreshing: boolean;
  error: string | null;
  lastFetchedAt: number | null;
}

const initialAsync = <T>(): AsyncFields<T> => ({
  data: null,
  refreshing: false,
  error: null,
  lastFetchedAt: null,
});

// ── Per-op default timeouts (ms) ─────────────────────────────────────
const OP_TIMEOUTS: Record<GitUserOperation['kind'], number> = {
  clone: 120_000,
  publish: 120_000,
  push: 60_000,
  pull: 60_000,
  sync: 90_000,
  fetch: 30_000,
  commit: 30_000,
  discard: 30_000,
};

function sleep(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(
      () =>
        reject({
          kind: 'network',
          message: `Operation timed out after ${Math.round(ms / 1000)}s`,
          retryable: true,
          suggestedAction: null,
        } satisfies GitOperationErrorShape),
      ms,
    );
  });
}

function toGitOperationError(value: unknown): GitOperationErrorShape {
  if (value && typeof value === 'object' && 'kind' in value && 'message' in value) {
    const v = value as Record<string, unknown>;
    return {
      kind: (v.kind as GitOperationErrorShape['kind']) ?? 'unknown',
      message: typeof v.message === 'string' ? v.message : String(v.message),
      retryable: Boolean(v.retryable),
      suggestedAction: (v.suggestedAction as GitOperationErrorShape['suggestedAction']) ?? null,
    };
  }
  const message = value instanceof Error ? value.message : String(value);
  return { kind: 'unknown', message, retryable: true, suggestedAction: null };
}

// ── Slice surface ─────────────────────────────────────────────────────
export interface GitWorldState {
  snapshot: AsyncFields<GitSnapshot>;
  operation: GitOperationState;
  pat: AsyncFields<GitPatState>;
}

export interface GitWorldActions {
  // Public writers — the only sanctioned mutation entry points.
  fetchGitWorldState: (
    projectId: string,
    opts?: { feature?: string; fresh?: boolean },
  ) => Promise<void>;
  runGitOperation: (
    projectId: string,
    op: GitUserOperation,
  ) => Promise<{ success: boolean; error?: GitOperationErrorShape }>;
  fetchGitPat: () => Promise<void>;
  /**
   * Save a GitHub PAT. On success the slice's `pat` field is refreshed and
   * the new state (including username) is included in the return value so
   * callers don't need to peek into the store.
   */
  savePat: (pat: string) => Promise<{ success: boolean; error?: string; pat?: GitPatState }>;
  /**
   * Delete the stored PAT. On success the slice's `pat` field is reset to
   * `{ configured: false }` and returned for convenience.
   */
  deletePat: () => Promise<{ success: boolean; error?: string; pat?: GitPatState }>;
  clearGitOperation: () => void;
  clearGitWorld: () => void;

  // Internal — only sse-handler.ts calls these. Kept on the public slice
  // so TypeScript can check them, but lint rules forbid external callers.
  _applyGitStateEvent: (payload: GitStateEventData) => void;
  _refreshWorkingTreeDebounced: (projectId: string, feature?: string) => void;
}

export type GitWorldSlice = GitWorldState & GitWorldActions;

// ── Debounce state for workingTreeChange → refetch ───────────────────
const workingTreeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
const WORKING_TREE_DEBOUNCE_MS = 300;

function keyOf(projectId: string, feature?: string): string {
  return `${projectId}:${feature ?? '_base'}`;
}

export const createGitWorldSlice: StateCreator<any, [], [], GitWorldSlice> = (set, get) => ({
  snapshot: initialAsync<GitSnapshot>(),
  operation: { status: 'idle' },
  pat: initialAsync<GitPatState>(),

  fetchGitWorldState: async (projectId, opts) => {
    if (!projectId) return;
    set((s: any) => ({ snapshot: { ...s.snapshot, refreshing: true, error: null } }));
    try {
      const { snapshot, pat } = await fetchGitState(projectId, opts);
      const self = get();
      const stillActive =
        self.selectedProject === projectId &&
        (self.selectedFeature ?? undefined) === (opts?.feature ?? undefined);
      if (!stillActive) return;
      set({
        snapshot: {
          data: snapshot,
          refreshing: false,
          error: null,
          lastFetchedAt: Date.now(),
        },
        pat: {
          data: pat,
          refreshing: false,
          error: null,
          lastFetchedAt: Date.now(),
        },
      });
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      set((s: any) => ({
        snapshot: { ...s.snapshot, refreshing: false, error: message },
      }));
      console.warn('[git-world] fetchGitWorldState failed:', message);
    }
  },

  runGitOperation: async (projectId, op) => {
    const state = get();
    if (state.operation.status === 'running') {
      const error: GitOperationErrorShape = {
        kind: 'unknown',
        message: 'Another Git operation is already running',
        retryable: false,
        suggestedAction: null,
      };
      return { success: false, error };
    }

    set({
      operation: { status: 'running', op, startedAt: Date.now() },
    });

    const timeoutMs = OP_TIMEOUTS[op.kind] ?? 30_000;

    try {
      const response = await Promise.race([dispatchGitOp(projectId, op), sleep(timeoutMs)]);
      if (response.success) {
        set({
          operation: { status: 'succeeded', op, completedAt: Date.now() },
        });
        // Snapshot refresh arrives via SSE gitState (cause='operationComplete').
        return { success: true };
      }
      set({
        operation: {
          status: 'failed',
          op,
          error: response.error,
          failedAt: Date.now(),
        },
      });
      return { success: false, error: response.error };
    } catch (err) {
      const gitError = toGitOperationError(err);
      set({
        operation: {
          status: 'failed',
          op,
          error: gitError,
          failedAt: Date.now(),
        },
      });
      return { success: false, error: gitError };
    }
  },

  fetchGitPat: async () => {
    set((s: any) => ({ pat: { ...s.pat, refreshing: true, error: null } }));
    try {
      const data = await fetchPatState();
      set({
        pat: {
          data,
          refreshing: false,
          error: null,
          lastFetchedAt: Date.now(),
        },
      });
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      set((s: any) => ({
        pat: { ...s.pat, refreshing: false, error: message },
      }));
    }
  },

  savePat: async (pat: string) => {
    const result = await savePatApi(pat);
    if (!result.success) return result;
    await get().fetchGitPat();
    return { ...result, pat: get().pat.data ?? undefined };
  },

  deletePat: async () => {
    const result = await deletePatApi();
    if (!result.success) return result;
    await get().fetchGitPat();
    return { ...result, pat: get().pat.data ?? undefined };
  },

  clearGitOperation: () => {
    set({ operation: { status: 'idle' } });
  },

  clearGitWorld: () => {
    set({
      snapshot: initialAsync<GitSnapshot>(),
      operation: { status: 'idle' },
      pat: initialAsync<GitPatState>(),
    });
  },

  _applyGitStateEvent: (payload) => {
    const self = get();
    if (self.selectedProject !== payload.project) return;
    if ((self.selectedFeature ?? undefined) !== (payload.feature ?? undefined)) return;

    if (payload.cause === 'operationComplete' || payload.cause === 'reconnectRefill') {
      set((s: any) => ({
        snapshot: {
          data: payload.snapshot,
          refreshing: false,
          error: null,
          lastFetchedAt: Date.now(),
        },
        pat: {
          ...s.pat,
          data: payload.pat,
          refreshing: false,
          lastFetchedAt: Date.now(),
        },
        ...(payload.cause === 'operationComplete'
          ? { operation: payload.operation }
          : {}),
      }));
    }
    // workingTreeChange carries no payload — delegated to debounced refetch.
  },

  _refreshWorkingTreeDebounced: (projectId, feature) => {
    const k = keyOf(projectId, feature);
    const existing = workingTreeTimers.get(k);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(() => {
      workingTreeTimers.delete(k);
      const self = get();
      const stillActive =
        self.selectedProject === projectId &&
        (self.selectedFeature ?? undefined) === (feature ?? undefined);
      if (!stillActive) return;
      self.fetchGitWorldState?.(projectId, { feature });
    }, WORKING_TREE_DEBOUNCE_MS);
    workingTreeTimers.set(k, handle);
  },
});
