import { useEffect, useRef, useCallback, useState } from 'react';
import { useStore } from '@/domain/store';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useTranslation } from 'react-i18next';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import { API_BASE } from '@/infrastructure/http/api';
import { setOnTransportFailure, type TransportFailureInfo } from '@/infrastructure/http/transportFailure';
import { ConnectionBanner } from '@/presentation/components/common/ConnectionBanner';
import { useToastContext } from '@/presentation/providers/ToastProvider';

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
 * here too (`setOnTransportFailure`). A healthy `/health` alongside a dead
 * request means the request was refused upstream rather than the server being
 * down — but that is ALL it means. `/health` is bodyless, uncredentialed and
 * public, so it cannot speak for a preflight, a cookie or an authenticated
 * path, and the browser never exposes the status. So this path reports WHICH
 * request died and offers the content-refusal reading only when there was
 * content to refuse; it does not assert a cause it cannot observe.
 *
 * It also does not BLOCK. A background request dying mid project-switch is not
 * something the user can act on, and a modal there interrupts work it cannot
 * help — so the request path uses a toast and the banner. `serverDown` keeps
 * its modal: that one really is a stop-everything condition.
 *
 * Must be rendered inside AlertModalProvider.
 */
/** One notice per burst — a project switch fans out ~20 requests. */
const REFUSAL_NOTICE_COOLDOWN_MS = 30_000;
const REFUSAL_NOTICE_DURATION_MS = 6_000;

/** `https://host/api/projects/x/config?q=1` → `/api/projects/x/config`. */
function describeUrl(url: string): string {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return url;
  }
}

export function useServerDownDetector() {
  const { t } = useTranslation('common');
  const connectionStatus = useStore((state) => state.connectionStatus);
  const isRunning = useStore((state) => state.isRunning);
  const { showWarning } = useAlertModalContext();
  const { toast } = useToastContext();

  const [bannerVisible, setBannerVisible] = useState(false);

  const prevStatusRef = useRef(connectionStatus);
  const wasRunningRef = useRef(isRunning);
  const healthCheckInFlightRef = useRef(false);
  /**
   * `healthCheckInFlightRef` only collapses failures that overlap; it is
   * released in `finally`, so a burst that fails in sequence — one project
   * switch fans out ~20 requests — announced itself once per failure.
   */
  const lastRefusalNoticeRef = useRef(0);

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

  /**
   * The request was refused before Express saw it. Name it, and add the
   * content-refusal hint ONLY when the request carried content — a bodyless GET
   * cannot have been refused for what it contained, and telling the user to
   * reword input they never typed is advice they cannot act on.
   */
  const noticeRequestRefused = useCallback((url: string, info: TransportFailureInfo) => {
    const now = Date.now();
    if (now - lastRefusalNoticeRef.current < REFUSAL_NOTICE_COOLDOWN_MS) return;
    lastRefusalNoticeRef.current = now;

    const target = `${info.method} ${describeUrl(url)}`;
    toast.error(
      info.hasBody
        ? t('requestRefused.withBody', { target, defaultValue:
            'A request was refused before it reached the server ({{target}}). If it carried text that looks like a shell command, that may be why. Your input has been kept.' })
        : t('requestRefused.message', { target, defaultValue:
            'A request was refused before it reached the server ({{target}}).' }),
      REFUSAL_NOTICE_DURATION_MS,
    );
  }, [toast, t]);

  /**
   * Banner → health probe → verdict. Shared by both entry points; `onHealthy`
   * is what separates them (SSE: transient, say nothing. Request: name the
   * request that was refused). An unhealthy probe is the one verdict the probe
   * CAN establish on its own, and it keeps the blocking modal.
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
    setOnTransportFailure((url, info) => {
      void probe(() => noticeRequestRefused(url, info));
    });
    return () => setOnTransportFailure(null);
  }, [probe, noticeRequestRefused]);

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
