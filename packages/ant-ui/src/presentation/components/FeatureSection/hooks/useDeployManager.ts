import { useEffect, useCallback } from 'react';
import { useStore } from '@/domain/store';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import {
  startDeploy,
  stopDeploy,
  getDeployStatus,
  PREVIEW_BASE,
} from '@/infrastructure/http/api';
import type { DeployStatus, DeployLogEntry } from '@/infrastructure/http/api';

export interface UseDeployManagerResult {
  status: DeployStatus | undefined;
  logs: DeployLogEntry[];
  isLoading: boolean;
  deploy: () => Promise<void>;
  stop: () => Promise<void>;
  openDeployUrl: () => void;
}

/**
 * useDeployManager
 *
 * Manages deploy lifecycle: build → serve → SSE updates.
 * Mirrors the usePreviewManager pattern.
 */
export function useDeployManager(
  selectedProject: string | undefined,
  selectedFeature: string | undefined,
  options?: { primary?: boolean }
): UseDeployManagerResult {
  const isPrimary = options?.primary ?? false;
  const deployStatus = useStore((s) => s.deployStatus);
  const deployLogs = useStore((s) => s.deployLogs);
  const isDeployLoading = useStore((s) => s.isDeployLoading);
  const setDeployStatus = useStore((s) => s.setDeployStatus);
  const setDeployLoading = useStore((s) => s.setDeployLoading);
  const appendDeployLog = useStore((s) => s.appendDeployLog);
  const clearDeployLogs = useStore((s) => s.clearDeployLogs);

  // Initial status fetch
  useEffect(() => {
    if (!isPrimary || !selectedProject || !selectedFeature) {
      if (isPrimary) setDeployStatus(undefined);
      return;
    }

    getDeployStatus(selectedProject, selectedFeature)
      .then((status) => setDeployStatus(status))
      .catch(() => setDeployStatus(undefined));
  }, [isPrimary, selectedProject, selectedFeature, setDeployStatus]);

  // SSE handler for deploy events (primary only)
  useEffect(() => {
    if (!isPrimary || !selectedProject || !selectedFeature) return;

    const handler = (payload: any) => {
      try {
        const messageType = payload?.type;
        const messageData = payload?.data;

        if (messageType === 'status') {
          setDeployStatus(messageData as DeployStatus);
          if (messageData?.phase === 'running' || messageData?.phase === 'error' || messageData?.phase === 'stopped') {
            setDeployLoading(false);
          }
        } else if (messageType === 'log') {
          appendDeployLog(messageData as DeployLogEntry);
        }
      } catch (err) {
        console.error('[useDeployManager] handler error:', err);
      }
    };

    const handlerId = sseManager.registerHandlerWithId('deploy', handler);

    return () => {
      sseManager.unregisterHandlerById(handlerId);
    };
  }, [isPrimary, selectedProject, selectedFeature, setDeployStatus, setDeployLoading, appendDeployLog]);

  const deploy = useCallback(async () => {
    if (!selectedProject || !selectedFeature) return;

    setDeployLoading(true);
    clearDeployLogs();
    setDeployStatus({ phase: 'building' });

    try {
      const result = await startDeploy(selectedProject, selectedFeature);
      if (!result.success) {
        setDeployStatus({ phase: 'error', error: result.message });
        setDeployLoading(false);
      }
      // On success (202): SSE events drive all subsequent state transitions.
      // loading is cleared by SSE handler when phase reaches running/error/stopped.
    } catch (err: any) {
      setDeployStatus({ phase: 'error', error: err.message });
      setDeployLoading(false);
    }
  }, [selectedProject, selectedFeature, setDeployLoading, clearDeployLogs, setDeployStatus]);

  const stop = useCallback(async () => {
    if (!selectedProject || !selectedFeature) return;

    setDeployLoading(true);
    try {
      await stopDeploy(selectedProject, selectedFeature);
      setDeployStatus({ phase: 'stopped' });
    } catch (err: any) {
      console.error('[useDeployManager] stop error:', err);
    } finally {
      setDeployLoading(false);
    }
  }, [selectedProject, selectedFeature, setDeployLoading, setDeployStatus]);

  const openDeployUrl = useCallback(() => {
    if (deployStatus?.url) {
      window.open(`${PREVIEW_BASE()}${deployStatus.url}`, '_blank');
    }
  }, [deployStatus?.url]);

  return {
    status: deployStatus,
    logs: deployLogs,
    isLoading: isDeployLoading,
    deploy,
    stop,
    openDeployUrl,
  };
}
