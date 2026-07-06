import { useEffect, useCallback } from 'react';
import { useStore } from '@/domain/store';
import {
  makeFeatureKey,
  selectDeployStatus,
  selectDeployLogs,
  selectIsDeployLoading,
} from '@/domain/store/slices/deploySlice';
import { selectHasActiveCodeJob } from '@/domain/store/slices/jobSlice';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import * as consoleLogCache from '@/infrastructure/persistence/consoleLogCache';
import {
  startDeploy,
  stopDeploy,
  getDeployStatus,
  resolveAppUrl,
} from '@/infrastructure/http/api';
import type { DeployStatus, DeployLogEntry, DeployVisibility } from '@/infrastructure/http/api';

/**
 * Reason the Deploy button must stay disabled, or undefined when deploy is
 * allowed. Kept as a discriminated string so callers can render the right
 * tooltip/toast without duplicating the business rules.
 */
export type DeployDisabledReason =
  | 'no-feature-selected'
  | 'code-job-active'
  | 'tier-not-allowed';

export interface UseDeployManagerResult {
  status: DeployStatus | undefined;
  logs: DeployLogEntry[];
  isLoading: boolean;
  canDeploy: boolean;
  disabledReason: DeployDisabledReason | undefined;
  /** Current deploy visibility (from status; defaults to `'public'`). */
  visibility: DeployVisibility;
  deploy: (visibility?: DeployVisibility) => Promise<void>;
  stop: () => Promise<void>;
  /**
   * Open a deployed package's URL in a new tab.
   *
   * Pass an explicit `url` (from `status.packages[i].url`) for multi-package
   * deploys. Calling without arguments uses the representative `status.url`
   * — only meaningful for single-package deploys; falls back to the first
   * package's URL if the top-level field is null but `packages` is set.
   */
  openDeployUrl: (url?: string) => void;
}

/**
 * useDeployManager
 *
 * Manages the deploy lifecycle (build → serve → SSE updates) with per-feature
 * state isolation. Guards against cross-feature log/status leakage by keying
 * all reads and writes on `${projectId}:${featureName}`.
 */
