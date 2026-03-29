import { useState, useEffect, useCallback, useMemo } from 'react';
import { useStore } from '@/domain/store';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import { 
  startPreview, 
  stopPreview, 
  getPreviewStatus
} from '@/infrastructure/http/api';
import { PREVIEW_MESSAGES } from '../constants/preview';
import { analyzePreviewState, extractErrorFromLogs, extractProgress } from '../utils/preview';
import { loadDismissedMessages, saveDismissedMessage, clearDismissedMessagesForServer } from '../utils/dismissedMessages';
import type { 
  PreviewState, 
  PreviewError, 
  PreviewProgress, 
  SetupFailureReasoning,
  UsePreviewManagerResult 
} from '../types/preview';

/**
 * usePreviewManager
 * 
 * Manages preview server lifecycle and state
 * 
 * Features:
 * - Initial status check on mount/feature change
 * - Real-time updates via SSE (no polling)
 * - State analysis from logs
 * - Multi-package progress tracking
 */
export function usePreviewManager(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  options?: { primary?: boolean }
): UsePreviewManagerResult {
  const isPrimary = options?.primary ?? false;
  const previewStatus = useStore((state) => state.previewStatus);
  const setPreviewStatus = useStore((state) => state.setPreviewStatus);
  const setPreviewLoading = useStore((state) => state.setPreviewLoading);
  const isPreviewLoading = useStore((state) => state.isPreviewLoading);
  
  const [localError, setLocalError] = useState<PreviewError | undefined>();
  const [progress, setProgress] = useState<PreviewProgress | undefined>();
  const [isDismissed, setIsDismissed] = useState(false);
  const setPreviewStopGuardUntil = useStore((state) => state.setPreviewStopGuardUntil);

  // Generate stable server key
  const serverKey = selectedProject && selectedFeature 
    ? `${selectedProject}/${selectedFeature}` 
    : '';

  // Derive state from status and logs
  const state: PreviewState = analyzePreviewState(
    previewStatus as any,  // Type cast for compatibility
    isPreviewLoading
  );
  
  // Get ready state from backend (health check result)
  const ready = previewStatus?.ready || false;

  // Extract progress from logs
  useEffect(() => {
    if (previewStatus?.logs && previewStatus.logs.length > 0) {
      const extractedProgress = extractProgress(previewStatus.logs);
      setProgress(extractedProgress);
    } else {
      setProgress(undefined);
    }
  }, [previewStatus?.logs]);

  // Derive error synchronously from state + previewStatus + localError
  const error = useMemo<PreviewError | undefined>(() => {
    if (state === 'error') {
      const backendError = previewStatus?.error;
      if (backendError) return { message: backendError };
      if (previewStatus?.logs) {
        const errorMessage = extractErrorFromLogs(previewStatus.logs);
        if (errorMessage) return { message: errorMessage };
      }
    }
    return localError;
  }, [state, previewStatus?.error, previewStatus?.logs, localError]);

  // Sync preview status from server (mount, feature change, SSE reconnect)
  const syncPreviewStatus = useCallback(() => {
    if (!selectedProject || !selectedFeature) return;
    getPreviewStatus(selectedProject, selectedFeature)
      .then(status => {
        if (Date.now() < useStore.getState().previewStopGuardUntil && status?.running) {
          return;
        }
        // Preserve accumulated SSE logs — getPreviewStatus doesn't return them
        const currentLogs = useStore.getState().previewStatus?.logs;
        setPreviewStatus({
          ...status,
          logs: status?.logs || currentLogs || []
        });
      })
      .catch(err => {
        console.error('[usePreviewManager] Status sync failed:', err);
      });
  }, [selectedProject, selectedFeature, setPreviewStatus]);

  // Initial status check on mount / feature change (primary only to avoid duplicate HTTP calls)
  useEffect(() => {
    if (!isPrimary) return;
    if (!selectedProject || !selectedFeature) {
      setPreviewStatus(undefined);
      return;
    }
    syncPreviewStatus();
  }, [isPrimary, selectedProject, selectedFeature, syncPreviewStatus, setPreviewStatus]);

  // Re-sync on SSE reconnection (primary only)
  const connectionStatus = useStore((state) => state.connectionStatus);
  useEffect(() => {
    if (!isPrimary) return;
    if (connectionStatus === 'connected' && selectedProject && selectedFeature) {
      syncPreviewStatus();
    }
  }, [isPrimary, connectionStatus, syncPreviewStatus, selectedProject, selectedFeature]);

  // Check dismissal state when status changes
  useEffect(() => {
    if (!selectedProject || !selectedFeature) {
      setIsDismissed(false);
      return;
    }

    const reasoning = previewStatus?.setupReasoning;
    const errorMsg = previewStatus?.error;
    const dismissKey = reasoning || (errorMsg ? `error:${errorMsg}` : null);

    if (dismissKey && serverKey) {
      const dismissed = loadDismissedMessages();
      const isMessageDismissed = dismissed.some(
        d => d.serverKey === serverKey && d.reasoning === dismissKey
      );
      setIsDismissed(isMessageDismissed);
    } else {
      setIsDismissed(false);
    }
  }, [previewStatus?.setupReasoning, previewStatus?.error, serverKey, selectedProject, selectedFeature]);

  // Subscribe to preview events via existing unified SSEManager (primary only —
  // multiple instances would each append the same log entry to the store, doubling output)
  useEffect(() => {
    if (!isPrimary) return;
    if (!selectedProject || !selectedFeature) return;

    const handler = (payload: any) => {
      try {
        const messageType = payload?.type;
        const messageData = payload?.data;

        if (messageType === 'status') {
          if (Date.now() < useStore.getState().previewStopGuardUntil && messageData?.running === true) {
            return;
          }

          const currentStatus = useStore.getState().previewStatus;
          const mergedStatus = {
            ...(currentStatus || {}),
            ...(messageData || {}),
            logs: (messageData && messageData.logs) ? messageData.logs : (currentStatus?.logs || [])
          };
          setPreviewStatus(mergedStatus);

          if (mergedStatus.ready || mergedStatus.running || mergedStatus.setupReasoning || mergedStatus.error || mergedStatus.phase === 'error') {
            setPreviewLoading(false);
          }
        } else if (messageType === 'log') {
          const currentStatus = useStore.getState().previewStatus;
          if (!currentStatus) return;

          const updated = {
            ...currentStatus,
            logs: [...(currentStatus.logs || []), messageData]
          };
          setPreviewStatus(updated);
        }
      } catch (err) {
        console.error('[usePreviewManager] preview handler error:', err);
      }
    };

    const handlerId = sseManager.registerHandlerWithId('preview', handler);

    return () => {
      sseManager.unregisterHandlerById(handlerId);
    };
  }, [isPrimary, selectedProject, selectedFeature, setPreviewStatus, setPreviewLoading]);

  // Start preview server
  const startServer = useCallback(async () => {
    if (!selectedProject || !selectedFeature) {
      setLocalError({ 
        message: PREVIEW_MESSAGES.ERROR_NO_PROJECT_FEATURE 
      });
      return;
    }
    
    // Clear dismissals when user explicitly clicks Play button
    clearDismissedMessagesForServer(serverKey);
    setIsDismissed(false);
    
    setPreviewLoading(true);
    setLocalError(undefined);
    setProgress(undefined);
    
    try {
      // Ensure we can show install/start progress immediately
      setPreviewStatus({ running: false, ready: false, logs: [] } as any);
      
      const response = await startPreview(selectedProject, selectedFeature);
      
      // Use status from response (backend includes full status)
      if (response.status) {
        setPreviewStatus(response.status);
      } else {
        // Fallback: set running: true manually
        const currentStatus = useStore.getState().previewStatus;
        setPreviewStatus({ ...currentStatus, running: true });
      }
      setPreviewLoading(false);
    } catch (err: any) {
      // If validation failed, set status with validation info (for Fix button)
      if (err.setupReasoning) {
        setPreviewStatus({
          running: false,
          ready: false,
          setupReasoning: err.setupReasoning,
          setupReason: err.setupReason,
          suggestedFix: err.suggestedFix,
          issues: err.issues,
          logs: []
        });
      } else {
        // Network/timeout error — backend might still be running.
        // Re-sync from server before clearing loading to avoid
        // a window where the Start button is incorrectly enabled.
        try {
          const currentStatus = await getPreviewStatus(selectedProject, selectedFeature);
          setPreviewStatus(currentStatus);
        } catch { /* ignore — next poll will catch up */ }
      }
      
      setLocalError({
        message: err.message || PREVIEW_MESSAGES.ERROR_UNKNOWN,
        details: err.setupReason || err.response?.data?.error
      });
      setPreviewLoading(false);
    }
  }, [selectedProject, selectedFeature, serverKey, setPreviewLoading, setPreviewStatus]);

  // Stop preview server
  const stopServer = useCallback(async () => {
    if (!selectedProject || !selectedFeature) return;

    // Show 'stopping' phase with loading indicator while backend cleans up
    // (docker compose down, process group kill, port release can take several seconds)
    setPreviewStopGuardUntil(Date.now() + 15000);
    const currentLogs = useStore.getState().previewStatus?.logs;
    const currentCanStart = useStore.getState().previewStatus?.canStart ?? true;
    setPreviewStatus(currentLogs?.length
      ? { running: false, ready: false, phase: 'stopping', canStart: currentCanStart, logs: currentLogs } as any
      : { running: false, ready: false, phase: 'stopping' } as any
    );
    setPreviewLoading(true);

    setLocalError(undefined);
    setProgress(undefined);
    
    try {
      await stopPreview(selectedProject, selectedFeature);
      // Stop succeeded — now mark as fully stopped
      const finalLogs = useStore.getState().previewStatus?.logs;
      setPreviewStatus(finalLogs?.length
        ? { running: false, ready: false, phase: 'stopped', canStart: true, logs: finalLogs } as any
        : undefined
      );
    } catch (err: any) {
      setLocalError({
        message: PREVIEW_MESSAGES.ERROR_STOP_FAILED(err.message || PREVIEW_MESSAGES.ERROR_UNKNOWN)
      });
      // Re-sync status if stop failed
      try {
        const status = await getPreviewStatus(selectedProject, selectedFeature);
        setPreviewStatus(status);
      } catch {
        // ignore
      }
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedProject, selectedFeature, setPreviewLoading, setPreviewStatus, setPreviewStopGuardUntil]);

  // Dismiss message
  const dismissMessage = useCallback(() => {
    const reasoning = previewStatus?.setupReasoning;
    const errorMsg = previewStatus?.error;
    const dismissKey = reasoning || (errorMsg ? `error:${errorMsg}` : null);

    if (dismissKey && serverKey) {
      saveDismissedMessage(serverKey, dismissKey);
      setIsDismissed(true);
      return;
    }
    
    setIsDismissed(true);
  }, [previewStatus?.setupReasoning, previewStatus?.error, serverKey]);

  // Build "Fix All" payload from issues (extensible)
  const effectiveSuggestedFix = (() => {
    const issues = previewStatus?.issues || [];
    const withFix = issues.filter(i => i.suggestedFix && i.suggestedFix.trim().length > 0);
    if (withFix.length === 0) return previewStatus?.suggestedFix;
    
    const ordered = [...withFix].sort((a, b) => {
      if (a.severity === b.severity) return 0;
      return a.severity === 'fatal' ? -1 : 1;
    });
    
    return ordered.map(i => i.suggestedFix!.trim()).join('\n\n---\n\n');
  })();

  return {
    state,
    status: previewStatus as any,
    ready,
    setupReasoning: previewStatus?.setupReasoning as SetupFailureReasoning | undefined,
    setupReason: previewStatus?.setupReason,
    suggestedFix: effectiveSuggestedFix,
    error,
    progress,
    startServer,
    stopServer,
    isLoading: isPreviewLoading,
    isDismissed,
    dismissMessage
  };
}
