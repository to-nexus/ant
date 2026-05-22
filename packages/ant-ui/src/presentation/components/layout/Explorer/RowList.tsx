
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
 *  • Per the B3 handoff, this container is a chrome-less scroller:
 *    no border, no surface background, no padding. Visual separation
 *    between rows comes from each row's own hover/active background.
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
      }}
    >
      {children}
    </div>
  );
}
