import { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from '@/domain/store';
import { 
  startDevServer, 
  stopDevServer, 
  getDevServerStatus
} from '@/infrastructure/http/api';
import { DEV_SERVER_MESSAGES, DEV_SERVER_POLLING } from '../constants/devServer';
import { analyzeDevServerState, extractErrorFromLogs, extractProgress } from '../utils/devServer';
import type { DevServerState, DevServerStatus, DevServerError, DevServerProgress, DevServerLog, UseDevServerManagerResult } from '../types/devServer';

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
  const eventSourceRef = useRef<EventSource | null>(null);

  // Derive state from status and logs
  const state: DevServerState = analyzeDevServerState(devServerStatus, isDevServerLoading);
  
  // ✅ Get ready state from backend (health check result)
  const ready = devServerStatus?.ready || false;
  
  // Debug logging
  console.log('[useDevServerManager] 🔍 Current state:', {
    state,
    devServerStatus,
    isDevServerLoading,
    hasLogs: devServerStatus?.logs?.length || 0
  });

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
      // Cleanup SSE
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setDevServerStatus(undefined);
      return;
    }

    // Initial status check
    console.log(`[useDevServerManager] Initial status check for ${selectedProject}/${selectedFeature}`);
    getDevServerStatus(selectedProject, selectedFeature)
      .then(status => {
        setDevServerStatus(status);
        
        // Setup SSE only if dev server is running or starting
        if (status.running || status.logs?.length > 0) {
          setupSSE(selectedProject, selectedFeature);
        }
      })
      .catch(err => {
        console.error('[useDevServerManager]', DEV_SERVER_MESSAGES.LOG_STATUS_CHECK_FAILED, err);
      });

    return () => {
      // Cleanup SSE on unmount or dependency change
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [selectedProject, selectedFeature, setDevServerStatus]);

  // Setup SSE connection for real-time updates
  const setupSSE = useCallback((projectId: string, feature: string) => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const featureParam = encodeURIComponent(feature);
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4100';
    
    // ✅ Add user-email query param for authentication (EventSource doesn't support custom headers)
    let url = `${apiUrl}/api/projects/${projectId}/dev/logs?feature=${featureParam}`;
    
    try {
      const userEmail = localStorage.getItem('ant-ui:user-email');
      if (userEmail) {
        const email = JSON.parse(userEmail);
        url += `&user-email=${encodeURIComponent(email)}`;
      }
    } catch (error) {
      console.warn('[useDevServerManager] Could not add user-email to SSE URL:', error);
    }
    
    console.log(`[useDevServerManager] Connecting SSE: ${url}`);
    
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('[useDevServerManager] ✅ SSE connection opened');
    };

    eventSource.onmessage = (event) => {
      console.log('[useDevServerManager] 📩 SSE message received:', event.data);
      try {
        const message = JSON.parse(event.data);
        
        // ✅ Handle both old format (direct type/data) and new format (wrapped in message.type='devServer')
        let messageType = message.type;
        let messageData = message.data;
        
        // If message.type is 'devServer', unwrap the inner data
        if (messageType === 'devServer' && messageData) {
          messageType = messageData.type;
          messageData = messageData.data;
        }
        
        if (messageType === 'status') {
          // Initial or updated status
          console.log('[useDevServerManager] 🔄 Updating status:', messageData);
          setDevServerStatus(messageData);
          // ✅ Release loading state once we get initial status
          console.log('[useDevServerManager] 🔓 Releasing loading state');
          setDevServerLoading(false);
        } else if (messageType === 'log') {
          // New log entry - append to existing logs
          console.log('[useDevServerManager] 📝 Appending log');
          // ✅ Get fresh state directly from store
          const currentStatus = useStore.getState().devServerStatus;
          if (!currentStatus) {
            console.log('[useDevServerManager] ⚠️ No previous status, cannot append log');
            return;
          }
          const updated = {
            ...currentStatus,
            logs: [...(currentStatus.logs || []), messageData]
          };
          console.log('[useDevServerManager] 🔄 Updated status with log, total logs:', updated.logs.length);
          setDevServerStatus(updated);
        }
      } catch (err) {
        console.error('[useDevServerManager] SSE parse error:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('[useDevServerManager] ❌ SSE error:', err);
      console.error('[useDevServerManager] EventSource readyState:', eventSource.readyState);
      console.error('[useDevServerManager] EventSource url:', eventSource.url);
      eventSource.close();
      eventSourceRef.current = null;
      
      // Release loading on error
      setDevServerLoading(false);
    };
  }, [setDevServerStatus]);

  // Start dev server
  const startServer = useCallback(async () => {
    if (!selectedProject || !selectedFeature) {
      setError({ 
        message: DEV_SERVER_MESSAGES.ERROR_NO_PROJECT_FEATURE 
      });
      return;
    }
    
    console.log('[useDevServerManager]', DEV_SERVER_MESSAGES.LOG_STARTING(selectedFeature));
    setDevServerLoading(true);
    setError(undefined);
    setProgress(undefined);
    
    try {
      const result = await startDevServer(selectedProject, selectedFeature);
      console.log('[useDevServerManager]', DEV_SERVER_MESSAGES.LOG_STARTED);
      console.log('[useDevServerManager] 📋 Start result:', result);
      
      // Setup SSE for real-time updates
      setupSSE(selectedProject, selectedFeature);
      
      // ✅ Keep loading until SSE sends first status update
      // Don't auto-release loading - let SSE connection establish first
    } catch (err: any) {
      console.error('[useDevServerManager]', DEV_SERVER_MESSAGES.ERROR_START_FAILED, err);
      setError({
        message: err.message || DEV_SERVER_MESSAGES.ERROR_UNKNOWN,
        details: err.response?.data?.error
      });
      setDevServerLoading(false);
    }
  }, [selectedProject, selectedFeature, setDevServerLoading, setupSSE]);

  // Stop dev server
  const stopServer = useCallback(async () => {
    if (!selectedProject || !selectedFeature) return;
    
    setDevServerLoading(true);
    setError(undefined);
    setProgress(undefined);
    
    try {
      await stopDevServer(selectedProject, selectedFeature);  // ✅ Pass feature
      console.log('[useDevServerManager]', DEV_SERVER_MESSAGES.LOG_STOPPED);
      
      // Close SSE connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      
      setDevServerStatus(undefined);
    } catch (err: any) {
      console.error('[useDevServerManager]', DEV_SERVER_MESSAGES.ERROR_STOP_FAILED(err.message));
      setError({
        message: DEV_SERVER_MESSAGES.ERROR_STOP_FAILED(err.message || DEV_SERVER_MESSAGES.ERROR_UNKNOWN)
      });
    } finally {
      setDevServerLoading(false);
    }
  }, [selectedProject, selectedFeature, setDevServerLoading, setDevServerStatus]);

  return {
    state,
    status: devServerStatus,
    ready,  // ✅ NEW: expose ready state
    error,
    progress,
    startServer,
    stopServer,
    isLoading: isDevServerLoading
  };
}
