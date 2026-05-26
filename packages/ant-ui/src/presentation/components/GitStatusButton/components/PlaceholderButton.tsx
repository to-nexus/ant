import { GitBranch } from 'lucide-react';

interface PlaceholderButtonProps {
  message: string;
}

/**
 * Compact inline chip rendered when there is no Git repo yet (or the
 * first snapshot is still in flight). Matches handoff b3-explorer.jsx's
 * "not initialized" affordance: dashed border + GitBranch icon + label.
 * Non-interactive — Git initialization happens via the menu trigger.
 */
export function PlaceholderButton({ message }: PlaceholderButtonProps) {
  return (
    <div className="flex items-center flex-1">
      <div
        style={{
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
        }}
      >
        <GitBranch width={11} height={11} style={{ flexShrink: 0 }} />
        {message}
      </div>
    </div>
  );
}