export function useDeployManager(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  options?: { primary?: boolean },
): UseDeployManagerResult {
  const isPrimary = options?.primary ?? false;
  const featureKey = makeFeatureKey(selectedProject, selectedFeature);

  const deployStatus = useStore((s: any) => selectDeployStatus(s, featureKey));
  const deployLogs = useStore((s: any) => selectDeployLogs(s, featureKey));
  const isDeployLoading = useStore((s: any) => selectIsDeployLoading(s, featureKey));

  // A deploy takes a snapshot of the codebase. If a `code` job is writing
  // files at that moment, the snapshot would be half-written → broken build
  // or broken deploy. `activeJobs` is scoped to the currently selected
  // feature by the SSE kanban handler, so this read is already feature-safe.
  // Other job types (design/plan/learn/ask/inline-ask) do not touch the
  // source tree and therefore do not invalidate a deploy.
  const hasActiveCodeJob = useStore(selectHasActiveCodeJob);

  // Deploy is a paid-plan feature: free tier can preview but not deploy. Only
  // gate when billing is on (local/OSS leaves deploy open). Tier comes from the
  // billing balance snapshot; undefined balance ⇒ treat as not-free (don't block
  // before the snapshot loads — the BE gate is the authority).
  const billingEnabled = useStore((s: any) => s.billingEnabled);
  const userTier = useStore((s: any) => s.billingBalance?.data?.tier);

  const disabledReason: DeployDisabledReason | undefined = (() => {
    if (!selectedFeature) return 'no-feature-selected';
    if (hasActiveCodeJob) return 'code-job-active';
    if (billingEnabled && userTier === 'free') return 'tier-not-allowed';
    return undefined;
  })();
  const canDeploy = disabledReason === undefined;

  const setDeployStatus = useStore((s: any) => s.setDeployStatus);
  const setDeployLoading = useStore((s: any) => s.setDeployLoading);
  const appendDeployLog = useStore((s: any) => s.appendDeployLog);
  const clearDeployLogs = useStore((s: any) => s.clearDeployLogs);
  const setDeployLogs = useStore((s: any) => s.setDeployLogs);
  const setDeployStopGuard = useStore((s: any) => s.setDeployStopGuard);

  // Initial status fetch + re-fetch on feature switch (corrects stale 'running')
  useEffect(() => {
    if (!isPrimary || !featureKey || !selectedProject || !selectedFeature) return;
    // Hydrate logs from the sessionStorage cache so a refresh restores the
    // prior run's output. Only seed when the store buffer is empty (cold
    // start) — never overwrite live SSE logs.
    const cached = consoleLogCache.readLogs<DeployLogEntry>('deploy', featureKey);
    const curLogs = useStore.getState().deployByFeature[featureKey]?.logs ?? [];
    if (cached && cached.length > 0 && curLogs.length === 0) {
      setDeployLogs(featureKey, cached);
    }
    getDeployStatus(selectedProject, selectedFeature)
      .then((status) => setDeployStatus(featureKey, status))
      .catch(() => setDeployStatus(featureKey, undefined));
  }, [isPrimary, featureKey, selectedProject, selectedFeature, setDeployStatus, setDeployLogs]);

  // Re-validate on tab focus — catches pod restarts / idle evictions that
  // happened while the tab was backgrounded.
  useEffect(() => {
    if (!isPrimary || !featureKey || !selectedProject || !selectedFeature) return;
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        getDeployStatus(selectedProject, selectedFeature)
          .then((status) => setDeployStatus(featureKey, status))
          .catch(() => { /* silent */ });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [isPrimary, featureKey, selectedProject, selectedFeature, setDeployStatus]);

  // Re-sync on SSE reconnect — mirrors the preview-side pattern
  // (`usePreviewSync`). Without this, events missed during the
  // connected→disconnected→connected window never reach this feature's
  // slice, leaving the deploy UI stuck on a stale snapshot.
  const connectionStatus = useStore((s: any) => s.connectionStatus);
  useEffect(() => {
    if (!isPrimary || !featureKey || !selectedProject || !selectedFeature) return;
    if (connectionStatus !== 'connected') return;
    getDeployStatus(selectedProject, selectedFeature)
      .then((status) => setDeployStatus(featureKey, status))
      .catch(() => { /* silent */ });
  }, [isPrimary, connectionStatus, featureKey, selectedProject, selectedFeature, setDeployStatus]);

  // Loading-timeout safety net (mirrors usePreviewSync). If the deploy stays
  // in a loading state without reaching a terminal phase for this long, a
  // terminal SSE event was likely lost — fall back to an authoritative
  // GET /deploy-status. The terminal-phase invariant in `selectIsDeployLoading`
  // then clears the spinner; a genuinely-slow build (still non-terminal) keeps
  // loading. Re-arms on every phase change, so a later lost event is still
  // caught within the window of the last received phase.
  const DEPLOY_LOADING_TIMEOUT_MS = 45_000;
  const deployPhase = deployStatus?.phase;
  useEffect(() => {
    if (!isPrimary || !featureKey || !selectedProject || !selectedFeature) return;
    if (!isDeployLoading) return;
    const id = window.setTimeout(() => {
      getDeployStatus(selectedProject, selectedFeature)
        .then((status) => setDeployStatus(featureKey, status))
        .catch(() => { /* next sync will catch up */ });
    }, DEPLOY_LOADING_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [isPrimary, featureKey, selectedProject, selectedFeature, isDeployLoading, deployPhase, setDeployStatus]);

  // SSE handler — piped events are already filtered by project/feature at the
  // SSEManager URL level (EventSource reconnects on feature switch). Redundant
  // in-memory guard below ensures no stray events land on the wrong feature
  // during the reconnect transition window.
  useEffect(() => {
    if (!isPrimary || !featureKey || !selectedProject || !selectedFeature) return;

    const handler = (payload: any) => {
      try {
        const s = useStore.getState();
        if (s.selectedProject !== selectedProject || s.selectedFeature !== selectedFeature) {
          return;
        }

        const messageType = payload?.type;
        const messageData = payload?.data;

        if (messageType === 'status') {
          const phase = (messageData as DeployStatus)?.phase;
          // stopGuard: while a stop is in flight, drop late "still working"
          // events so a stale build/running event doesn't revive the UI.
          const entry = s.deployByFeature[featureKey];
          const stillWorking =
            phase === 'building' ||
            phase === 'deploying' ||
            phase === 'starting' ||
            phase === 'running';
          if (entry && Date.now() < entry.stopGuardUntil && stillWorking) {
            return;
          }
          setDeployStatus(featureKey, messageData as DeployStatus);
          if (
            phase === 'running' ||
            phase === 'error' ||
            phase === 'stopped' ||
            phase === 'hibernated' ||
            phase === 'unavailable'
          ) {
            setDeployLoading(featureKey, false);
          }
        } else if (messageType === 'log') {
          appendDeployLog(featureKey, messageData as DeployLogEntry);
          // Mirror to the sessionStorage cache (throttled) so a refresh restores it.
          const logs = useStore.getState().deployByFeature[featureKey]?.logs ?? [];
          consoleLogCache.writeLogs('deploy', featureKey, logs);
        }
      } catch (err) {
        console.error('[useDeployManager] handler error:', err);
      }
    };

    const handlerId = sseManager.registerHandlerWithId('deploy', handler);

    return () => {
      sseManager.unregisterHandlerById(handlerId);
    };
  }, [isPrimary, featureKey, selectedProject, selectedFeature, setDeployStatus, setDeployLoading, appendDeployLog]);

  const deploy = useCallback(async (visibility: DeployVisibility = 'public') => {
    if (!selectedProject || !selectedFeature || !featureKey) return;
    // Local guard mirrors the backend validation (400 base-branch /
    // 409 code-job-active). The UI should not optimistically enter
    // `building` for a request that the server will immediately reject.
    if (!canDeploy) return;

    // Disarm any stopGuard from a prior stop — a NEW deploy's events are not stale.
    setDeployStopGuard(featureKey, 0);
    setDeployLoading(featureKey, true);
    clearDeployLogs(featureKey);
    consoleLogCache.clearLogs('deploy', featureKey); // restart resets persisted logs too
    setDeployStatus(featureKey, { phase: 'building', visibility });

    try {
      const result = await startDeploy(selectedProject, selectedFeature, visibility);
      if (!result.success) {
        setDeployStatus(featureKey, { phase: 'error', error: result.message });
        setDeployLoading(featureKey, false);
      }
      // On success (202): SSE events drive all subsequent state transitions.
    } catch (err: any) {
      setDeployStatus(featureKey, { phase: 'error', error: err.message });
      setDeployLoading(featureKey, false);
    }
  }, [selectedProject, selectedFeature, featureKey, canDeploy, setDeployLoading, clearDeployLogs, setDeployStatus, setDeployStopGuard]);

  const stop = useCallback(async () => {
    if (!selectedProject || !selectedFeature || !featureKey) return;

    // 15s window to ignore stale "still building/running" events while the
    // backend tears the deploy down (mirrors preview's stopGuard).
    setDeployStopGuard(featureKey, Date.now() + 15000);
    setDeployLoading(featureKey, true);
    try {
      await stopDeploy(selectedProject, selectedFeature);
      setDeployStatus(featureKey, { phase: 'stopped' });
      // Stop confirmed — the server is gone, so the guard window serves no
      // further purpose. Disarm so it can't leak into a follow-up deploy.
      setDeployStopGuard(featureKey, 0);
    } catch (err: any) {
      console.error('[useDeployManager] stop error:', err);
    } finally {
      setDeployLoading(featureKey, false);
    }
  }, [selectedProject, selectedFeature, featureKey, setDeployLoading, setDeployStatus, setDeployStopGuard]);

  const openDeployUrl = useCallback((url?: string) => {
    // Resolution order:
    //   1. Caller-supplied url (per-package Open button in multi-package UI)
    //   2. Top-level deployStatus.url (single-package back-compat)
    //   3. First running package's url (fallback when top-level null)
    const resolved =
      url
      ?? deployStatus?.url
      ?? deployStatus?.packages?.find(p => p.phase === 'running')?.url
      ?? deployStatus?.packages?.[0]?.url;
    if (resolved) {
      window.open(resolveAppUrl(resolved), '_blank');
    }
  }, [deployStatus?.url, deployStatus?.packages]);

  return {
    status: deployStatus,
    logs: deployLogs,
    isLoading: isDeployLoading,
    canDeploy,
    disabledReason,
    visibility: deployStatus?.visibility ?? 'public',
    deploy,
    stop,
    openDeployUrl,
  };
}
