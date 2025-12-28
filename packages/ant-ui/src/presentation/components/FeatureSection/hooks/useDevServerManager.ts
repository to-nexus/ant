import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/domain/store';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import { 
  startDevServer, 
  stopDevServer, 
  getDevServerStatus
} from '@/infrastructure/http/api';
import { DEV_SERVER_MESSAGES } from '../constants/devServer';
import { analyzeDevServerState, extractErrorFromLogs, extractProgress } from '../utils/devServer';
import { loadDismissedMessages, saveDismissedMessage, clearDismissedMessagesForServer } from '../utils/dismissedMessages';
import type { 
  DevServerState, 
  DevServerError, 
  DevServerProgress, 
  SetupFailureReasoning,
  UseDevServerManagerResult 
} from '../types/devServer';

/**
 * useDevServerManager
 * 
 * Manages dev server lifecycle and state
 * 
 * Features:
 * - Initial status check on mount/feature change
 * - Real-time updates via SSE (no polling)
 * - State analysis from logs
 * - Multi-package progress tracking
 */
export function useDevServerManager(
  selectedProject: string | undefined,
  selectedFeature: string | undefined
): UseDevServerManagerResult {
  const devServerStatus = useStore((state) => state.devServerStatus);
  const setDevServerStatus = useStore((state) => state.setDevServerStatus);
  const setDevServerLoading = useStore((state) => state.setDevServerLoading);
  const isDevServerLoading = useStore((state) => state.isDevServerLoading);
  
  const [error, setError] = useState<DevServerError | undefined>();
  const [progress, setProgress] = useState<DevServerProgress | undefined>();
  const [isDismissed, setIsDismissed] = useState(false);
  const selectedJobType = useStore((state) => state.selectedJobType);

  // Generate stable server key
  const serverKey = selectedProject && selectedFeature 
    ? `${selectedProject}/${selectedFeature}` 
    : '';

  // Derive state from status and logs
  const state: DevServerState = analyzeDevServerState(
    devServerStatus as any,  // ✅ Type cast for compatibility
    isDevServerLoading
  );
  
  // ✅ Get ready state from backend (health check result)
  const ready = devServerStatus?.ready || false;
  
  // Debug logging (disabled for production)
  // console.log('[useDevServerManager] 🔍 Current state:', {
  //   state,
  //   devServerStatus,
  //   isDevServerLoading,
  //   hasLogs: devServerStatus?.logs?.length || 0
  // });

  // Extract progress from logs
  useEffect(() => {
    if (devServerStatus?.logs && devServerStatus.logs.length > 0) {
      const extractedProgress = extractProgress(devServerStatus.logs);
      setProgress(extractedProgress);
    } else {
      setProgress(undefined);
    }
  }, [devServerStatus?.logs]);

  // Extract error from logs if in error state
  useEffect(() => {
    if (state === 'error' && devServerStatus?.logs) {
      const errorMessage = extractErrorFromLogs(devServerStatus.logs);
      if (errorMessage && errorMessage !== error?.message) {
        setError({ message: errorMessage });
      }
    } else if (state !== 'error' && error) {
      setError(undefined);
    }
  }, [state, devServerStatus?.logs, error]);

  // Initial status check and SSE connection
  useEffect(() => {
    if (!selectedProject || !selectedFeature) {
      setDevServerStatus(undefined);
      return;
    }

    getDevServerStatus(selectedProject, selectedFeature)
      .then(status => {
        setDevServerStatus(status);
      })
      .catch(err => {
        console.error('[useDevServerManager] Status check failed:', err);
      });
  }, [selectedProject, selectedFeature, setDevServerStatus]);

  // Check dismissal state when status changes
  useEffect(() => {
    if (!selectedProject || !selectedFeature) {
      setIsDismissed(false);
      return;
    }

    const reasoning = devServerStatus?.setupReasoning;
    if (reasoning && serverKey) {
      const dismissed = loadDismissedMessages();
      const isMessageDismissed = dismissed.some(
        d => d.serverKey === serverKey && d.reasoning === reasoning
      );
      setIsDismissed(isMessageDismissed);
    } else {
      setIsDismissed(false);
    }
  }, [devServerStatus?.setupReasoning, serverKey, selectedProject, selectedFeature]);

  // ✅ Subscribe to devServer events via existing unified SSEManager
  useEffect(() => {
    if (!selectedProject || !selectedFeature) {
      return;
    }

    const handler = (payload: any) => {
      try {
        const messageType = payload?.type;
        const messageData = payload?.data;

        if (messageType === 'status') {
          // ✅ Preserve logs on status updates
          const currentStatus = useStore.getState().devServerStatus;
          const mergedStatus = {
            ...(currentStatus || {}),
            ...(messageData || {}),
            logs: (messageData && messageData.logs) ? messageData.logs : (currentStatus?.logs || [])
          };
          setDevServerStatus(mergedStatus);

          // Stop loading when we have a steady/terminal signal.
          if (mergedStatus.ready || mergedStatus.running || (mergedStatus as any).setupReasoning) {
            setDevServerLoading(false);
          }
        } else if (messageType === 'log') {
          const currentStatus = useStore.getState().devServerStatus;
          if (!currentStatus) return;

          const updated = {
            ...currentStatus,
            logs: [...(currentStatus.logs || []), messageData]
          };
          setDevServerStatus(updated);
        }
      } catch (err) {
        console.error('[useDevServerManager] devServer handler error:', err);
      }
    };

    sseManager.registerHandler('devServer', handler);
    // Ensure unified SSE connection is active for current context (idempotent)
    sseManager.connect(selectedProject, selectedFeature, (selectedJobType as any) || 'code');

    return () => {
      sseManager.unregisterHandler('devServer', handler);
    };
  }, [selectedProject, selectedFeature, selectedJobType, setDevServerStatus, setDevServerLoading]);

  // Start dev server
  const startServer = useCallback(async () => {
    if (!selectedProject || !selectedFeature) {
      setError({ 
        message: DEV_SERVER_MESSAGES.ERROR_NO_PROJECT_FEATURE 
      });
      return;
    }
    
    // Clear dismissals when user explicitly clicks Play button
    clearDismissedMessagesForServer(serverKey);
    setIsDismissed(false);
    
    setDevServerLoading(true);
    setError(undefined);
    setProgress(undefined);
    
    try {
      // ✅ Ensure we can show install/start progress immediately
      setDevServerStatus({ running: false, ready: false, logs: [] } as any);
      sseManager.connect(selectedProject, selectedFeature, (selectedJobType as any) || 'code');
      
      await startDevServer(selectedProject, selectedFeature);
      // Keep loading until backend reports running/ready or an error state is detected from logs.
    } catch (err: any) {
      // If validation failed, set status with validation info (for Fix button)
      if (err.setupReasoning) {
        setDevServerStatus({
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
        message: err.message || DEV_SERVER_MESSAGES.ERROR_UNKNOWN,
        details: err.setupReason || err.response?.data?.error
      });
      setDevServerLoading(false);
    }
  }, [selectedProject, selectedFeature, serverKey, setDevServerLoading, setDevServerStatus, selectedJobType]);

  // Stop dev server
  const stopServer = useCallback(async () => {
    if (!selectedProject || !selectedFeature) return;
    
    setDevServerLoading(true);
    setError(undefined);
    setProgress(undefined);
    
    try {
      await stopDevServer(selectedProject, selectedFeature);
      setDevServerStatus(undefined);
    } catch (err: any) {
      setError({
        message: DEV_SERVER_MESSAGES.ERROR_STOP_FAILED(err.message || DEV_SERVER_MESSAGES.ERROR_UNKNOWN)
      });
    } finally {
      setDevServerLoading(false);
    }
  }, [selectedProject, selectedFeature, setDevServerLoading, setDevServerStatus]);

  // Dismiss message
  const dismissMessage = useCallback(() => {
    const reasoning = devServerStatus?.setupReasoning;
    if (reasoning && serverKey) {
      // Type guard: setupReasoning from backend is already SetupFailureReasoning type
      saveDismissedMessage(serverKey, reasoning as SetupFailureReasoning);
      setIsDismissed(true);
    }
  }, [devServerStatus?.setupReasoning, serverKey]);

  // ✅ Build "Fix All" payload from issues (extensible)
  const effectiveSuggestedFix = (() => {
    const issues = devServerStatus?.issues || [];
    const withFix = issues.filter(i => i.suggestedFix && i.suggestedFix.trim().length > 0);
    if (withFix.length === 0) return devServerStatus?.suggestedFix;
    
    const ordered = [...withFix].sort((a, b) => {
      if (a.severity === b.severity) return 0;
      return a.severity === 'fatal' ? -1 : 1;
    });
    
    return ordered.map(i => i.suggestedFix!.trim()).join('\n\n---\n\n');
  })();

  return {
    state,
    status: devServerStatus as any,  // Type cast for compatibility
    ready,  // Health check result
    setupReasoning: devServerStatus?.setupReasoning as SetupFailureReasoning | undefined,
    setupReason: devServerStatus?.setupReason,
    suggestedFix: effectiveSuggestedFix,
    error,
    progress,
    startServer,
    stopServer,
    isLoading: isDevServerLoading,
    isDismissed,
    dismissMessage
  };
}
