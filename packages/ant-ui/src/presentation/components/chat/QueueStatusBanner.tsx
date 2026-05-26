/**
 * QueueStatusBanner - Shows job queue position in chat
 */

import { useStore } from '@/domain/store';
import { Spinner } from '@/presentation/components/common/async';

export function QueueStatusBanner() {
  const isQueued = useStore((state) => state.isQueued);
  const queuePosition = useStore((state) => state.queuePosition);
  const isRunning = useStore((state) => state.isRunning);

  // Only show when queued
  if (!isRunning || !isQueued || !queuePosition?.position) {
    return null;
  }

  return (
    <div
      className="mx-4 mb-3 px-4 py-2 flex items-center gap-3"
      style={{
        background: 'oklch(from var(--orange-500) l c h / 0.10)',
        border: '1px solid oklch(from var(--orange-500) l c h / 0.30)',
        borderRadius: 'var(--r-sm)',
      }}
    >
      {/* Spinner */}
      <span style={{ color: 'var(--orange-500)', display: 'inline-flex' }}>
        <Spinner size="md" />
      </span>

      {/* Text */}
      <span className="text-sm" style={{ color: 'var(--orange-600)' }}>
        Waiting in queue: <strong>#{queuePosition.position}</strong>
        <span style={{ color: 'var(--orange-500)', opacity: 0.7, marginLeft: '0.25rem' }}>
          ({queuePosition.totalWaiting} total)
        </span>
      </span>
    </div>
  );
}
