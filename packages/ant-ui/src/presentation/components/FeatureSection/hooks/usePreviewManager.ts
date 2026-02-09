import { useState, useEffect, useCallback, useRef } from 'react';
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
  selectedFeature: string | undefined
): UsePreviewManagerResult {
  const previewStatus = useStore((state) => state.previewStatus);
  const setPreviewStatus = useStore((state) => state.setPreviewStatus);
  const setPreviewLoading = useStore((state) => state.setPreviewLoading);
  const isPreviewLoading = useStore((state) => state.isPreviewLoading);
  
  const [error, setError] = useState<PreviewError | undefined>();
  const [progress, setProgress] = useState<PreviewProgress | undefined>();
  const [isDismissed, setIsDismissed] = useState(false);
  const stopGuardUntilRef = useRef<number>(0);

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

  // Extract error from backend error field or logs
  useEffect(() => {
    if (state === 'error') {
      // Prefer backend-provided error message over log parsing
      const backendError = previewStatus?.error;
      if (backendError && backendError !== error?.message) {
        setError({ message: backendError });
      } else if (!backendError && previewStatus?.logs) {
        const errorMessage = extractErrorFromLogs(previewStatus.logs);
        if (errorMessage && errorMessage !== error?.message) {
          setError({ message: errorMessage });
        }
      }
    } else if (error) {
      setError(undefined);
    }
  }, [state, previewStatus?.error, previewStatus?.logs, error]);

  // Initial status check + periodic sync (recovers from SSE drops)
  useEffect(() => {
    if (!selectedProject || !selectedFeature) {
      setPreviewStatus(undefined);
      return;
    }

    const syncStatus = () => {
      getPreviewStatus(selectedProject, selectedFeature)
        .then(status => {
          // Don't override if user just pressed stop (guard window)
          if (Date.now() < stopGuardUntilRef.current && status?.running) {
            return;
          }
          setPreviewStatus(status);
        })
        .catch(err => {
          console.error('[usePreviewManager] Status check failed:', err);
        });
    };

    // Initial sync
    syncStatus();
    
    // Periodic sync every 30s — recovers from missed SSE events
    const intervalId = setInterval(syncStatus, 30_000);
    
    return () => clearInterval(intervalId);
  }, [selectedProject, selectedFeature, setPreviewStatus]);

  // Check dismissal state when status changes
  useEffect(() => {
    if (!selectedProject || !selectedFeature) {
      setIsDismissed(false);
      return;
    }

    const reasoning = previewStatus?.setupReasoning;
    if (reasoning && serverKey) {
      const dismissed = loadDismissedMessages();
      const isMessageDismissed = dismissed.some(
        d => d.serverKey === serverKey && d.reasoning === reasoning
      );
      setIsDismissed(isMessageDismissed);
    } else {
      setIsDismissed(false);
    }
  }, [previewStatus?.setupReasoning, serverKey, selectedProject, selectedFeature]);

  // Subscribe to preview events via existing unified SSEManager
  useEffect(() => {
    if (!selectedProject || !selectedFeature) {
      return;
    }

    const handler = (payload: any) => {
      try {
        const messageType = payload?.type;
        const messageData = payload?.data;

        if (messageType === 'status') {
          // If user just pressed Stop, ignore any transient running:true status that may arrive late.
          if (Date.now() < stopGuardUntilRef.current && messageData?.running === true) {
            return;
          }

          // Preserve logs on status updates
          const currentStatus = useStore.getState().previewStatus;
          const mergedStatus = {
            ...(currentStatus || {}),
            ...(messageData || {}),
            logs: (messageData && messageData.logs) ? messageData.logs : (currentStatus?.logs || [])
          };
          setPreviewStatus(mergedStatus);

          // Stop loading when we have a steady/terminal signal.
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

    sseManager.registerHandler('preview', handler);

    return () => {
      sseManager.unregisterHandler('preview', handler);
    };
  }, [selectedProject, selectedFeature, setPreviewStatus, setPreviewLoading]);

  // Start preview server
  const startServer = useCallback(async () => {
    if (!selectedProject || !selectedFeature) {
      setError({ 
        message: PREVIEW_MESSAGES.ERROR_NO_PROJECT_FEATURE 
      });
      return;
    }
    
    // Clear dismissals when user explicitly clicks Play button
    clearDismissedMessagesForServer(serverKey);
    setIsDismissed(false);
    
    setPreviewLoading(true);
    setError(undefined);
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
      }
      
      setError({
        message: err.message || PREVIEW_MESSAGES.ERROR_UNKNOWN,
        details: err.setupReason || err.response?.data?.error
      });
      setPreviewLoading(false);
    }
  }, [selectedProject, selectedFeature, serverKey, setPreviewLoading, setPreviewStatus]);

  // Stop preview server
  const stopServer = useCallback(async () => {
    if (!selectedProject || !selectedFeature) return;

    // Optimistically drop status immediately so the UI stops showing "Running".
    // Also guard against late SSE status updates re-marking it as running.
    stopGuardUntilRef.current = Date.now() + 5000;
    setPreviewStatus(undefined);
    setPreviewLoading(false);

    setError(undefined);
    setProgress(undefined);
    
    try {
      await stopPreview(selectedProject, selectedFeature);
    } catch (err: any) {
      setError({
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
  }, [selectedProject, selectedFeature, setPreviewLoading, setPreviewStatus]);

  // Dismiss message
  const dismissMessage = useCallback(() => {
    const reasoning = previewStatus?.setupReasoning;
    if (reasoning && serverKey) {
      saveDismissedMessage(serverKey, reasoning as SetupFailureReasoning);
      setIsDismissed(true);
      return;
    }
    
    // Allow dismissing non-setup errors as well (session-only)
    setIsDismissed(true);
  }, [previewStatus?.setupReasoning, serverKey]);

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
