
import type { ReactNode } from 'react';

interface RowListProps {
  children: ReactNode;
  /** Max height of the scrollable area in px. Default 240 per spec §5.4. */
  maxHeight?: number;
  /** Optional aria-label for assistive tech. */
  ariaLabel?: string;
}

/**
 * Scroll container for explorer rows (replaces legacy item dropdown).
 *
 * Spec contract (§5.4 / §6.2 T8):
 *  • Rows live INSIDE this container (scrollable, maxHeight: 240px).
 *  • Git toolbar and Preview Editor entry button live OUTSIDE — they
 *    are siblings of `<RowList>` in the parent layout and therefore
 *    stay fixed regardless of row scroll position.
 */
export function RowList({ children, maxHeight = 240, ariaLabel }: RowListProps) {
  return (
    <div
      role="list"
      aria-label={ariaLabel}
      className="aurora-scroll"
      style={{
        maxHeight,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: 2,
        background: 'var(--surface-2)',
        border: '1px solid var(--border-1)',
        borderRadius: 8,
      }}
    >
      {children}
    </div>
  );
}
