import { Spinner } from '@/presentation/components/common/async';
import { cn } from '@/shared/utils/design-system';

interface StreamingStatusChipProps {
  isStreaming: boolean;
  streamingLabel?: string;
  readyLabel?: string;
  className?: string;
}

export function StreamingSpinner({ className }: { className?: string }) {
  return (
    <Spinner
      size="sm"
      tone="inherit"
      className={cn('w-3 h-3 text-amber-600 dark:text-amber-400', className)}
    />
  );
}

export function StreamingStatusChip({
  isStreaming,
  streamingLabel = 'Streaming',
  readyLabel = 'Read-only',
  className,
}: StreamingStatusChipProps) {
  if (isStreaming) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border',
          'bg-amber-100 border-amber-300 text-amber-800',
          'dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300',
          className,
        )}
      >
        <StreamingSpinner className="w-3 h-3" />
        <span>{streamingLabel}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'inline-flex items-center text-[11px] px-1.5 py-0.5 rounded border',
        'bg-gray-100 border-gray-200 text-gray-600',
        'dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300',
        className,
      )}
    >
      {readyLabel}
    </div>
  );
}
