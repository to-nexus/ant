/**
 * QueueStatusBanner - Shows job queue position in chat
 */

import { useStore } from '@/domain/store';

export function QueueStatusBanner() {
  const isQueued = useStore((state) => state.isQueued);
  const queuePosition = useStore((state) => state.queuePosition);
  const isRunning = useStore((state) => state.isRunning);

  // Only show when queued
  if (!isRunning || !isQueued || !queuePosition?.position) {
    return null;
  }

  return (
    <div className="mx-4 mb-3 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-3">
      {/* Spinner */}
      <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      
      {/* Text */}
      <span className="text-sm text-amber-600 dark:text-amber-400">
        Waiting in queue: <strong>#{queuePosition.position}</strong>
        <span className="text-amber-500/70 ml-1">
          ({queuePosition.totalWaiting} total)
        </span>
      </span>
    </div>
  );
}
