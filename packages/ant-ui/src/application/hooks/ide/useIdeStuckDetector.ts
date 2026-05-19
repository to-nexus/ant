import { useEffect } from 'react';
import type { IdePhase } from '@ant/shared';
import { useStore, type Store } from '@/domain/store';
import { selectIdeSession } from '@/domain/store/selectors/ideSelectors';

/**
 * Per-phase stuck thresholds. The image-pulling threshold is generous (3min)
 * because cold pulls of `gitpod/openvscode-server` legitimately take
 * 30–120s; only flag stuck when we're well past the cold-pull p99.
 */
const PHASE_STUCK_MS: Record<IdePhase, number> = {
  'pod-pending': 45_000,
  'image-pulling': 180_000,
  'container-ready': 30_000,
  'http-ready': 30_000,
};

/**
 * Watches the current `starting` session and calls `markStuck()` once the
 * current phase has run past its threshold. No-op for non-`starting` kinds.
 *
 * Phase changes restart the timer (cleared by useEffect deps). On unmount,
 * the timer is cleared by the useEffect cleanup.
 */
export function useIdeStuckDetector(): void {
  const session = useStore(selectIdeSession);
  const markStuck = useStore((s: Store) => s.markStuck);

  useEffect(() => {
    if (session.kind !== 'starting') return;
    if (session.phase === null) return;       // no phase yet — pre-pod-pending
    if (session.stuckSince !== undefined) return; // already marked
    const threshold = PHASE_STUCK_MS[session.phase];
    // Account for time already elapsed in this phase (we can't tell from the
    // session alone, but `startedAt` is the lower bound — using it errs on
    // the side of marking earlier rather than later, which is the safer UX
    // mistake for stuck detection).
    const elapsedFromStart = Date.now() - session.startedAt;
    const remaining = Math.max(0, threshold - elapsedFromStart);

    const id = window.setTimeout(() => {
      markStuck?.();
    }, remaining);

    return () => window.clearTimeout(id);
  }, [session, markStuck]);
}
