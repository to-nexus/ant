
import type { ReactNode } from 'react';

/**
 * Aurora two-column layout: sticky TOC (left) + scrollable content (right).
 *
 * Follows the CSS Grid sticky-sidebar standard pattern:
 *   - outer grid with no overflow clipping (caller's parent owns scroll)
 *   - first grid child: `position: sticky`, `alignSelf: start`, `maxHeight: 100vh`
 *     pins the TOC to viewport while allowing its own overflow scroll if items exceed viewport
 *   - second grid child: constrains content width via `maxWidth` while
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
        gridTemplateColumns: '76px 1fr',
        gap: 12,
        width: '100%',
        padding: '0 24px',
      }}
    >
      <div
        style={{
          position: 'sticky',
          top: 0,
          alignSelf: 'start',
          maxHeight: '100vh',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {toc}
      </div>
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
