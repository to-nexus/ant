import { StateCreator } from 'zustand';
import type { DeployStatus, DeployLogEntry, CustomDomainWithDns } from '@/infrastructure/http/api';
import type { CustomDomainStatusEventData } from '@ant/shared';
import { selectIsAuthBlocked } from '../selectors/auth';

export interface PerFeatureDeployState {
  status: DeployStatus | undefined;
  logs: DeployLogEntry[];
  isLoading: boolean;
  /**
   * Time-based window during which stale "still building/running" SSE events
   * are ignored while a stop is in flight (mirrors preview's `stopGuardUntil`).
   * 0 means disarmed.
   */
  stopGuardUntil: number;
}

// Single owner of the "terminal deploy phase ⇒ not loading" rule (deploy
// parity of preview's `isTerminalPhase`). A settled deploy never leaves the
// button stuck behind a spinner, regardless of which fetch path wrote the
// status (SSE handler, initial/visibility/reconnect fetch, loading-timeout).
export const isTerminalDeployPhase = (
  phase?: DeployStatus['phase'],
): boolean =>
  phase === 'running' ||
  phase === 'error' ||
  phase === 'stopped' ||
  phase === 'hibernated' ||
  phase === 'unavailable';

export interface DeploySliceState {
  /** Map keyed by `${projectId}:${featureName}` — isolates state per feature. */
  deployByFeature: Record<string, PerFeatureDeployState>;
  /** Custom domains per feature key. `undefined` = not yet fetched. */
  customDomainsByFeature: Record<string, CustomDomainWithDns[]>;
  /** Whether custom-domain infra is enabled, per feature key (from status fetch). */
  customDomainEnabledByFeature: Record<string, boolean>;
}

export interface DeployActions {
  setDeployStatus: (key: string, status: DeployStatus | undefined) => void;
  appendDeployLog: (key: string, log: DeployLogEntry) => void;
  /** Bulk-set logs (used to hydrate from the sessionStorage cache on mount). */
  setDeployLogs: (key: string, logs: DeployLogEntry[]) => void;
  clearDeployLogs: (key: string) => void;
  setDeployLoading: (key: string, loading: boolean) => void;
  setDeployStopGuard: (key: string, until: number) => void;
  removeDeployEntry: (key: string) => void;
  refreshDeployStatus: (projectId: string, featureName: string) => Promise<void>;
  // Custom domains
  setCustomDomains: (key: string, domains: CustomDomainWithDns[], enabled: boolean) => void;
  applyCustomDomainEvent: (key: string, evt: CustomDomainStatusEventData) => void;
  refreshCustomDomains: (projectId: string, featureName: string) => Promise<void>;
}

export type DeploySlice = DeploySliceState & DeployActions;

/**
 * Build the canonical per-feature key. Returns null when either input is
 * missing — callers must skip state reads/writes in that case.
 */
export function makeFeatureKey(
  projectId: string | undefined,
  featureName: string | undefined,
): string | null {
  if (!projectId || !featureName) return null;
  return `${projectId}:${featureName}`;
}

const emptyEntry = (): PerFeatureDeployState => ({
  status: undefined,
  logs: [],
  isLoading: false,
  stopGuardUntil: 0,
});

// Stable reference for "no logs" — selectors must return the SAME array
// instance on repeated calls, otherwise Zustand treats every unrelated
// store update as a log change and re-renders subscribers needlessly.
const EMPTY_LOGS: DeployLogEntry[] = Object.freeze([]) as unknown as DeployLogEntry[];

export function selectDeployStatus(
  s: { deployByFeature: Record<string, PerFeatureDeployState> },
  key: string | null,
): DeployStatus | undefined {
  if (!key) return undefined;
  return s.deployByFeature[key]?.status;
}

export function selectDeployLogs(
  s: { deployByFeature: Record<string, PerFeatureDeployState> },
  key: string | null,
): DeployLogEntry[] {
  if (!key) return EMPTY_LOGS;
  return s.deployByFeature[key]?.logs ?? EMPTY_LOGS;
}

export function selectIsDeployLoading(
  s: { deployByFeature: Record<string, PerFeatureDeployState> },
  key: string | null,
): boolean {
  if (!key) return false;
  const entry = s.deployByFeature[key];
  if (!entry) return false;
  // Invariant: a terminal phase ⇒ not loading. Forces the button back to a
  // clickable state on success/failure/stop even if the explicit
  // `setDeployLoading(false)` was missed (e.g. a status written by the
  // initial/visibility/reconnect fetch path, which doesn't clear the flag).
  if (isTerminalDeployPhase(entry.status?.phase)) return false;
  return entry.isLoading ?? false;
}

export function selectDeployStopGuardUntil(
  s: { deployByFeature: Record<string, PerFeatureDeployState> },
  key: string | null,
): number {
  if (!key) return 0;
  return s.deployByFeature[key]?.stopGuardUntil ?? 0;
}

const EMPTY_DOMAINS: CustomDomainWithDns[] = Object.freeze([]) as unknown as CustomDomainWithDns[];

