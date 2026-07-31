import { GitBranch, RefreshCw } from 'lucide-react';

interface PlaceholderButtonProps {
  message: string;
  /**
   * When provided the chip becomes interactive and gains a refresh icon.
   * Used for the snapshot-fetch failure state, whose only other escape is
   * a manual page reload (the zero-feature surface has no SSE channel to
   * recover from).
   */
  onRetry?: () => void;
  retryLabel?: string;
}

/**
 * Compact inline chip rendered when there is no Git repo yet (or the
 * first snapshot is still in flight). Matches handoff b3-explorer.jsx's
 * "not initialized" affordance: dashed border + GitBranch icon + label.
 * Non-interactive unless `onRetry` is given.
 */
export function PlaceholderButton({ message, onRetry, retryLabel }: PlaceholderButtonProps) {
  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 22,
    padding: '4px 8px',
    borderRadius: 'var(--r-sm)',
    background: 'var(--surface-2)',
    border: '1px dashed var(--border-2)',
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--text-3)',
  };

  if (!onRetry) {
    return (
      <div className="flex items-center flex-1">
        <div style={chipStyle}>
          <GitBranch width={11} height={11} style={{ flexShrink: 0 }} />
          {message}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center flex-1">
      <button
        type="button"
        onClick={onRetry}
        title={retryLabel}
        aria-label={retryLabel ? `${message} — ${retryLabel}` : message}
        style={{
          ...chipStyle,
          cursor: 'pointer',
          fontFamily: 'inherit',
          color: 'var(--text-2)',
          borderColor: 'color-mix(in srgb, var(--orange-600) 40%, var(--border-2))',
        }}
      >
        <RefreshCw width={11} height={11} style={{ flexShrink: 0 }} />
        {message}
      </button>
    </div>
  );
}
