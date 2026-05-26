
import type { ReactNode } from 'react';

/**
 * Aurora two-column layout: sticky TOC (left) + content (right).
 *
 * Follows the C3_COMMON sticky-grid recipe verbatim:
 *   - outer grid with `align-items: stretch` (default, do NOT override)
 *   - no overflow clipping on the wrapper (the caller's parent owns scroll)
 *   - first grid child wraps `toc` in a `minHeight: 100%` div so its
 *     internal `position: sticky` works against the right column's height
 *   - second grid child constrains content width via `maxWidth` while
 *     `minWidth: 0` allows flex/grid shrinkage of children
 */
export interface TwoColLayoutProps {
  toc: ReactNode;
  children: ReactNode;
  /** Content max width in px, or 'none' for unbounded. Default 820. */
  contentMaxWidth?: number | 'none';
}

export function TwoColLayout({
  toc,
  children,
  contentMaxWidth = 820,
}: TwoColLayoutProps) {
  const resolvedMaxWidth =
    contentMaxWidth === 'none' ? undefined : contentMaxWidth;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(180px, 200px) 1fr',
        gap: 24,
        width: '100%',
        padding: '0 24px',
      }}
    >
      <div style={{ minHeight: '100%' }}>{toc}</div>
      <div style={{ minWidth: 0, maxWidth: resolvedMaxWidth }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            padding: '20px 0 40px',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
