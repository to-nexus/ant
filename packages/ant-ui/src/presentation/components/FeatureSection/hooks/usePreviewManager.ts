/**
 * usePreviewManager — thin action facade.
 *
 * Owns only the mutating actions (`startServer`, `stopServer`,
 * `dismissMessage`) plus dismissal UI state. All state _reads_ go
 * through `selectPreviewVM(key)` directly from the caller — this hook
 * never exposes `state`/`status`/`ready` to avoid two parallel read
 * paths drifting.
 *
 * SSE subscription, initial `GET /status`, visibility / reconnect
 * re-sync live in `usePreviewSync` at the app root. None of those
 * effects are reachable from this file.
 */

import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/domain/store';
import {
  startPreview,
  stopPreview,
  getPreviewStatus,
} from '@/infrastructure/http/api';
import type { PreviewStatus } from '@/infrastructure/http/api';
import { makeFeatureKey } from '@/domain/store/slices/previewSlice';
import { PREVIEW_MESSAGES } from '../constants/preview';
import {
  loadDismissedMessages,
  saveDismissedMessage,
  clearDismissedMessagesForServer,
} from '../utils/dismissedMessages';
import type { PreviewError } from '../types/preview';

export interface UsePreviewManagerResult {
  startServer: () => Promise<void>;
  stopServer: () => Promise<void>;
  isDismissed: boolean;
  dismissMessage: () => void;
  /** Action-level error (e.g. network failure on POST /start). Does NOT
   *  include backend-reported errors — those live on `vm.error`. */
  localError: PreviewError | undefined;
}