export function selectCustomDomains(
  s: { customDomainsByFeature: Record<string, CustomDomainWithDns[]> },
  key: string | null,
): CustomDomainWithDns[] {
  if (!key) return EMPTY_DOMAINS;
  return s.customDomainsByFeature[key] ?? EMPTY_DOMAINS;
}

export function selectCustomDomainEnabled(
  s: { customDomainEnabledByFeature: Record<string, boolean> },
  key: string | null,
): boolean {
  if (!key) return false;
  return s.customDomainEnabledByFeature[key] ?? false;
}

export const createDeploySlice: StateCreator<any, [], [], DeploySlice> = (set, get) => ({
  deployByFeature: {},
  customDomainsByFeature: {},
  customDomainEnabledByFeature: {},

  setDeployStatus: (key, status) => {
    set((state: any) => ({
      deployByFeature: {
        ...state.deployByFeature,
        [key]: {
          ...(state.deployByFeature[key] ?? emptyEntry()),
          status,
        },
      },
    }));
  },

  appendDeployLog: (key, log) => {
    set((state: any) => {
      const cur = state.deployByFeature[key] ?? emptyEntry();
      return {
        deployByFeature: {
          ...state.deployByFeature,
          [key]: { ...cur, logs: [...cur.logs, log].slice(-200) },
        },
      };
    });
  },

  setDeployLogs: (key, logs) => {
    set((state: any) => ({
      deployByFeature: {
        ...state.deployByFeature,
        [key]: { ...(state.deployByFeature[key] ?? emptyEntry()), logs: logs.slice(-200) },
      },
    }));
  },

  clearDeployLogs: (key) => {
    set((state: any) => ({
      deployByFeature: {
        ...state.deployByFeature,
        [key]: { ...(state.deployByFeature[key] ?? emptyEntry()), logs: [] },
      },
    }));
  },

  setDeployLoading: (key, loading) => {
    set((state: any) => ({
      deployByFeature: {
        ...state.deployByFeature,
        [key]: { ...(state.deployByFeature[key] ?? emptyEntry()), isLoading: loading },
      },
    }));
  },

  setDeployStopGuard: (key, until) => {
    set((state: any) => ({
      deployByFeature: {
        ...state.deployByFeature,
        [key]: { ...(state.deployByFeature[key] ?? emptyEntry()), stopGuardUntil: until },
      },
    }));
  },

  removeDeployEntry: (key) => {
    set((state: any) => {
      if (!state.deployByFeature[key]) return state;
      const next = { ...state.deployByFeature };
      delete next[key];
      return { deployByFeature: next };
    });
  },

  refreshDeployStatus: async (projectId, featureName) => {
    const key = makeFeatureKey(projectId, featureName);
    if (!key) return;
    const state = get();
    if (selectIsAuthBlocked(state as any)) {
      get().setDeployStatus(key, undefined);
      return;
    }

    try {
      const { getDeployStatus } = await import('@/infrastructure/http/api');
      const status = await getDeployStatus(projectId, featureName);
      get().setDeployStatus(key, status);
    } catch (error) {
      console.error('Failed to refresh deploy status:', error);
      get().setDeployStatus(key, undefined);
    }
  },

  setCustomDomains: (key, domains, enabled) => {
    set((state: any) => ({
      customDomainsByFeature: { ...state.customDomainsByFeature, [key]: domains },
      customDomainEnabledByFeature: { ...state.customDomainEnabledByFeature, [key]: enabled },
    }));
  },

  applyCustomDomainEvent: (key, evt) => {
    set((state: any) => {
      const cur: CustomDomainWithDns[] = state.customDomainsByFeature[key] ?? [];
      // 'removed' is signalled by status='error' + error='removed' from the service.
      if (evt.status === 'error' && evt.error === 'removed') {
        return {
          customDomainsByFeature: {
            ...state.customDomainsByFeature,
            [key]: cur.filter((d) => d.hostname !== evt.hostname),
          },
        };
      }
      const next = cur.map((d) =>
        d.hostname === evt.hostname
          ? { ...d, status: evt.status, certStatus: evt.certStatus ?? d.certStatus, error: evt.error }
          : d,
      );
      // Unknown hostname (e.g. registered on another tab) → trigger a refresh via
      // absence; leave list unchanged here (the manager hook re-fetches on open).
      return { customDomainsByFeature: { ...state.customDomainsByFeature, [key]: next } };
    });
  },

  refreshCustomDomains: async (projectId, featureName) => {
    const key = makeFeatureKey(projectId, featureName);
    if (!key) return;
    if (selectIsAuthBlocked(get() as any)) return;
    try {
      const { listCustomDomains } = await import('@/infrastructure/http/api');
      const res = await listCustomDomains(projectId, featureName);
      get().setCustomDomains(key, res.domains ?? [], !!res.enabled);
    } catch (error) {
      console.error('Failed to refresh custom domains:', error);
    }
  },
});
