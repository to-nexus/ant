import { useState, useEffect, useRef, useCallback } from 'react';
import { checkBridgeStatus, openDesktopDeepLink } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';

export type DesktopStatus = 'offline' | 'detected' | 'connected';
export type LaunchPhase = 'idle' | 'connecting' | 'success' | 'failed';

interface UseDesktopBridgeOptions {
  enablePolling?: boolean;
}

interface UseDesktopBridgeReturn {
  desktopStatus: DesktopStatus;
  launchPhase: LaunchPhase;
  isRefreshing: boolean;
  launchDesktop: () => Promise<void>;
  retryLaunch: () => Promise<void>;
  cancelLaunch: () => void;
  refreshStatus: () => Promise<void>;
}

const POLL_INTERVAL_DISCONNECTED = 30_000;
const POLL_INTERVAL_CONNECTED = 60_000;
const LAUNCH_POLL_INTERVAL = 2_000;
const LAUNCH_TIMEOUT = 15_000;

export function useDesktopBridge(
  options: UseDesktopBridgeOptions = {},
): UseDesktopBridgeReturn {
  const { enablePolling = false } = options;

  const bridgeConnected = useStore((s) => s.bridgeConnected);
  const bridgeDetected = useStore((s) => s.bridgeDetected);
  const setBridgeStatus = useStore((s) => s.setBridgeStatus);
  const userEmail = useStore((s) => s.userEmail);

  const [launchPhase, setLaunchPhase] = useState<LaunchPhase>('idle');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const launchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const launchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const periodicPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const desktopStatus: DesktopStatus =
    bridgeConnected === true
      ? 'connected'
      : bridgeDetected
        ? 'detected'
        : 'offline';

  const applyStatus = useCallback(
    (status: { connected: boolean; detected?: boolean; figmaDesktopReachable?: boolean }) => {
      setBridgeStatus({
        connected: status.connected,
        detected: status.detected ?? status.connected,
        figmaDesktopReachable: status.figmaDesktopReachable ?? false,
      });
    },
    [setBridgeStatus],
  );

  const fetchStatus = useCallback(async () => {
    try {
      const status = await checkBridgeStatus();
      if (mountedRef.current) applyStatus(status);
      return status;
    } catch {
      if (mountedRef.current) {
        setBridgeStatus({ connected: false, detected: false, figmaDesktopReachable: false });
      }
      return null;
    }
  }, [applyStatus, setBridgeStatus]);

  // --- Initial fetch on mount (regardless of enablePolling) [FIX-10] ---
  useEffect(() => {
    fetchStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Periodic polling [FIX-2] ---
  useEffect(() => {
    if (!enablePolling) return;

    const interval = bridgeConnected === true
      ? POLL_INTERVAL_CONNECTED
      : POLL_INTERVAL_DISCONNECTED;

    periodicPollRef.current = setInterval(() => {
      fetchStatus();
    }, interval);

    return () => {
      if (periodicPollRef.current) {
        clearInterval(periodicPollRef.current);
        periodicPollRef.current = null;
      }
    };
  }, [enablePolling, bridgeConnected, fetchStatus]);

  // --- Stop polling on logout [FIX-8] ---
  useEffect(() => {
    if (!userEmail) {
      cleanupLaunchPolling();
      if (periodicPollRef.current) {
        clearInterval(periodicPollRef.current);
        periodicPollRef.current = null;
      }
    }
  }, [userEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Cleanup on unmount ---
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupLaunchPolling();
      if (periodicPollRef.current) {
        clearInterval(periodicPollRef.current);
        periodicPollRef.current = null;
      }
    };
  }, []);

  const cleanupLaunchPolling = useCallback(() => {
    if (launchPollRef.current) {
      clearInterval(launchPollRef.current);
      launchPollRef.current = null;
    }
    if (launchTimeoutRef.current) {
      clearTimeout(launchTimeoutRef.current);
      launchTimeoutRef.current = null;
    }
  }, []);

  const startLaunchPolling = useCallback(() => {
    cleanupLaunchPolling();

    launchPollRef.current = setInterval(async () => {
      try {
        const status = await checkBridgeStatus();
        if (!mountedRef.current) return;
        applyStatus(status);
        if (status.connected) {
          cleanupLaunchPolling();
          setLaunchPhase('success');
          setTimeout(() => {
            if (mountedRef.current) setLaunchPhase('idle');
          }, 1200);
        }
      } catch {
        /* ignore poll errors */
      }
    }, LAUNCH_POLL_INTERVAL);

    launchTimeoutRef.current = setTimeout(() => {
      if (launchPollRef.current) {
        clearInterval(launchPollRef.current);
        launchPollRef.current = null;
      }
      if (mountedRef.current) setLaunchPhase('failed');
    }, LAUNCH_TIMEOUT);
  }, [cleanupLaunchPolling, applyStatus]);

  const launchDesktop = useCallback(async () => {
    setLaunchPhase('connecting');
    try {
      const opened = await openDesktopDeepLink();
      if (!opened) {
        setLaunchPhase('failed');
        return;
      }
      startLaunchPolling();
    } catch {
      setLaunchPhase('failed');
    }
  }, [startLaunchPolling]);

  const retryLaunch = useCallback(async () => {
    await launchDesktop();
  }, [launchDesktop]);

  const cancelLaunch = useCallback(() => {
    cleanupLaunchPolling();
    setLaunchPhase('idle');
  }, [cleanupLaunchPolling]);

  const refreshStatus = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await fetchStatus();
    } finally {
      if (mountedRef.current) setIsRefreshing(false);
    }
  }, [fetchStatus]);

  return {
    desktopStatus,
    launchPhase,
    isRefreshing,
    launchDesktop,
    retryLaunch,
    cancelLaunch,
    refreshStatus,
  };
}
