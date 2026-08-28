import { useEffect, useRef, useCallback, useState } from 'react';
import { useStore } from '@/domain/store';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useTranslation } from 'react-i18next';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import { API_BASE } from '@/infrastructure/http/api';
import { setOnTransportFailure } from '@/infrastructure/http/transportFailure';
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
 * Request path: a fetch that dies before a readable response exists arrives
 * here too (`setOnTransportFailure`). There the health probe is the verdict,
 * not just a filter — a healthy `/health` alongside a dead request means the
 * request itself was refused upstream (an edge/WAF answering without CORS
 * headers, which the browser can only report as `Failed to fetch`), so it gets
 * its own actionable modal instead of "the server is down".
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

  const showGatewayBlockedModal = useCallback(() => {
    showWarning(
      t('gatewayBlocked.message', 'The server is healthy, but this request was blocked by an intermediary gateway.'),
      {
        title: t('gatewayBlocked.title', 'Request Blocked'),
        confirmText: t('gatewayBlocked.confirm', 'OK'),
      },
    );
  }, [showWarning, t]);

  /**
   * Banner → health probe → verdict. Shared by both entry points; `onHealthy`
   * is what separates them (SSE: transient, say nothing. Request: the request
   * was refused upstream, say so).
   */
  const probe = useCallback(async (onHealthy: () => void) => {
    if (healthCheckInFlightRef.current) return;
    healthCheckInFlightRef.current = true;
    setBannerVisible(true);
    try {
      if (await checkApiHealth()) {
        setBannerVisible(false);
        onHealthy();
      } else {
        useStore.getState().setConnectionStatus('error');
        setBannerVisible(false);
        showServerDownModal();
      }
    } finally {
      healthCheckInFlightRef.current = false;
    }
  }, [showServerDownModal]);

  // --- Fast path: SSE error callback -> banner -> health check ---
  // Idle SSE noise is not worth a banner, so this path still gates on a
  // running job. The request path below must NOT: a submit that fails has no
  // job by definition.
  useEffect(() => {
    const handleSSEError = async () => {
      if (!wasRunningRef.current) return;
      await probe(() => {/* healthy: transient reconnect, nothing to say */});
    };

    sseManager.setOnErrorCallback(handleSSEError);
    return () => sseManager.setOnErrorCallback(null);
  }, [probe]);

  // --- Request path: a fetch with no readable response ---
  useEffect(() => {
    setOnTransportFailure(() => { void probe(showGatewayBlockedModal); });
    return () => setOnTransportFailure(null);
  }, [probe, showGatewayBlockedModal]);

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
