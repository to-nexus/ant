import { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from '@/domain/store';
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
  const eventSourceRef = useRef<EventSource | null>(null);

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
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setDevServerStatus(undefined);
      return;
    }

    getDevServerStatus(selectedProject, selectedFeature)
      .then(status => {
        setDevServerStatus(status);
        
        if (status.running || (status.logs && status.logs.length > 0)) {
          setupSSE(selectedProject, selectedFeature);
        }
      })
      .catch(err => {
        console.error('[useDevServerManager] Status check failed:', err);
      });

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
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

  // Setup SSE connection for real-time updates
  const setupSSE = useCallback((projectId: string, feature: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const featureParam = encodeURIComponent(feature);
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4100';
    
    let url = `${apiUrl}/api/projects/${projectId}/dev/logs?feature=${featureParam}`;
    
    try {
      const userEmail = localStorage.getItem('ant-ui:user-email');
      if (userEmail) {
        const email = JSON.parse(userEmail);
        url += `&user-email=${encodeURIComponent(email)}`;
      }
    } catch (error) {
      // Silent fail
    }
    
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        // Filter out non-devServer messages
        if (message.type !== 'devServer') {
          return;
        }
        
        let messageType = message.data?.type;
        let messageData = message.data?.data;
        
        if (messageType === 'status') {
          setDevServerStatus(messageData);
          setDevServerLoading(false);
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
        console.error('[useDevServerManager] SSE parse error:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('[useDevServerManager] SSE error:', err);
      eventSource.close();
      eventSourceRef.current = null;
      setDevServerLoading(false);
    };
  }, [setDevServerStatus, setDevServerLoading]);

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
      await startDevServer(selectedProject, selectedFeature);
      
      // Setup SSE for real-time updates
      setupSSE(selectedProject, selectedFeature);
      
      // Keep loading until SSE sends first status update
    } catch (err: any) {
      // If validation failed, set status with validation info (for Fix button)
      if (err.setupReasoning) {
        setDevServerStatus({
          running: false,
          ready: false,
          setupReasoning: err.setupReasoning,
          setupReason: err.setupReason,
          suggestedFix: err.suggestedFix,
          logs: []
        });
      }
      
      setError({
        message: err.message || DEV_SERVER_MESSAGES.ERROR_UNKNOWN,
        details: err.setupReason || err.response?.data?.error
      });
      setDevServerLoading(false);
    }
  }, [selectedProject, selectedFeature, serverKey, setDevServerLoading, setupSSE, setDevServerStatus]);

  // Stop dev server
  const stopServer = useCallback(async () => {
    if (!selectedProject || !selectedFeature) return;
    
    setDevServerLoading(true);
    setError(undefined);
    setProgress(undefined);
    
    try {
      await stopDevServer(selectedProject, selectedFeature);
      
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      
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

  return {
    state,
    status: devServerStatus as any,  // Type cast for compatibility
    ready,  // Health check result
    setupReasoning: devServerStatus?.setupReasoning as SetupFailureReasoning | undefined,
    setupReason: devServerStatus?.setupReason,
    suggestedFix: devServerStatus?.suggestedFix,
    error,
    progress,
    startServer,
    stopServer,
    isLoading: isDevServerLoading,
    isDismissed,
    dismissMessage
  };
}
