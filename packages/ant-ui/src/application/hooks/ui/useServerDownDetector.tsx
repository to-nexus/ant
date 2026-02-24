import { useEffect, useRef, useCallback, useState } from 'react';
import { useStore } from '@/domain/store';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useTranslation } from 'react-i18next';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import { API_BASE } from '@/infrastructure/http/api';
import { ConnectionBanner } from '@/presentation/components/common/ConnectionBanner';

/**
 * Detects server-down events while a job is running and provides two-phase
 * visual feedback:
 *
 *   Phase 1 (immediate):  ConnectionBanner -- "서버 연결 시도중..."
 *   Phase 2 (~3 s later): health-check result decides next step
 *     - success  -> banner disappears (transient issue)
 *     - failure  -> banner disappears + "서버 다운" AlertModal
 *
 * Slow-path fallback: if SSEManager exhausts its 5 reconnection attempts and
 * sets connectionStatus to 'error', the modal is shown regardless.
 *
 * Must be rendered inside AlertModalProvider.
 */
export function useServerDownDetector() {
  const { t } = useTranslation('common');
  const connectionStatus = useStore((state) => state.connectionStatus);
  const isRunning = useStore((state) => state.isRunning);
  const { showWarning } = useAlertModalContext();

  const [bannerVisible, setBannerVisible] = useState(false);

  const prevStatusRef = useRef(connectionStatus);
  const wasRunningRef = useRef(isRunning);
  const healthCheckInFlightRef = useRef(false);

  useEffect(() => {
    wasRunningRef.current = isRunning;
  }, [isRunning]);

  const showServerDownModal = useCallback(() => {
    showWarning(
      t('serverDown.message', 'The server connection was lost. Your in-progress work can be resumed after the server restarts.'),
      {
        title: t('serverDown.title', 'Server Disconnected'),
        confirmText: t('serverDown.confirm', 'OK'),
      },
    );
  }, [showWarning, t]);

  // --- Fast path: SSE error callback -> banner -> health check ---
  useEffect(() => {
    const handleSSEError = async () => {
      if (!wasRunningRef.current) return;
      if (healthCheckInFlightRef.current) return;
      healthCheckInFlightRef.current = true;

      setBannerVisible(true);

      try {
        const healthy = await checkApiHealth();
        if (!healthy) {
          useStore.getState().setConnectionStatus('error');
          setBannerVisible(false);
          showServerDownModal();
        } else {
          setBannerVisible(false);
        }
      } finally {
        healthCheckInFlightRef.current = false;
      }
    };

    sseManager.setOnErrorCallback(handleSSEError);
    return () => sseManager.setOnErrorCallback(null);
  }, [showServerDownModal]);

  // --- Slow path: connectionStatus transition fallback ---
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = connectionStatus;

    const transitionedToError =
      (prevStatus === 'connected' || prevStatus === 'disconnected') &&
      connectionStatus === 'error';

    if (transitionedToError && wasRunningRef.current) {
      setBannerVisible(false);
      showServerDownModal();
    }
  }, [connectionStatus, showServerDownModal]);

  return { bannerVisible };
}

/**
 * Health check against the API server with a 3-second timeout.
 * Returns false if the server is unreachable or unhealthy.
 */
async function checkApiHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE()}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Render-nothing component that wires up the server-down detector
 * and renders the ConnectionBanner overlay.
 * Place inside AlertModalProvider.
 */
export function ServerDownDetector() {
  const { bannerVisible } = useServerDownDetector();
  return <ConnectionBanner visible={bannerVisible} />;
}
