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
    <span style={{ color: 'var(--amber-600)', display: 'inline-flex' }}>
      <Spinner
        size="sm"
        tone="inherit"
        className={cn('w-3 h-3', className)}
      />
    </span>
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
          'inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded',
          className,
        )}
        style={{
          background: 'var(--amber-50)',
          border: '1px solid var(--amber-300)',
          color: 'var(--amber-700)',
        }}
      >
        <StreamingSpinner className="w-3 h-3" />
        <span>{streamingLabel}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'inline-flex items-center text-[11px] px-1.5 py-0.5 rounded',
        className,
      )}
      style={{
        background: 'var(--bg-surface-2)',
        border: '1px solid var(--border-1)',
        color: 'var(--text-3)',
      }}
    >
      {readyLabel}
    </div>
  );
}
