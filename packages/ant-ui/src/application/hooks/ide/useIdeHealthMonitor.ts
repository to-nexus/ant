import { useEffect, useRef } from 'react';
import { useStore, type Store } from '@/domain/store';
import { selectIdeSession, selectIdeBaseUrl } from '@/domain/store/selectors/ideSelectors';

const PROBE_INTERVAL_MS = 30_000;
const SSE_DISCONNECT_SOFT_DELAY_MS = 5_000;

/**
 * Active health monitoring for a connected IDE session. Two signals feed the
 * `markDisconnected` action:
 *
 *   1. **30s probe** — `probeIdeAlive(baseUrl)`. Only runs while
 *      `document.visibilityState === 'visible'` to avoid background-tab
 *      thermal cost.
 *   2. **SSE channel down (soft)** — if `sseSlice.connectionStatus` reports
 *      `'disconnected'` for ≥5s, transition to `disconnected` with
 *      signal=`'sse-channel-down'`. This shows the user a soft probing state
 *      while the 30s probe catches up; if the probe confirms dead, the next
 *      `markDisconnected('probe-dead')` will overwrite the signal.
 *
 * Inactive when the session isn't `connected` — probing a starting or
 * disconnected session is wasted work.
 */
export function useIdeHealthMonitor(): void {
  const session = useStore(selectIdeSession);
  const baseUrl = useStore(selectIdeBaseUrl);
  const sseConnectionStatus = useStore((s: Store) => s.connectionStatus);
  const markDisconnected = useStore((s: Store) => s.markDisconnected);

  // 30s probe
  useEffect(() => {
    if (session.kind !== 'connected' || !baseUrl) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const { probeIdeAlive } = await import('@/infrastructure/http/poll');
      const liveness = await probeIdeAlive(baseUrl);
      if (cancelled) return;
      if (liveness === 'dead') {
        markDisconnected?.('probe-dead');
      }
    };

    const id = window.setInterval(() => void tick(), PROBE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [session.kind, baseUrl, markDisconnected]);

  // SSE soft signal — 5s grace before flipping
  const sseDownSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (session.kind !== 'connected') {
      sseDownSinceRef.current = null;
      return;
    }
    if (sseConnectionStatus !== 'disconnected') {
      sseDownSinceRef.current = null;
      return;
    }
    if (sseDownSinceRef.current === null) {
      sseDownSinceRef.current = Date.now();
    }

    const id = window.setTimeout(() => {
      const since = sseDownSinceRef.current;
      if (since === null) return;
      if (Date.now() - since >= SSE_DISCONNECT_SOFT_DELAY_MS) {
        markDisconnected?.('sse-channel-down');
      }
    }, SSE_DISCONNECT_SOFT_DELAY_MS);

    return () => window.clearTimeout(id);
  }, [session.kind, sseConnectionStatus, markDisconnected]);
}