export function usePreviewManager(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
): UsePreviewManagerResult {
  const featureKey = makeFeatureKey(selectedProject, selectedFeature);

  const mergePreviewStatus = useStore((s: any) => s.mergePreviewStatus);
  const setPreviewStatus = useStore((s: any) => s.setPreviewStatus);
  const setPreviewLoading = useStore((s: any) => s.setPreviewLoading);
  const setPreviewStopGuard = useStore((s: any) => s.setPreviewStopGuard);

  const [localError, setLocalError] = useState<PreviewError | undefined>();
  const [isDismissed, setIsDismissed] = useState(false);

  // Legacy dismissal storage still keys on the slash-form serverKey —
  // preserve for backward-compat with localStorage contents.
  const serverKey =
    selectedProject && selectedFeature
      ? `${selectedProject}/${selectedFeature}`
      : '';

  // Subscribe to the two fields that define the dismiss key so the
  // effect re-evaluates when either changes. Keeps the read narrow and
  // avoids re-running on unrelated status updates (log appends etc.).
  const dismissSetupReasoning = useStore(
    (s: any) => (featureKey ? s.previewByFeature[featureKey]?.status?.setupReasoning : undefined),
  );
  const dismissErrorMessage = useStore(
    (s: any) => (featureKey ? s.previewByFeature[featureKey]?.status?.error : undefined),
  );

  useEffect(() => {
    if (!featureKey || !serverKey) {
      setIsDismissed(false);
      return;
    }
    const dismissKey =
      dismissSetupReasoning ||
      (dismissErrorMessage ? `error:${dismissErrorMessage}` : null);
    if (!dismissKey) {
      setIsDismissed(false);
      return;
    }
    const dismissed = loadDismissedMessages();
    setIsDismissed(
      dismissed.some(
        (d) => d.serverKey === serverKey && d.reasoning === dismissKey,
      ),
    );
  }, [featureKey, serverKey, dismissSetupReasoning, dismissErrorMessage]);

  const startServer = useCallback(async () => {
    if (!selectedProject || !selectedFeature || !featureKey) {
      setLocalError({ message: PREVIEW_MESSAGES.ERROR_NO_PROJECT_FEATURE });
      return;
    }

    clearDismissedMessagesForServer(serverKey);
    setIsDismissed(false);
    setLocalError(undefined);

    // Disarm stopGuard from any prior stop cycle. The guard is a time-based
    // window that ignores stale `running:true` SSE events from a server
    // being shut down; once the user initiates a NEW start, those events
    // are no longer stale — they describe the new lifecycle. Without this
    // line, restarting within 15s of a stop drops the critical
    // `{phase:'running', running:true}` event from the new server's
    // health-check, leaving the UI stuck in a permanent loading state.
    setPreviewStopGuard(featureKey, 0);

    setPreviewLoading(featureKey, true);
    // Hard reset to shed any prior `phase: 'stopped'` / `error` /
    // `setupReasoning` — analyzePreviewState would otherwise keep the
    // panel in 'idle' or 'error' until the first SSE event lands.
    // Preserve fields that describe the workspace (not the run) so
    // buttons stay meaningful.
    const prev = useStore.getState().previewByFeature[featureKey]?.status;
    setPreviewStatus(featureKey, {
      running: false,
      ready: false,
      logs: [],
      canStart: prev?.canStart,
      packages: prev?.packages,
      structureType: prev?.structureType,
      projectProfile: prev?.projectProfile,
      connections: prev?.connections,
    } as PreviewStatus);

    try {
      const response = await startPreview(selectedProject, selectedFeature);
      if (response.status) {
        // Guard against phase regression: the /start response body holds
        // a snapshot taken BEFORE the async health check resolves (see
        // PreviewService.startPreview), so `response.status.phase` is
        // typically `'starting'`. If the health check already completed
        // on the BE side and the SSE `updatePhase('running')` event
        // reached us FIRST (possible with fast LAN + slow HTTP), merging
        // this response would downgrade phase from 'running' back to
        // 'starting' and freeze the UI in loading.
        const cur = useStore.getState().previewByFeature[featureKey]?.status;
        const incoming = response.status as Partial<PreviewStatus>;
        const wouldRegress =
          cur?.phase === 'running' && incoming.phase && incoming.phase !== 'running';
        if (!wouldRegress) {
          mergePreviewStatus(featureKey, incoming);
        }
      } else {
        mergePreviewStatus(featureKey, { running: true } as Partial<PreviewStatus>);
      }
      // Do NOT clear isLoading here. The VM derives `isLoading=false`
      // from `phase === 'running'`; until then, leaving it true lets the
      // UI show the starting spinner. SSE will land the running phase.
      // (A safety-net timeout in usePreviewSync catches the rare case
      // where that event is lost.)
    } catch (err: any) {
      if (err?.setupReasoning) {
        setPreviewStatus(featureKey, {
          running: false,
          ready: false,
          setupReasoning: err.setupReasoning,
          setupReason: err.setupReason,
          suggestedFix: err.suggestedFix,
          issues: err.issues,
          logs: [],
        } as PreviewStatus);
      } else {
        // Network/timeout — backend might still be up. Re-sync from
        // server before surfacing the error so the Start button reflects
        // reality.
        try {
          const status = await getPreviewStatus(selectedProject, selectedFeature);
          mergePreviewStatus(featureKey, status as Partial<PreviewStatus>);
        } catch { /* next sync will catch up */ }
      }
      setLocalError({
        message: err?.message || PREVIEW_MESSAGES.ERROR_UNKNOWN,
        details: err?.setupReason || err?.response?.data?.error,
      });
      setPreviewLoading(featureKey, false);
    }
  }, [
    selectedProject,
    selectedFeature,
    featureKey,
    serverKey,
    mergePreviewStatus,
    setPreviewStatus,
    setPreviewLoading,
    setPreviewStopGuard,
  ]);

  const stopServer = useCallback(async () => {
    if (!selectedProject || !selectedFeature || !featureKey) return;

    // 15s window to ignore stale `running:true` events during shutdown
    // (docker compose down / process-group kill can take seconds).
    setPreviewStopGuard(featureKey, Date.now() + 15000);

    const curr = useStore.getState().previewByFeature[featureKey]?.status;
    const canStart = curr?.canStart ?? true;
    mergePreviewStatus(featureKey, {
      running: false,
      ready: false,
      phase: 'stopping',
      canStart,
    });
    setPreviewLoading(featureKey, true);
    setLocalError(undefined);

    try {
      await stopPreview(selectedProject, selectedFeature);
      mergePreviewStatus(featureKey, {
        running: false,
        ready: false,
        phase: 'stopped',
        canStart: true,
      });
      // Stop confirmed by backend. The 15s guard window was a worst-case
      // safety net against stale `running:true` events from processes
      // still being torn down — once the /stop call returns success, the
      // server is already gone and the window serves no purpose. Clearing
      // it here keeps the guard bound to the stop cycle and prevents it
      // from leaking into a follow-up start.
      setPreviewStopGuard(featureKey, 0);
    } catch (err: any) {
      setLocalError({
        message: PREVIEW_MESSAGES.ERROR_STOP_FAILED(
          err?.message || PREVIEW_MESSAGES.ERROR_UNKNOWN,
        ),
      });
      try {
        const status = await getPreviewStatus(selectedProject, selectedFeature);
        mergePreviewStatus(featureKey, status as Partial<PreviewStatus>);
        // Second-chance disarm: if the refetch confirms the server is
        // NOT running, keeping a guard around would only suppress events
        // from the next start cycle. If it IS still running, keep the
        // guard — the original 15s window is still valid.
        if (!status?.running) {
          setPreviewStopGuard(featureKey, 0);
        }
      } catch { /* ignore */ }
    } finally {
      setPreviewLoading(featureKey, false);
    }
  }, [
    selectedProject,
    selectedFeature,
    featureKey,
    mergePreviewStatus,
    setPreviewLoading,
    setPreviewStopGuard,
  ]);

  const dismissMessage = useCallback(() => {
    if (!featureKey) {
      setIsDismissed(true);
      return;
    }
    const status = useStore.getState().previewByFeature[featureKey]?.status;
    const reasoning = status?.setupReasoning;
    const errorMsg = status?.error;
    const dismissKey = reasoning || (errorMsg ? `error:${errorMsg}` : null);
    if (dismissKey && serverKey) {
      saveDismissedMessage(serverKey, dismissKey);
    }
    setIsDismissed(true);
  }, [featureKey, serverKey]);

  return {
    startServer,
    stopServer,
    isDismissed,
    dismissMessage,
    localError,
  };
}
