import { useEffect, useCallback } from 'react';
import { useStore } from '@/domain/store';
import {
  makeFeatureKey,
  selectDeployStatus,
  selectDeployLogs,
  selectIsDeployLoading,
} from '@/domain/store/slices/deploySlice';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import {
  startDeploy,
  stopDeploy,
  getDeployStatus,
  PREVIEW_BASE,
} from '@/infrastructure/http/api';
import type { DeployStatus, DeployLogEntry } from '@/infrastructure/http/api';

/**
 * Reason the Deploy button must stay disabled, or undefined when deploy is
 * allowed. Kept as a discriminated string so callers can render the right
 * tooltip/toast without duplicating the business rules.
 */
export type DeployDisabledReason =
  | 'no-feature-selected'
  | 'code-job-active';

export interface UseDeployManagerResult {
  status: DeployStatus | undefined;
  logs: DeployLogEntry[];
  isLoading: boolean;
  canDeploy: boolean;
  disabledReason: DeployDisabledReason | undefined;
  deploy: () => Promise<void>;
  stop: () => Promise<void>;
  openDeployUrl: () => void;
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
  const hasActiveCodeJob = useStore((s: any) => Boolean(s.activeJobs?.code));

  const disabledReason: DeployDisabledReason | undefined = (() => {
    if (!selectedFeature) return 'no-feature-selected';
    if (hasActiveCodeJob) return 'code-job-active';
    return undefined;
  })();
  const canDeploy = disabledReason === undefined;

  const setDeployStatus = useStore((s: any) => s.setDeployStatus);
  const setDeployLoading = useStore((s: any) => s.setDeployLoading);
  const appendDeployLog = useStore((s: any) => s.appendDeployLog);
  const clearDeployLogs = useStore((s: any) => s.clearDeployLogs);

  // Initial status fetch + re-fetch on feature switch (corrects stale 'running')
  useEffect(() => {
    if (!isPrimary || !featureKey || !selectedProject || !selectedFeature) return;
    getDeployStatus(selectedProject, selectedFeature)
      .then((status) => setDeployStatus(featureKey, status))
      .catch(() => setDeployStatus(featureKey, undefined));
  }, [isPrimary, featureKey, selectedProject, selectedFeature, setDeployStatus]);

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
          setDeployStatus(featureKey, messageData as DeployStatus);
          const phase = (messageData as DeployStatus)?.phase;
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

  const deploy = useCallback(async () => {
    if (!selectedProject || !selectedFeature || !featureKey) return;
    // Local guard mirrors the backend validation (400 base-branch /
    // 409 code-job-active). The UI should not optimistically enter
    // `building` for a request that the server will immediately reject.
    if (!canDeploy) return;

    setDeployLoading(featureKey, true);
    clearDeployLogs(featureKey);
    setDeployStatus(featureKey, { phase: 'building' });

    try {
      const result = await startDeploy(selectedProject, selectedFeature);
      if (!result.success) {
        setDeployStatus(featureKey, { phase: 'error', error: result.message });
        setDeployLoading(featureKey, false);
      }
      // On success (202): SSE events drive all subsequent state transitions.
    } catch (err: any) {
      setDeployStatus(featureKey, { phase: 'error', error: err.message });
      setDeployLoading(featureKey, false);
    }
  }, [selectedProject, selectedFeature, featureKey, canDeploy, setDeployLoading, clearDeployLogs, setDeployStatus]);

  const stop = useCallback(async () => {
    if (!selectedProject || !selectedFeature || !featureKey) return;

    setDeployLoading(featureKey, true);
    try {
      await stopDeploy(selectedProject, selectedFeature);
      setDeployStatus(featureKey, { phase: 'stopped' });
    } catch (err: any) {
      console.error('[useDeployManager] stop error:', err);
    } finally {
      setDeployLoading(featureKey, false);
    }
  }, [selectedProject, selectedFeature, featureKey, setDeployLoading, setDeployStatus]);

  const openDeployUrl = useCallback(() => {
    if (deployStatus?.url) {
      window.open(`${PREVIEW_BASE()}${deployStatus.url}`, '_blank');
    }
  }, [deployStatus?.url]);

  return {
    status: deployStatus,
    logs: deployLogs,
    isLoading: isDeployLoading,
    canDeploy,
    disabledReason,
    deploy,
    stop,
    openDeployUrl,
  };
}
